import { describe, it, expect, beforeEach } from "vitest";
import { Hub } from "./hub.js";
import { sequentialGenerator } from "../domain/ids.js";
import { toMs } from "../domain/time.js";

// Downtown LA and a few nearby points.
const DOWNTOWN = { latitude: 34.0522, longitude: -118.2437 };
const NEAR = { latitude: 34.06, longitude: -118.25 }; // < 1 mile
const MID = { latitude: 34.1, longitude: -118.3 }; // ~4.6 miles
const FAR = { latitude: 34.0094, longitude: -118.4973 }; // ~14 miles

function setup() {
  let now = toMs("2026-05-01T08:00:00Z");
  const hub = new Hub(undefined, sequentialGenerator("h"), () => now);
  hub.seedDefaultCatalog();
  const owner = hub.addCustomer({ kind: "individual", name: "Abebe" });
  const car = hub.addVehicle(owner.id, { make: "Hyundai", model: "Ioniq 5", connectorTypes: ["CCS1"] });
  const fleet = hub.addCustomer({ kind: "fleet", name: "Ops desk", company: "Metro Vans" });
  const van1 = hub.addVehicle(fleet.id, { make: "Ford", model: "E-Transit", connectorTypes: ["CCS1"] });
  const van2 = hub.addVehicle(fleet.id, { make: "Rivian", model: "EDV", connectorTypes: ["CCS1"], autonomous: true });

  const activeProvider = (name: string, at: typeof DOWNTOWN, services: Parameters<Hub["applyAsProvider"]>[0]["services"], connectors: Array<"CCS1" | "NACS"> = ["CCS1"]) => {
    const p = hub.applyAsProvider({ name, services, connectorTypes: connectors, serviceRadiusMiles: 10 });
    hub.verifyProvider(p.id);
    return hub.setProviderOnline(p.id, true, at);
  };
  return {
    hub,
    owner,
    car,
    fleet,
    van1,
    van2,
    activeProvider,
    advance: (minutes: number) => (now += minutes * 60_000),
  };
}

describe("providers", () => {
  it("must be verified before going online", () => {
    const { hub } = setup();
    const p = hub.applyAsProvider({ name: "Sam", services: ["DETAILING"], serviceRadiusMiles: 5 });
    expect(p.status).toBe("pending");
    expect(() => hub.setProviderOnline(p.id, true, DOWNTOWN)).toThrow(/pending/);
    hub.verifyProvider(p.id);
    expect(hub.setProviderOnline(p.id, true, DOWNTOWN).online).toBe(true);
  });

  it("charging providers must declare their connectors", () => {
    const { hub } = setup();
    expect(() => hub.applyAsProvider({ name: "X", services: ["MOBILE_CHARGING"], serviceRadiusMiles: 5 })).toThrow(/connectors/);
  });
});

describe("matching", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("picks the nearest eligible provider and skips the wrong skills, connectors and range", () => {
    const { hub, car, activeProvider } = ctx;
    const mid = activeProvider("Mid", MID, ["MOBILE_CHARGING"]);
    activeProvider("Near but detailer", NEAR, ["DETAILING"]);
    activeProvider("Near but NACS only", NEAR, ["MOBILE_CHARGING"], ["NACS"]);
    activeProvider("Out of range", FAR, ["MOBILE_CHARGING"]);

    const r = hub.requestService({ vehicleId: car.id, serviceCode: "MOBILE_CHARGING", location: DOWNTOWN });
    expect(hub.candidates(r.id).map((c) => c.provider.name)).toEqual(["Mid"]);
    const matched = hub.match(r.id);
    expect(matched.providerId).toBe(mid.id);
    expect(matched.etaMinutes).toBeGreaterThan(5);
  });

  it("keeps busy and offline providers out, and reports when nobody is available", () => {
    const { hub, car, van1, activeProvider } = ctx;
    const p = activeProvider("Solo", NEAR, ["MOBILE_CHARGING"]);
    const a = hub.requestService({ vehicleId: car.id, serviceCode: "MOBILE_CHARGING", location: DOWNTOWN });
    hub.match(a.id);
    const b = hub.requestService({ vehicleId: van1.id, serviceCode: "MOBILE_CHARGING", location: DOWNTOWN });
    expect(() => hub.match(b.id)).toThrow(/no provider is available/);

    hub.cancel(a.id);
    hub.setProviderOnline(p.id, false);
    expect(hub.candidates(b.id)).toHaveLength(0);
  });

  it("re-matches to someone else after a decline", () => {
    const { hub, car, activeProvider } = ctx;
    const first = activeProvider("First", NEAR, ["TIRE"]);
    const second = activeProvider("Second", MID, ["TIRE"]);
    const r = hub.requestService({ vehicleId: car.id, serviceCode: "TIRE", location: DOWNTOWN });
    expect(hub.match(r.id).providerId).toBe(first.id);
    expect(hub.decline(r.id, first.id).status).toBe("requested");
    expect(hub.match(r.id).providerId).toBe(second.id);
  });

  it("refuses a duplicate open request for the same vehicle and service", () => {
    const { hub, car } = ctx;
    hub.requestService({ vehicleId: car.id, serviceCode: "DETAILING", location: DOWNTOWN });
    expect(() => hub.requestService({ vehicleId: car.id, serviceCode: "DETAILING", location: DOWNTOWN })).toThrow(/already has an open/);
  });
});

