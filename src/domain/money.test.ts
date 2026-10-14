import { describe, it, expect } from "vitest";
import { toCents, formatCents, addCents, assertCents, MoneyError } from "./money.js";

describe("money", () => {
  it("parses decimal strings to cents", () => {
    expect(toCents("19.99")).toBe(1999);
    expect(toCents("0.05")).toBe(5);
    expect(toCents("100")).toBe(10000);
    expect(toCents("-3.50")).toBe(-350);
    expect(toCents("1.5")).toBe(150);
  });

  it("parses numbers to cents", () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(100)).toBe(10000);
  });

  it("rejects more than two decimal places", () => {
    expect(() => toCents("1.234")).toThrow(MoneyError);
    expect(() => toCents("abc")).toThrow(MoneyError);
  });

  it("formats cents back to decimal", () => {
    expect(formatCents(1999)).toBe("19.99");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-350)).toBe("-3.50");
    expect(formatCents(10000)).toBe("100.00");
  });

  it("round-trips", () => {
    for (const v of ["0.00", "12.34", "-99.01", "1000000.99"]) {
      expect(formatCents(toCents(v))).toBe(v);
    }
  });

  it("adds cents and rejects non-integers", () => {
    expect(addCents(100, 200, 50)).toBe(350);
    expect(() => assertCents(1.5)).toThrow(MoneyError);
  });
});
