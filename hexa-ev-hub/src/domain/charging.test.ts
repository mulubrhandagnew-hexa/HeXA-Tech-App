import { describe, it, expect } from "vitest";
import { computeBill, energyCost, idleMinutes, IDLE_GRACE_MINUTES } from "./charging.js";
import { HubError } from "./errors.js";
import { MINUTE_MS, overlaps, toMs } from "./time.js";

describe("energy pricing", () => {
  it("prices watt-hours at a per-kWh rate in integer cents", () => {
    expect(energyCost(42_000, 45)).toBe(1890); // 42 kWh × $0.45
    expect(energyCost(0, 45)).toBe(0);
  });

  it("rounds half-up to the nearest cent", () => {
    expect(energyCost(1_010, 45)).toBe(45); // 45.45¢
    expect(energyCost(1_100, 45)).toBe(50); // 49.5¢ → 50¢
  });

  it("rejects fractional or negative energy", () => {
    expect(() => energyCost(1.5, 45)).toThrow(HubError);
    expect(() => energyCost(-1, 45)).toThrow(HubError);
  });
});

describe("idle fees", () => {
  it("only bills whole minutes past the grace period", () => {
    const done = toMs("2026-05-01T10:00:00Z");
    expect(idleMinutes(done, done + IDLE_GRACE_MINUTES * MINUTE_MS)).toBe(0);
    expect(idleMinutes(done, done + (IDLE_GRACE_MINUTES + 7) * MINUTE_MS + 30_000)).toBe(7);
  });

  it("combines energy and idle into a bill", () => {
    const done = toMs("2026-05-01T10:00:00Z");
    const bill = computeBill({
      startMeterWh: 1_000,
      endMeterWh: 31_000,
      pricePerKwh: 50,
      idleFeePerMinute: 40,
      chargingCompletedMs: done,
      endedMs: done + 25 * MINUTE_MS,
    });
    expect(bill).toEqual({ energyWh: 30_000, energy: 1500, idleMinutes: 15, idle: 600, total: 2100 });
  });

  it("rejects a meter that runs backwards", () => {
    expect(() =>
      computeBill({ startMeterWh: 10, endMeterWh: 5, pricePerKwh: 50, idleFeePerMinute: 0, endedMs: 0 }),
    ).toThrow(/below the start/);
  });
});

describe("time helpers", () => {
  it("requires an explicit offset", () => {
    expect(() => toMs("2026-05-01T10:00:00")).toThrow(HubError);
    expect(toMs("2026-05-01T12:00:00+02:00")).toBe(toMs("2026-05-01T10:00:00Z"));
  });

  it("treats intervals as half-open", () => {
    expect(overlaps(0, 10, 10, 20)).toBe(false);
    expect(overlaps(0, 11, 10, 20)).toBe(true);
  });
});
