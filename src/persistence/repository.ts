/**
 * Persistence for Books state. A repository stores the raw accounts and
 * journal entries; a Books instance is rehydrated from them on load.
 *
 * Two implementations are provided with no native dependencies:
 *   - InMemoryRepository: ephemeral, for tests and development.
 *   - JsonFileRepository: durable, single-file JSON snapshot.
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { type Account } from "../domain/accounts.js";
import { type JournalEntry } from "../domain/journal.js";

export interface BooksState {
  accounts: Account[];
  entries: JournalEntry[];
}

export interface BooksRepository {
  load(): Promise<BooksState>;
  save(state: BooksState): Promise<void>;
}

export class InMemoryRepository implements BooksRepository {
  private state: BooksState;
  constructor(initial: BooksState = { accounts: [], entries: [] }) {
    this.state = structuredClone(initial);
  }
  async load(): Promise<BooksState> {
    return structuredClone(this.state);
  }
  async save(state: BooksState): Promise<void> {
    this.state = structuredClone(state);
  }
}

export class JsonFileRepository implements BooksRepository {
  constructor(private readonly path: string) {}

  async load(): Promise<BooksState> {
    if (!existsSync(this.path)) return { accounts: [], entries: [] };
    const raw = await readFile(this.path, "utf8");
    if (!raw.trim()) return { accounts: [], entries: [] };
    const parsed = JSON.parse(raw) as Partial<BooksState>;
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  }

  async save(state: BooksState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Write to a temp file then rename, so a crash can't leave a half-written file.
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
    await rename(tmp, this.path);
  }
}
