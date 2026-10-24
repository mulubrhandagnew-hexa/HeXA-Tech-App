import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createServer } from "./server.js";
import { Hub } from "../service/hub.js";
import { sequentialGenerator } from "../domain/ids.js";
import { toMs } from "../domain/time.js";
import { InMemoryRepository } from "../persistence/repository.js";

function app() {
  const repository = new InMemoryRepository();
  const hub = new Hub(undefined, sequentialGenerator("a"), () => toMs("2026-05-01T08:00:00Z"));
  return { server: createServer({ hub, repository }), repository };
}

async function seed(server: ReturnType<typeof app>["server"]) {
  const customer = (await request(server).post("/customers").send({ name: "Abebe" }).expect(201)).body.customer;
  const vehicle = (
    await request(server)
      .post(`/customers/${customer.id}/vehicles`)
      .send({ make: "VW", model: "ID.4", connectorTypes: ["CCS2"] })
      .expect(201)
  ).body.vehicle;
  const station = (
    await request(server)
      .post("/stations")
      .send({
        name: "HeXA Hub",
        address: "Main St",
        latitude: 9,
        longitude: 38.7,
        connectors: [{ type: "CCS2", maxPowerKw: 120, pricePerKwh: "0.45", idleFeePerMinute: "0.40" }],
      })
      .expect(201)
  ).body.station;
  return { customer, vehicle, station, connector: station.connectors[0] };
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

  it("charges a vehicle with decimal price input and persists the result", async () => {
    const { server, repository } = ctx;
    const { customer, vehicle, station, connector } = await seed(server);
    expect(connector.pricePerKwh).toBe(45);

    const session = (
      await request(server)
        .post("/sessions")
        .send({ stationId: station.id, connectorId: connector.id, vehicleId: vehicle.id, startMeterWh: 0 })
        .expect(201)
    ).body.session;

    const stopped = await request(server)
      .post(`/sessions/${session.id}/stop`)
      .send({ endMeterWh: 40_000, at: "2026-05-01T09:00:00Z" })
      .expect(200);
    expect(stopped.body.session.bill.total).toBe(1800);

    const statement = await request(server).get(`/customers/${customer.id}/statement`).expect(200);
    expect(statement.body.total).toBe(1800);
    expect((await repository.load()).sessions[0]!.status).toBe("completed");
  });

  it("maps domain errors to 400 / 404 / 409", async () => {
    const { server } = ctx;
    const { vehicle, station, connector } = await seed(server);
    const body = { stationId: station.id, connectorId: connector.id, vehicleId: vehicle.id, startMeterWh: 0 };

    await request(server).post("/sessions").send(body).expect(201);
    expect((await request(server).post("/sessions").send(body)).status).toBe(409);
    expect((await request(server).get("/stations/missing")).status).toBe(404);
    expect((await request(server).post("/sessions").send({ ...body, startMeterWh: -1 })).status).toBe(400);
    const badTime = await request(server)
      .post("/reservations")
      .send({ ...body, start: "2026-05-01 10:00", end: "2026-05-01T11:00:00Z" });
    expect(badTime.status).toBe(400);
  });

  it("books and completes a car care appointment", async () => {
    const { server } = ctx;
    const { vehicle } = await seed(server);
    await request(server).post("/care/catalog/seed-default").expect(201);
    await request(server).post("/care/bays").send({ name: "Bay 1" }).expect(201);

    const appt = (
      await request(server)
        .post("/care/appointments")
        .send({ vehicleId: vehicle.id, serviceCodes: ["BATT-HEALTH"], start: "2026-05-01T10:00:00Z" })
        .expect(201)
    ).body.appointment;
    await request(server).post(`/care/appointments/${appt.id}/start`).expect(200);
    await request(server).post(`/care/appointments/${appt.id}/complete`).expect(200);

    const report = await request(server)
      .get("/reports/revenue")
      .query({ from: "2026-05-01T00:00:00Z", to: "2026-05-02T00:00:00Z" })
      .expect(200);
    expect(report.body.care.total).toBe(8900);
  });

  it("filters stations and reports availability", async () => {
    const { server } = ctx;
    const { station } = await seed(server);
    expect((await request(server).get("/stations").query({ connectorType: "CCS2" })).body.stations).toHaveLength(1);
    expect((await request(server).get("/stations").query({ connectorType: "NACS" })).body.stations).toHaveLength(0);
    expect((await request(server).get("/stations").query({ connectorType: "bogus" })).status).toBe(400);
    const avail = await request(server).get(`/stations/${station.id}/availability`).expect(200);
    expect(avail.body.connectors[0].status).toBe("available");
  });
});
