import { describe, it, expect, beforeEach } from "vitest";
import { Hub } from "./hub.js";
import { sequentialGenerator } from "../domain/ids.js";
import { toMs } from "../domain/time.js";
import { type Station } from "../domain/charging.js";

const NOW = "2026-05-01T08:00:00Z";

function setup() {
  let now = toMs(NOW);
  const hub = new Hub(undefined, sequentialGenerator("h"), () => now);
  const customer = hub.addCustomer({ name: "Abebe", email: "abebe@example.com" });
  const vehicle = hub.addVehicle({ customerId: customer.id, make: "Hyundai", model: "Ioniq 5", connectorTypes: ["CCS2"] });
  const other = hub.addCustomer({ name: "Sara" });
  const otherVehicle = hub.addVehicle({ customerId: other.id, make: "BYD", model: "Atto 3", connectorTypes: [] });
  const station = hub.addStation({
    name: "HeXA Hub Bole",
    address: "Bole Rd, Addis Ababa",
    latitude: 8.99,
    longitude: 38.79,
    connectors: [
      { type: "CCS2", maxPowerKw: 150, pricePerKwh: 45, idleFeePerMinute: 40 },
      { type: "Type2", maxPowerKw: 22, pricePerKwh: 30, idleFeePerMinute: 10 },
    ],
  });
  const [dc, ac] = station.connectors as [Station["connectors"][0], Station["connectors"][0]];
  return { hub, customer, vehicle, other, otherVehicle, station, dc, ac, setNow: (iso: string) => (now = toMs(iso)) };
}

describe("charging network", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("filters stations by connector type and power", () => {
    expect(ctx.hub.listStations({ connectorType: "CCS2" })).toHaveLength(1);
    expect(ctx.hub.listStations({ connectorType: "NACS" })).toHaveLength(0);
    expect(ctx.hub.listStations({ minPowerKw: 200 })).toHaveLength(0);
  });

  it("refuses an incompatible connector", () => {
    const { hub, station, ac, vehicle } = ctx;
    expect(() =>
      hub.startSession({ stationId: station.id, connectorId: ac.id, vehicleId: vehicle.id, startMeterWh: 0 }),
    ).toThrow(/accepts CCS2 but connector is Type2/);
  });

  it("runs a walk-in session end to end and bills energy plus idle time", () => {
    const { hub, station, dc, vehicle, customer } = ctx;
    const session = hub.startSession({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, startMeterWh: 100_000 });
    expect(hub.availability(station.id)[0]!.status).toBe("charging");

    hub.markChargingComplete(session.id, "2026-05-01T08:40:00Z");
    const done = hub.stopSession(session.id, { endMeterWh: 152_000, at: "2026-05-01T09:05:00Z" });
    // 52 kWh × 45¢ = $23.40; 25 min plugged in after full − 10 min grace = 15 × 40¢ = $6.00
    expect(done.bill).toEqual({ energyWh: 52_000, energy: 2340, idleMinutes: 15, idle: 600, total: 2940 });
    expect(hub.availability(station.id)[0]!.status).toBe("available");
    expect(hub.customerStatement(customer.id).chargingTotal).toBe(2940);
  });

  it("keeps the price snapshot from session start", () => {
    const { hub, station, dc, vehicle } = ctx;
    const session = hub.startSession({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, startMeterWh: 0 });
    expect(session.pricePerKwh).toBe(45);
  });

  it("blocks a second session on a busy connector or for a busy vehicle", () => {
    const { hub, station, dc, ac, vehicle, otherVehicle } = ctx;
    hub.startSession({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, startMeterWh: 0 });
    expect(() =>
      hub.startSession({ stationId: station.id, connectorId: dc.id, vehicleId: otherVehicle.id, startMeterWh: 0 }),
    ).toThrow(/already in use/);
    hub.startSession({ stationId: station.id, connectorId: ac.id, vehicleId: otherVehicle.id, startMeterWh: 0 });
    expect(() =>
      hub.startSession({ stationId: station.id, connectorId: ac.id, vehicleId: otherVehicle.id, startMeterWh: 0 }),
    ).toThrow();
  });

  it("rejects overlapping reservations on the same connector", () => {
    const { hub, station, dc, vehicle, otherVehicle } = ctx;
    hub.reserve({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, start: "2026-05-01T10:00:00Z", end: "2026-05-01T11:00:00Z" });
    expect(() =>
      hub.reserve({ stationId: station.id, connectorId: dc.id, vehicleId: otherVehicle.id, start: "2026-05-01T10:30:00Z", end: "2026-05-01T11:30:00Z" }),
    ).toThrow(/already reserved/);
    // Back-to-back is fine.
    hub.reserve({ stationId: station.id, connectorId: dc.id, vehicleId: otherVehicle.id, start: "2026-05-01T11:00:00Z", end: "2026-05-01T11:30:00Z" });
  });

  it("validates reservation length", () => {
    const { hub, station, dc, vehicle } = ctx;
    expect(() =>
      hub.reserve({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, start: "2026-05-01T10:00:00Z", end: "2026-05-01T10:05:00Z" }),
    ).toThrow(/between 15 and 240/);
  });

  it("holds a reserved connector for its driver and fulfils the reservation on plug-in", () => {
    const { hub, station, dc, vehicle, otherVehicle, setNow } = ctx;
    const r = hub.reserve({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, start: "2026-05-01T10:00:00Z", end: "2026-05-01T11:00:00Z" });

    setNow("2026-05-01T09:50:00Z"); // inside the 15-minute early-arrival window
    expect(() =>
      hub.startSession({ stationId: station.id, connectorId: dc.id, vehicleId: otherVehicle.id, startMeterWh: 0 }),
    ).toThrow(/reserved by another driver/);

    setNow("2026-05-01T10:05:00Z");
    expect(hub.availability(station.id)[0]!.status).toBe("reserved");
    const session = hub.startSession({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, startMeterWh: 0 });
    expect(session.reservationId).toBe(r.id);
    expect(hub.listReservations()[0]!.status).toBe("fulfilled");
  });

  it("cancels only booked reservations", () => {
    const { hub, station, dc, vehicle } = ctx;
    const r = hub.reserve({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, start: "2026-05-01T10:00:00Z", end: "2026-05-01T11:00:00Z" });
    expect(hub.cancelReservation(r.id).status).toBe("cancelled");
    expect(() => hub.cancelReservation(r.id)).toThrow(/cannot be cancelled/);
  });

  it("can't take a connector out of service mid-session", () => {
    const { hub, station, dc, ac, vehicle } = ctx;
    hub.startSession({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, startMeterWh: 0 });
    expect(() => hub.setConnectorOutOfService(station.id, dc.id, true)).toThrow(/active charging session/);
    hub.setConnectorOutOfService(station.id, ac.id, true);
    expect(hub.availability(station.id)[1]!.status).toBe("out_of_service");
  });
});

