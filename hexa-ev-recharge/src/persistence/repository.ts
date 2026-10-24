/**
 * Persistence for Hub state, with no native dependencies:
 *   - InMemoryRepository: ephemeral, for tests and development.
 *   - JsonFileRepository: durable, single-file JSON snapshot.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { type HubState, emptyState } from "../service/hub.js";

export interface HubRepository {
  load(): Promise<HubState>;
  save(state: HubState): Promise<void>;
}

export class InMemoryRepository implements HubRepository {
  private state: HubState;
  constructor(initial: HubState = emptyState()) {
    this.state = structuredClone(initial);
  }
  async load(): Promise<HubState> {
    return structuredClone(this.state);
  }
  async save(state: HubState): Promise<void> {
    this.state = structuredClone(state);
  }
}

export class JsonFileRepository implements HubRepository {
  constructor(private readonly path: string) {}

  async load(): Promise<HubState> {
    if (!existsSync(this.path)) return emptyState();
    const raw = await readFile(this.path, "utf8");
    if (!raw.trim()) return emptyState();
    const parsed = JSON.parse(raw) as Partial<HubState>;
    const state = emptyState();
    return {
      settings: { ...state.settings, ...(parsed.settings ?? {}) },
      customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      catalog: Array.isArray(parsed.catalog) ? parsed.catalog : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
    };
  }

  async save(state: HubState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Write to a temp file then rename, so a crash can't leave a half-written file.
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}
