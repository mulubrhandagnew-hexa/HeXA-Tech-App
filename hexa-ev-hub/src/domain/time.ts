/**
 * Timestamps are ISO-8601 strings with an explicit offset (e.g. "2026-05-01T09:00:00Z").
 * They are parsed to epoch milliseconds for comparison only.
 */
import { HubError } from "./errors.js";

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const MINUTE_MS = 60_000;

/** Parse an ISO timestamp to epoch ms, rejecting values without a timezone offset. */
export function toMs(iso: string, label = "timestamp"): number {
  if (!ISO_WITH_OFFSET.test(iso)) {
    throw new HubError("invalid", `${label} must be an ISO-8601 timestamp with offset, got "${iso}"`);
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new HubError("invalid", `${label} is not a valid date: "${iso}"`);
  return ms;
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Half-open interval overlap: [aStart, aEnd) intersects [bStart, bEnd). */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
