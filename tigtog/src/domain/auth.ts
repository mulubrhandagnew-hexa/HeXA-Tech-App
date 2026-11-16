/**
 * Password hashing (scrypt) and session tokens, using only node:crypto.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from "node:crypto";

const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(): string {
  return randomUUID();
}

/** Extract unique, lowercase #hashtags from a caption, in order of appearance. */
export function parseHashtags(caption: string): string[] {
  const seen = new Set<string>();
  for (const m of caption.matchAll(/#([\p{L}\p{N}_]{1,50})/gu)) {
    seen.add(m[1]!.toLowerCase());
  }
  return [...seen];
}
