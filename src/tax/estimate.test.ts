import { describe, it, expect } from "vitest";
import { Books } from "../service/books.js";
import { sequentialGenerator } from "../domain/ids.js";
import { taxSummary, estimateTax, DEFAULT_RATE_CONFIG } from "./estimate.js";

function seededBooks(): Books {
  const books = new Books(sequentialGenerator("t"));
  books.seedDefaultChart();
  return books;
}

describe("tax summary", () => {
  it("aggregates income and expenses by tax category", () => {
    const books = seededBooks();
    const rev = books.getAccountByCode("4000")!;
    const cash = books.getAccountByCode("1000")!;
    const ads = books.getAccountByCode("5200")!;

    books.recordInvoice({ date: "2026-03-01", revenueAccountId: rev.id, amount: 500000, description: "Rev" });
    books.recordExpense({
      date: "2026-03-05",
      expenseAccountId: ads.id,
      paidFromAccountId: cash.id,
      amount: 100000,
      description: "Ads",
    });

    const summary = taxSummary(books);
    expect(summary.grossIncome).toBe(500000);
    expect(summary.totalDeductions).toBe(100000);
    expect(summary.netProfit).toBe(400000);
    expect(summary.categories.find((c) => c.key === "advertising")?.amount).toBe(100000);
    expect(summary.uncategorizedAccountCodes).toEqual([]);
  });

  it("flags accounts with no tax category instead of folding them in", () => {
    const books = seededBooks();
    const rev = books.getAccountByCode("4000")!;
    const cash = books.getAccountByCode("1000")!;
    const misc = books.createAccount({ code: "5950", name: "Uncategorized", type: "expense" });

    books.recordInvoice({ date: "2026-03-01", revenueAccountId: rev.id, amount: 100000, description: "Rev" });
    books.recordExpense({
      date: "2026-03-02",
      expenseAccountId: misc.id,
      paidFromAccountId: cash.id,
      amount: 5000,
      description: "mystery",
    });

    const summary = taxSummary(books);
    expect(summary.totalDeductions).toBe(0);
    expect(summary.uncategorizedAccountCodes).toContain("5950");
  });
});

describe("tax estimate", () => {
  it("returns zero for no profit", () => {
    const est = estimateTax(0);
    expect(est.totalEstimatedTax).toBe(0);
    expect(est.effectiveRate).toBe(0);
  });

  it("floors negative profit at zero", () => {
    expect(estimateTax(-5000).totalEstimatedTax).toBe(0);
  });

  it("computes SE tax plus progressive income tax", () => {
    // netProfit = $10,000.00 = 1,000,000 cents
    const est = estimateTax(1_000_000, DEFAULT_RATE_CONFIG);
    // SE: 1,000,000 * 0.153 = 153,000
    expect(est.selfEmploymentTax).toBe(153000);
    // taxable income: 1,000,000 - 76,500 (half of SE) = 923,500
    expect(est.taxableIncome).toBe(923500);
    // income tax: first 1,160,000 bracket at 10% covers it -> 92,350
    expect(est.incomeTax).toBe(92350);
    expect(est.totalEstimatedTax).toBe(153000 + 92350);
    expect(est.effectiveRate).toBeCloseTo((153000 + 92350) / 1_000_000, 6);
  });

  it("applies higher brackets progressively", () => {
    const est = estimateTax(20_000_000, DEFAULT_RATE_CONFIG);
    // Spans multiple brackets; total must be positive and below the top marginal rate overall.
    expect(est.incomeTax).toBeGreaterThan(0);
    expect(est.effectiveRate).toBeLessThan(0.4);
  });

  it("carries a disclaimer", () => {
    expect(estimateTax(100000).disclaimer).toMatch(/not tax advice/i);
  });
});
