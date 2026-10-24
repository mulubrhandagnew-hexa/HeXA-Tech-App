import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createServer } from "./server.js";
import { Hub } from "../service/hub.js";
import { sequentialGenerator } from "../domain/ids.js";
import { toMs } from "../domain/time.js";
import { InMemoryRepository } from "../persistence/repository.js";

const SPOT = { latitude: 34.0522, longitude: -118.2437 };

function app() {
  const repository = new InMemoryRepository();
  const hub = new Hub(undefined, sequentialGenerator("a"), () => toMs("2026-05-01T08:00:00Z"));
  return { server: createServer({ hub, repository }), repository };
}

type Server = ReturnType<typeof app>["server"];

async function seed(server: Server) {
  await request(server).post("/services/seed-default").expect(201);
  const customer = (await request(server).post("/customers").send({ name: "Abebe" }).expect(201)).body.customer;
  const vehicle = (
    await request(server)
      .post(`/customers/${customer.id}/vehicles`)
      .send({ make: "VW", model: "ID.4", connectorTypes: ["CCS1"] })
      .expect(201)
  ).body.vehicle;
  const provider = (
    await request(server)
      .post("/providers/apply")
      .send({ name: "Volt Van", services: ["MOBILE_CHARGING"], connectorTypes: ["CCS1"], serviceRadiusMiles: 15 })
      .expect(201)
  ).body.provider;
  await request(server).post(`/providers/${provider.id}/verify`).expect(200);
  await request(server).post(`/providers/${provider.id}/online`).send({ location: { latitude: 34.06, longitude: -118.25 } }).expect(200);
  return { customer, vehicle, provider };
}

describe("REST API", () => {
  let ctx: ReturnType<typeof app>;
  beforeEach(() => {
    ctx = app();
  });

  it("reports health", async () => {
    const res = await request(ctx.server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("hexa-ev-recharge");
  });

  it("runs a mobile charging job end to end and persists it", async () => {
    const { server, repository } = ctx;
    const { customer, vehicle, provider } = await seed(server);
    const r = (
      await request(server)
        .post("/requests")
        .send({ vehicleId: vehicle.id, serviceCode: "MOBILE_CHARGING", location: { ...SPOT, address: "Hotel lot" } })
        .expect(201)
    ).body.request;

    const candidates = (await request(server).get(`/requests/${r.id}/candidates`).expect(200)).body.candidates;
    expect(candidates[0].provider.id).toBe(provider.id);

    await request(server).post(`/requests/${r.id}/match`).send({}).expect(200);
    for (const step of ["depart", "arrive", "start"]) {
      await request(server).post(`/requests/${r.id}/${step}`).send({ providerId: provider.id }).expect(200);
    }
    const finished = await request(server).post(`/requests/${r.id}/finish`).send({ providerId: provider.id, quantity: 20_000 }).expect(200);
    expect(finished.body.request.bill.total).toBe(2500 + 1100);
    await request(server).post(`/requests/${r.id}/confirm`).send({ rating: { stars: 4 } }).expect(200);

    expect((await request(server).get(`/customers/${customer.id}/statement`)).body.total).toBe(3600);
    expect((await request(server).get(`/providers/${provider.id}/earnings`)).body.total).toBe(2880);
    expect((await repository.load()).requests[0]!.status).toBe("completed");
  });

  it("maps domain errors to 400 / 403 / 404 / 409 / 503", async () => {
    const { server } = ctx;
    const { vehicle, provider } = await seed(server);
    const body = { vehicleId: vehicle.id, serviceCode: "MOBILE_CHARGING", location: SPOT };
    const r = (await request(server).post("/requests").send(body).expect(201)).body.request;

    expect((await request(server).post("/requests").send(body)).status).toBe(409);
    expect((await request(server).get("/requests/missing")).status).toBe(404);
    expect((await request(server).post("/requests").send({ ...body, serviceCode: "WARP_DRIVE" })).status).toBe(400);
    await request(server).post(`/requests/${r.id}/match`).send({ providerId: provider.id }).expect(200);
    expect((await request(server).post(`/requests/${r.id}/depart`).send({ providerId: "someone-else" })).status).toBe(403);
    expect((await request(server).post("/autonomous/requests").send(body)).status).toBe(503);
  });

  it("lets fleets book several vehicles in one call", async () => {
    const { server } = ctx;
    await request(server).post("/services/seed-default").expect(201);
    const fleet = (await request(server).post("/customers").send({ kind: "fleet", name: "Ops", company: "Metro Vans" }).expect(201)).body.customer;
    const ids: string[] = [];
    for (const model of ["E-Transit", "EDV"]) {
      ids.push((await request(server).post(`/customers/${fleet.id}/vehicles`).send({ make: "X", model }).expect(201)).body.vehicle.id);
    }
    const res = await request(server)
      .post(`/fleet/${fleet.id}/requests`)
      .send({ requests: ids.map((vehicleId) => ({ vehicleId, serviceCode: "ADAS_SENSOR", location: SPOT })) })
      .expect(201);
    expect(res.body.requests).toHaveLength(2);
    expect((await request(server).get("/requests").query({ status: "requested" })).body.requests).toHaveLength(2);
  });

  it("updates prices with decimal input and settings", async () => {
    const { server } = ctx;
    await request(server).post("/services/seed-default").expect(201);
    const res = await request(server).patch("/services/MOBILE_CHARGING").send({ unitPrice: "0.60" }).expect(200);
    expect(res.body.service.unitPrice).toBe(60);
    const s = await request(server).patch("/settings").send({ commissionBps: 1800 }).expect(200);
    expect(s.body.settings).toEqual({ commissionBps: 1800, autonomousApiEnabled: false });
  });
});
