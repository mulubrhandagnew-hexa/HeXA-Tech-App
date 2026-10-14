import { describe, it, expect, beforeEach } from "vitest";
import { Books } from "./books.js";
import { sequentialGenerator } from "../domain/ids.js";
import { AccountError } from "../domain/accounts.js";

function freshBooks(): Books {
  const books = new Books(sequentialGenerator("x"));
  books.seedDefaultChart();
  return books;
}

describe("Books service", () => {
  let books: Books;
  beforeEach(() => {
    books = freshBooks();
  });

  it("seeds a default chart of accounts", () => {
    const accounts = books.listAccounts();
    expect(accounts.length).toBeGreaterThanOrEqual(10);
    expect(books.getAccountByCode("4000")?.type).toBe("income");
    expect(books.getAccountByCode("1000")?.type).toBe("asset");
  });

  it("rejects duplicate account codes", () => {
    expect(() => books.createAccount({ code: "1000", name: "Dup", type: "asset" })).toThrow(AccountError);
  });

  it("records an invoice as a balanced receivable/revenue entry", () => {
    const rev = books.getAccountByCode("4000")!;
    const ar = books.getAccountByCode("1100")!;
    const entry = books.recordInvoice({
      date: "2026-01-10",
      revenueAccountId: rev.id,
      amount: 50000,
      description: "Consulting",
      reference: "INV-1",
    });
    expect(entry.lines).toContainEqual({ accountId: ar.id, debit: 50000, credit: 0 });
    expect(entry.lines).toContainEqual({ accountId: rev.id, debit: 0, credit: 50000 });
  });

  it("enforces account-type expectations", () => {
    const cash = books.getAccountByCode("1000")!;
    expect(() =>
      books.recordInvoice({ date: "2026-01-10", revenueAccountId: cash.id, amount: 100, description: "bad" }),
    ).toThrow(/expected income/);
  });

  it("records an expense and reflects it in the P&L", () => {
    const cash = books.getAccountByCode("1000")!;
    const software = books.getAccountByCode("5100")!;
    books.recordExpense({
      date: "2026-02-01",
      expenseAccountId: software.id,
      paidFromAccountId: cash.id,
      amount: 2500,
      description: "SaaS",
    });
    const pnl = books.profitAndLoss();
    expect(pnl.totalExpenses).toBe(2500);
    expect(pnl.netIncome).toBe(-2500);
  });

  it("produces a balanced trial balance and balance sheet", () => {
    const rev = books.getAccountByCode("4000")!;
    const cash = books.getAccountByCode("1000")!;
    const ar = books.getAccountByCode("1100")!;
    const software = books.getAccountByCode("5100")!;

    books.recordInvoice({ date: "2026-01-10", revenueAccountId: rev.id, amount: 100000, description: "Job" });
    books.recordPayment({
      date: "2026-01-20",
      toAccountId: cash.id,
      fromAccountId: ar.id,
      amount: 100000,
      description: "Paid",
    });
    books.recordExpense({
      date: "2026-01-25",
      expenseAccountId: software.id,
      paidFromAccountId: cash.id,
      amount: 15000,
      description: "Tools",
    });

    const tb = books.trialBalance();
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);

    const bs = books.balanceSheet();
    expect(bs.balanced).toBe(true);
    // Cash 1000.00 - 150.00 = 850.00; equity rolled from net income 850.00.
    expect(bs.totalAssets).toBe(85000);
    expect(bs.totalLiabilities + bs.totalEquity).toBe(85000);
    expect(bs.retainedFromActivity).toBe(85000);
  });

  it("filters reports by date window", () => {
    const rev = books.getAccountByCode("4000")!;
    books.recordInvoice({ date: "2026-01-10", revenueAccountId: rev.id, amount: 10000, description: "Jan" });
    books.recordInvoice({ date: "2026-02-10", revenueAccountId: rev.id, amount: 20000, description: "Feb" });

    const jan = books.profitAndLoss({ from: "2026-01-01", to: "2026-01-31" });
    expect(jan.totalIncome).toBe(10000);
    const all = books.profitAndLoss();
    expect(all.totalIncome).toBe(30000);
  });

  it("rehydrates from snapshot state", () => {
    const rev = books.getAccountByCode("4000")!;
    books.recordInvoice({ date: "2026-01-10", revenueAccountId: rev.id, amount: 12345, description: "x" });
    const restored = Books.hydrate(books.listAccounts(), books.listEntries(), sequentialGenerator("y"));
    expect(restored.profitAndLoss().totalIncome).toBe(12345);
    expect(restored.listAccounts().length).toBe(books.listAccounts().length);
  });
});
