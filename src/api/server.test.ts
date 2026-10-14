import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createServer } from "./server.js";
import { Books } from "../service/books.js";
import { sequentialGenerator } from "../domain/ids.js";
import { InMemoryRepository } from "../persistence/repository.js";

function app() {
  const books = new Books(sequentialGenerator("a"));
  return createServer({ books, repository: new InMemoryRepository() });
}

describe("REST API", () => {
  let server: ReturnType<typeof app>;
  beforeEach(() => {
    server = app();
  });

  it("reports health", async () => {
    const res = await request(server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("hexa-books");
  });

  it("seeds accounts and records an invoice with decimal money input", async () => {
    await request(server).post("/accounts/seed-default").expect(201);
    const accounts = (await request(server).get("/accounts")).body.accounts as Array<{ id: string; code: string }>;
    const rev = accounts.find((a) => a.code === "4000")!;

    const res = await request(server)
      .post("/invoices")
      .send({ date: "2026-01-10", revenueAccountId: rev.id, amount: "1234.56", description: "Job" });
    expect(res.status).toBe(201);
    const debit = res.body.entry.lines.reduce((s: number, l: { debit: number }) => s + l.debit, 0);
    expect(debit).toBe(123456);
  });

  it("rejects an unbalanced manual entry with 400", async () => {
    await request(server).post("/accounts/seed-default");
    const accounts = (await request(server).get("/accounts")).body.accounts as Array<{ id: string; code: string }>;
    const a = accounts[0]!.id;
    const b = accounts[1]!.id;
    const res = await request(server)
      .post("/entries")
      .send({
        date: "2026-01-10",
        description: "bad",
        lines: [
          { accountId: a, debit: "10.00" },
          { accountId: b, credit: "9.00" },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("rejects malformed money with a validation error", async () => {
    await request(server).post("/accounts/seed-default");
    const accounts = (await request(server).get("/accounts")).body.accounts as Array<{ id: string; code: string }>;
    const rev = accounts.find((a) => a.code === "4000")!;
    const res = await request(server)
      .post("/invoices")
      .send({ date: "2026-01-10", revenueAccountId: rev.id, amount: "12.345", description: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("serves reports and a tax estimate", async () => {
    await request(server).post("/accounts/seed-default");
    const accounts = (await request(server).get("/accounts")).body.accounts as Array<{ id: string; code: string }>;
    const rev = accounts.find((a) => a.code === "4000")!;
    const cash = accounts.find((a) => a.code === "1000")!;
    const ads = accounts.find((a) => a.code === "5200")!;

    await request(server)
      .post("/invoices")
      .send({ date: "2026-01-10", revenueAccountId: rev.id, amount: "5000.00", description: "Rev" });
    await request(server)
      .post("/expenses")
      .send({ date: "2026-01-12", expenseAccountId: ads.id, paidFromAccountId: cash.id, amount: "1000.00", description: "Ads" });

    const pnl = await request(server).get("/reports/profit-loss");
    expect(pnl.body.netIncome).toBe(400000);

    const tax = await request(server).get("/tax/estimate");
    expect(tax.body.summary.netProfit).toBe(400000);
    expect(tax.body.estimate.totalEstimatedTax).toBeGreaterThan(0);
    expect(tax.body.estimate.disclaimer).toMatch(/not tax advice/i);
  });

  it("persists mutations to the repository", async () => {
    const repo = new InMemoryRepository();
    const books = new Books(sequentialGenerator("p"));
    const srv = createServer({ books, repository: repo });
    await request(srv).post("/accounts/seed-default").expect(201);
    const state = await repo.load();
    expect(state.accounts.length).toBeGreaterThan(0);
  });
});
