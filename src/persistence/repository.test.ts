import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileRepository, InMemoryRepository } from "./repository.js";
import { Books } from "../service/books.js";
import { sequentialGenerator } from "../domain/ids.js";

describe("repositories", () => {
  it("in-memory isolates stored state from the caller's object", async () => {
    const repo = new InMemoryRepository();
    const state = { accounts: [], entries: [] };
    await repo.save(state);
    (state.accounts as unknown[]).push({ mutated: true });
    const loaded = await repo.load();
    expect(loaded.accounts).toHaveLength(0);
  });

  it("json file persists and reloads a full Books snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hexa-books-"));
    try {
      const path = join(dir, "books.json");
      const repo = new JsonFileRepository(path);

      const books = new Books(sequentialGenerator("f"));
      books.seedDefaultChart();
      const rev = books.getAccountByCode("4000")!;
      books.recordInvoice({ date: "2026-04-01", revenueAccountId: rev.id, amount: 99999, description: "x" });

      await repo.save({ accounts: books.listAccounts(), entries: books.listEntries() });

      const state = await new JsonFileRepository(path).load();
      const restored = Books.hydrate(state.accounts, state.entries);
      expect(restored.profitAndLoss().totalIncome).toBe(99999);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty state for a missing file", async () => {
    const repo = new JsonFileRepository("/nonexistent/path/does/not/exist.json");
    const state = await repo.load();
    expect(state).toEqual({ accounts: [], entries: [] });
  });
});
