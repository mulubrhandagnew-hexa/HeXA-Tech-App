/**
 * Journal entries: the atomic, balanced transactions of the ledger.
 * Every entry must have total debits == total credits, and each line must
 * carry a positive amount on exactly one side.
 */
import { assertCents, type Cents } from "./money.js";

export interface JournalLine {
  accountId: string;
  /** Debit amount in cents (0 if this line is a credit). */
  debit: Cents;
  /** Credit amount in cents (0 if this line is a debit). */
  credit: Cents;
  memo?: string;
}

export interface JournalEntry {
  id: string;
  /** ISO date (YYYY-MM-DD) the transaction is effective. */
  date: string;
  description: string;
  lines: JournalLine[];
  /** Optional reference, e.g. invoice number or external id. */
  reference?: string;
  createdAt: string;
}

export class JournalError extends Error {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(date);
}

export interface DraftLine {
  accountId: string;
  debit?: Cents;
  credit?: Cents;
  memo?: string;
}

export interface DraftEntry {
  date: string;
  description: string;
  lines: DraftLine[];
  reference?: string;
}

/**
 * Validate and normalize a draft entry. Throws JournalError if unbalanced
 * or otherwise malformed. Returns normalized lines (debit/credit defaulted to 0).
 */
export function validateDraft(draft: DraftEntry): JournalLine[] {
  if (!isValidIsoDate(draft.date)) {
    throw new JournalError(`Invalid entry date: "${draft.date}" (expected YYYY-MM-DD)`);
  }
  if (!draft.description || !draft.description.trim()) {
    throw new JournalError("Entry description is required");
  }
  if (!Array.isArray(draft.lines) || draft.lines.length < 2) {
    throw new JournalError("A journal entry needs at least two lines");
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const normalized: JournalLine[] = draft.lines.map((line, i) => {
    const debit = assertCents(line.debit ?? 0, `line ${i} debit`);
    const credit = assertCents(line.credit ?? 0, `line ${i} credit`);
    if (debit < 0 || credit < 0) {
      throw new JournalError(`Line ${i}: amounts must be non-negative`);
    }
    if (debit === 0 && credit === 0) {
      throw new JournalError(`Line ${i}: must have a debit or a credit`);
    }
    if (debit > 0 && credit > 0) {
      throw new JournalError(`Line ${i}: cannot be both a debit and a credit`);
    }
    if (!line.accountId) {
      throw new JournalError(`Line ${i}: accountId is required`);
    }
    totalDebit += debit;
    totalCredit += credit;
    const normalizedLine: JournalLine = { accountId: line.accountId, debit, credit };
    if (line.memo !== undefined) normalizedLine.memo = line.memo;
    return normalizedLine;
  });

  if (totalDebit !== totalCredit) {
    throw new JournalError(
      `Entry is not balanced: debits ${totalDebit} != credits ${totalCredit}`,
    );
  }
  return normalized;
}