describe("job lifecycle", () => {
  it("runs Request → Match → Track → Service → Complete and pays everyone correctly", () => {
    const { hub, car, owner, activeProvider, advance } = setup();
    const p = activeProvider("Charger Van 1", MID, ["MOBILE_CHARGING"]);
    const r = hub.requestService({ vehicleId: car.id, serviceCode: "MOBILE_CHARGING", location: { ...DOWNTOWN, address: "Office garage, level 2" } });

    hub.match(r.id);
    const enRoute = hub.depart(r.id, p.id);
    hub.updateProviderLocation(p.id, NEAR);
    expect(hub.getRequest(r.id).etaMinutes).toBeLessThan(enRoute.etaMinutes!);

    advance(15);
    hub.arrive(r.id, p.id);
    hub.startService(r.id, p.id);
    advance(60);
    const finished = hub.finishService(r.id, p.id, 40_000); // 40 kWh
    expect(finished.status).toBe("awaiting_confirmation");
    // $25.00 call-out + 40 kWh × $0.55 = $47.00; 20% commission = $9.40
    expect(finished.bill).toEqual({ callout: 2500, quantity: 40_000, metered: 2200, total: 4700, platformFee: 940, providerPayout: 3760 });

    hub.confirm(r.id, { stars: 5, comment: "Charged while I worked" });
    expect(hub.customerStatement(owner.id).total).toBe(4700);
    const earnings = hub.providerEarnings(p.id);
    expect(earnings.total).toBe(3760);
    expect(earnings.averageRating).toBe(5);
  });

  it("only lets the assigned provider move the job, in order", () => {
    const { hub, car, activeProvider } = setup();
    const p = activeProvider("A", NEAR, ["BATTERY_12V"]);
    const other = activeProvider("B", MID, ["BATTERY_12V"]);
    const r = hub.requestService({ vehicleId: car.id, serviceCode: "BATTERY_12V", location: DOWNTOWN });
    hub.match(r.id);
    expect(() => hub.depart(r.id, other.id)).toThrow(/not assigned/);
    expect(() => hub.arrive(r.id, p.id)).toThrow(/expected en_route/);
    expect(() => hub.finishService(r.id, p.id)).toThrow(/expected in_service/);
  });

  it("cancels free before departure and charges the call-out fee after", () => {
    const { hub, car, owner, fleet, van1, activeProvider } = setup();
    activeProvider("A", NEAR, ["ROADSIDE"]);

    const free = hub.requestService({ vehicleId: car.id, serviceCode: "ROADSIDE", location: DOWNTOWN });
    hub.match(free.id);
    expect(hub.cancel(free.id).cancellationFee).toBeUndefined();

    const late = hub.requestService({ vehicleId: van1.id, serviceCode: "ROADSIDE", location: DOWNTOWN });
    const matched = hub.match(late.id);
    hub.depart(late.id, matched.providerId!);
    expect(hub.cancel(late.id).cancellationFee).toBe(8900);
    expect(hub.customerStatement(owner.id).total).toBe(0);
    expect(hub.customerStatement(fleet.id).total).toBe(8900);
  });

  it("can't cancel once work has started", () => {
    const { hub, car, activeProvider } = setup();
    const p = activeProvider("A", NEAR, ["DETAILING"]);
    const r = hub.requestService({ vehicleId: car.id, serviceCode: "DETAILING", location: DOWNTOWN });
    hub.match(r.id);
    hub.depart(r.id, p.id);
    hub.arrive(r.id, p.id);
    hub.startService(r.id, p.id);
    expect(() => hub.cancel(r.id)).toThrow(/in_service cannot be cancelled/);
  });

  it("quotes the price at request time even if the catalog changes", () => {
    const { hub, car } = setup();
    const r = hub.requestService({ vehicleId: car.id, serviceCode: "MOBILE_CHARGING", location: DOWNTOWN });
    hub.updateOffering("MOBILE_CHARGING", { unitPrice: 99 });
    expect(hub.getRequest(r.id).quote.unitPrice).toBe(55);
    expect(() => hub.updateOffering("DETAILING", { unitPrice: 10 })).toThrow(/not metered/);
  });
});

