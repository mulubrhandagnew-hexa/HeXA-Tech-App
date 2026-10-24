import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonFileRepository } from "./repository.js";
import { Hub, emptyState } from "../service/hub.js";

describe("JsonFileRepository", () => {
  it("returns empty state when the file is missing or blank", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hub-"));
    try {
      const path = join(dir, "hub.json");
      expect(await new JsonFileRepository(path).load()).toEqual(emptyState());
      await writeFile(path, "  ");
      expect(await new JsonFileRepository(path).load()).toEqual(emptyState());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips hub state, including settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hub-"));
    try {
      const path = join(dir, "nested", "hub.json");
      const repo = new JsonFileRepository(path);
      const hub = new Hub();
      hub.seedDefaultCatalog();
      hub.updateSettings({ commissionBps: 1500 });
      const c = hub.addCustomer({ kind: "individual", name: "Abebe" });
      hub.addVehicle(c.id, { make: "Tesla", model: "Model 3", connectorTypes: ["NACS"] });
      await repo.save(hub.snapshot());

      const restored = new Hub(await repo.load());
      expect(restored.snapshot()).toEqual(hub.snapshot());
      expect(JSON.parse(await readFile(path, "utf8")).settings.commissionBps).toBe(1500);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
