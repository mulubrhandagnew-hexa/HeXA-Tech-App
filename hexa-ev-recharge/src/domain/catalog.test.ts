import { describe, it, expect } from "vitest";
import { computeBill, meteredCost } from "./catalog.js";
import { distanceMiles, etaMinutes, ETA_BUFFER_MINUTES } from "./geo.js";
import { toMs } from "./time.js";
import { HubError } from "./errors.js";

describe("metered pricing", () => {
  it("prices milli-units at a per-unit rate in integer cents", () => {
    expect(meteredCost(40_000, 55)).toBe(2200); // 40 kWh × $0.55
    expect(meteredCost(0, 55)).toBe(0);
  });

  it("rounds half-up to the nearest cent", () => {
    expect(meteredCost(1_010, 45)).toBe(45); // 45.45¢
    expect(meteredCost(1_100, 45)).toBe(50); // 49.5¢
  });

  it("rejects fractional or negative quantities", () => {
    expect(() => meteredCost(1.5, 45)).toThrow(HubError);
    expect(() => meteredCost(-1, 45)).toThrow(HubError);
  });
});

describe("bills", () => {
  it("adds call-out and metered charges and splits commission", () => {
    const bill = computeBill({ calloutFee: 2500, unit: "kwh", unitPrice: 55 }, 30_000, 2000);
    expect(bill).toEqual({ callout: 2500, quantity: 30_000, metered: 1650, total: 4150, platformFee: 830, providerPayout: 3320 });
  });

  it("bills flat services with no quantity", () => {
    const bill = computeBill({ calloutFee: 7900 }, 0, 2000);
    expect(bill.total).toBe(7900);
    expect(bill.platformFee + bill.providerPayout).toBe(7900);
    expect(() => computeBill({ calloutFee: 7900 }, 10, 2000)).toThrow(/not metered/);
  });

  it("rounds the commission half-up and never loses a cent", () => {
    const bill = computeBill({ calloutFee: 1003 }, 0, 2500); // 250.75¢
    expect(bill.platformFee).toBe(251);
    expect(bill.providerPayout).toBe(752);
  });
});

describe("geo", () => {
  it("measures great-circle distance in miles", () => {
    // Downtown LA to Santa Monica pier: ~14 miles.
    const d = distanceMiles({ latitude: 34.0522, longitude: -118.2437 }, { latitude: 34.0094, longitude: -118.4973 });
    expect(d).toBeGreaterThan(14);
    expect(d).toBeLessThan(15);
  });

  it("estimates ETA from distance plus a setup buffer", () => {
    const here = { latitude: 34.05, longitude: -118.24 };
    expect(etaMinutes(here, here)).toBe(ETA_BUFFER_MINUTES);
  });

  it("requires timestamps with an offset", () => {
    expect(() => toMs("2026-05-01T10:00:00")).toThrow(HubError);
    expect(toMs("2026-05-01T12:00:00+02:00")).toBe(toMs("2026-05-01T10:00:00Z"));
  });
});
