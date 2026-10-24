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
    const parsed = JSON.parse(raw) as Partial<Record<keyof HubState, unknown>>;
    const state = emptyState();
    for (const key of Object.keys(state) as Array<keyof HubState>) {
      const value = parsed[key];
      if (Array.isArray(value)) (state[key] as unknown[]) = value;
    }
    return state;
  }

  async save(state: HubState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Write to a temp file then rename, so a crash can't leave a half-written file.
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}
