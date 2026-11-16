/**
 * Persistence for Tigtog state (records only — media bytes live on disk in
 * the media directory, managed by the API layer).
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { type TigtogState, emptyState } from "../domain/types.js";

export interface TigtogRepository {
  load(): Promise<TigtogState>;
  save(state: TigtogState): Promise<void>;
}

export class InMemoryRepository implements TigtogRepository {
  private state: TigtogState;
  constructor(initial: TigtogState = emptyState()) {
    this.state = structuredClone(initial);
  }
  async load(): Promise<TigtogState> {
    return structuredClone(this.state);
  }
  async save(state: TigtogState): Promise<void> {
    this.state = structuredClone(state);
  }
}

export class JsonFileRepository implements TigtogRepository {
  constructor(private readonly path: string) {}

  async load(): Promise<TigtogState> {
    if (!existsSync(this.path)) return emptyState();
    const raw = await readFile(this.path, "utf8");
    if (!raw.trim()) return emptyState();
    const parsed = JSON.parse(raw) as Partial<TigtogState>;
    const base = emptyState();
    for (const key of Object.keys(base) as (keyof TigtogState)[]) {
      const v = parsed[key];
      if (Array.isArray(v)) (base[key] as unknown[]) = v;
    }
    return base;
  }

  async save(state: TigtogState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Write to a temp file then rename, so a crash can't leave a half-written file.
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}