describe("fleets and autonomous vehicles", () => {
  it("books several fleet vehicles at once, all or nothing", () => {
    const { hub, fleet, van1, van2, car } = setup();
    const made = hub.requestFleetService(fleet.id, [
      { vehicleId: van1.id, serviceCode: "MOBILE_CHARGING", location: DOWNTOWN },
      { vehicleId: van2.id, serviceCode: "ADAS_SENSOR", location: DOWNTOWN },
    ]);
    expect(made.map((r) => r.source)).toEqual(["fleet", "fleet"]);

    const before = hub.listRequests().length;
    expect(() =>
      hub.requestFleetService(fleet.id, [
        { vehicleId: van1.id, serviceCode: "TIRE", location: DOWNTOWN },
        { vehicleId: car.id, serviceCode: "TIRE", location: DOWNTOWN }, // not a fleet vehicle
      ]),
    ).toThrow(/does not belong/);
    expect(hub.listRequests()).toHaveLength(before);
  });

  it("keeps the autonomous API off until enabled, then only for autonomous vehicles", () => {
    const { hub, van1, van2 } = setup();
    const req = { vehicleId: van2.id, serviceCode: "MOBILE_CHARGING" as const, location: DOWNTOWN };
    expect(() => hub.requestService(req, "autonomous_api")).toThrow(/not yet active/);
    hub.updateSettings({ autonomousApiEnabled: true });
    expect(hub.requestService(req, "autonomous_api").source).toBe("autonomous_api");
    expect(() => hub.requestService({ ...req, vehicleId: van1.id }, "autonomous_api")).toThrow(/not registered as autonomous/);
  });
});

describe("reporting", () => {
  it("splits gross revenue into platform fees and provider payouts", () => {
    const { hub, car, van1, activeProvider } = setup();
    const p = activeProvider("A", NEAR, ["DETAILING", "TOWING"]);
    const run = (vehicleId: string, code: "DETAILING" | "TOWING", qty: number) => {
      const r = hub.requestService({ vehicleId, serviceCode: code, location: DOWNTOWN });
      hub.match(r.id, p.id);
      hub.depart(r.id, p.id);
      hub.arrive(r.id, p.id);
      hub.startService(r.id, p.id);
      hub.finishService(r.id, p.id, qty);
      hub.confirm(r.id);
    };
    run(car.id, "DETAILING", 0); // $79.00
    run(van1.id, "TOWING", 12_500); // $125.00 + 12.5 mi × $4.50 = $181.25

    const report = hub.revenueReport("2026-05-01T00:00:00Z", "2026-05-02T00:00:00Z");
    expect(report.jobs).toBe(2);
    expect(report.gross).toBe(7900 + 18125);
    expect(report.platformFees + report.providerPayouts).toBe(report.gross);
    expect(report.byService[0]).toEqual({ code: "TOWING", jobs: 1, gross: 18125 });
    expect(hub.revenueReport("2026-05-02T00:00:00Z", "2026-05-03T00:00:00Z").gross).toBe(0);
  });
});