describe("car care", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.hub.seedDefaultCatalog();
  });

  it("seeds the catalog idempotently", () => {
    const n = ctx.hub.listCatalog().length;
    expect(n).toBeGreaterThan(5);
    expect(ctx.hub.seedDefaultCatalog()).toHaveLength(n);
  });

  it("books services back-to-back and auto-assigns a free bay", () => {
    const { hub, vehicle, otherVehicle } = ctx;
    const bay1 = hub.addBay("Bay 1");
    const bay2 = hub.addBay("Bay 2");
    const a = hub.bookAppointment({ vehicleId: vehicle.id, serviceCodes: ["BATT-HEALTH", "TIRE-ROTATE"], start: "2026-05-01T09:00:00Z" });
    expect(a.bayId).toBe(bay1.id);
    expect(a.end).toBe("2026-05-01T10:15:00.000Z"); // 45 + 30 min
    expect(a.total).toBe(8900 + 4900);

    const b = hub.bookAppointment({ vehicleId: otherVehicle.id, serviceCodes: ["SW-DIAG"], start: "2026-05-01T09:30:00Z" });
    expect(b.bayId).toBe(bay2.id);
    expect(() =>
      hub.bookAppointment({ vehicleId: otherVehicle.id, serviceCodes: ["CABIN-FILTER"], start: "2026-05-01T09:45:00Z" }),
    ).toThrow(/no bay is free/);
  });

  it("rejects unknown services and past start times", () => {
    const { hub, vehicle } = ctx;
    hub.addBay("Bay 1");
    expect(() => hub.bookAppointment({ vehicleId: vehicle.id, serviceCodes: ["NOPE"], start: "2026-05-01T09:00:00Z" })).toThrow(/unknown care service/);
    expect(() => hub.bookAppointment({ vehicleId: vehicle.id, serviceCodes: ["SW-DIAG"], start: "2026-04-30T09:00:00Z" })).toThrow(/future/);
  });

  it("enforces the appointment lifecycle and frees the bay on cancel", () => {
    const { hub, vehicle } = ctx;
    hub.addBay("Bay 1");
    const a = hub.bookAppointment({ vehicleId: vehicle.id, serviceCodes: ["SW-DIAG"], start: "2026-05-01T09:00:00Z" });
    expect(() => hub.completeAppointment(a.id)).toThrow(/expected in_progress/);
    hub.cancelAppointment(a.id);
    hub.bookAppointment({ vehicleId: vehicle.id, serviceCodes: ["SW-DIAG"], start: "2026-05-01T09:00:00Z" });
  });
});

describe("reporting", () => {
  it("combines charging and care revenue for a period", () => {
    const { hub, station, dc, vehicle, customer } = setup();
    hub.seedDefaultCatalog();
    hub.addBay("Bay 1");

    const s = hub.startSession({ stationId: station.id, connectorId: dc.id, vehicleId: vehicle.id, startMeterWh: 0 });
    hub.stopSession(s.id, { endMeterWh: 20_000, at: "2026-05-01T08:30:00Z" }); // $9.00

    const a = hub.bookAppointment({ vehicleId: vehicle.id, serviceCodes: ["DETAIL-EXT", "CABIN-FILTER"], start: "2026-05-01T09:00:00Z" });
    hub.startAppointment(a.id);
    hub.completeAppointment(a.id);

    const report = hub.revenueReport("2026-05-01T00:00:00Z", "2026-05-02T00:00:00Z");
    expect(report.charging).toEqual({ sessions: 1, energyWh: 20_000, energy: 900, idle: 0, total: 900 });
    expect(report.care.total).toBe(6900 + 3900);
    expect(report.care.byService[0]).toEqual({ code: "DETAIL-EXT", count: 1, total: 6900 });
    expect(report.total).toBe(900 + 10800);

    expect(hub.customerStatement(customer.id).total).toBe(900 + 10800);
    expect(hub.revenueReport("2026-05-02T00:00:00Z", "2026-05-03T00:00:00Z").total).toBe(0);
  });
});
