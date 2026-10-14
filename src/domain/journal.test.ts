import { describe, it, expect } from "vitest";
import { validateDraft, isValidIsoDate, JournalError } from "./journal.js";

describe("journal validation", () => {
  it("accepts a balanced entry", () => {
    const lines = validateDraft({
      date: "2026-01-15",
      description: "Sale",
      lines: [
        { accountId: "a", debit: 1000 },
        { accountId: "b", credit: 1000 },
      ],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ accountId: "a", debit: 1000, credit: 0 });
    expect(lines[1]).toEqual({ accountId: "b", debit: 0, credit: 1000 });
  });

  it("rejects an unbalanced entry", () => {
    expect(() =>
      validateDraft({
        date: "2026-01-15",
        description: "Bad",
        lines: [
          { accountId: "a", debit: 1000 },
          { accountId: "b", credit: 900 },
        ],
      }),
    ).toThrow(/not balanced/);
  });

  it("rejects fewer than two lines", () => {
    expect(() =>
      validateDraft({ date: "2026-01-15", description: "x", lines: [{ accountId: "a", debit: 1 }] }),
    ).toThrow(JournalError);
  });

  it("rejects a line with both debit and credit", () => {
    expect(() =>
      validateDraft({
        date: "2026-01-15",
        description: "x",
        lines: [
          { accountId: "a", debit: 100, credit: 100 },
          { accountId: "b", credit: 100 },
        ],
      }),
    ).toThrow(/both a debit and a credit/);
  });

  it("rejects negative amounts", () => {
    expect(() =>
      validateDraft({
        date: "2026-01-15",
        description: "x",
        lines: [
          { accountId: "a", debit: -100 },
          { accountId: "b", credit: -100 },
        ],
      }),
    ).toThrow(JournalError);
  });

  it("rejects invalid dates", () => {
    expect(isValidIsoDate("2026-01-15")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("not-a-date")).toBe(false);
    expect(() =>
      validateDraft({
        date: "2026-13-01",
        description: "x",
        lines: [
          { accountId: "a", debit: 1 },
          { accountId: "b", credit: 1 },
        ],
      }),
    ).toThrow(/Invalid entry date/);
  });
});
