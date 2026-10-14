import { randomUUID } from "node:crypto";

export type IdGenerator = () => string;

export const uuidGenerator: IdGenerator = () => randomUUID();

/** Deterministic, monotonic generator — useful for tests and reproducible seeds. */
export function sequentialGenerator(prefix = "id"): IdGenerator {
  let n = 0;
  return () => `${prefix}_${(++n).toString().padStart(6, "0")}`;
}
