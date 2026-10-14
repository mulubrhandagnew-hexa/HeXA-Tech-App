/**
 * The Ledger aggregates accounts and posted journal entries, and computes
 * balances. It is a pure in-memory projection — persistence lives elsewhere.
 */
import {
  type Account,
  type AccountType,
  AccountError,
  normalBalanceOf,
} from "./accounts.js";
import { type Cents } from "./money.js";
import { type JournalEntry } from "./journal.js";

export interface AccountBalance {
  account: Account;
  /** Net balance in cents expressed in the account's *normal* sign. */
  balance: Cents;
  totalDebit: Cents;
  totalCredit: Cents;
}

export interface TrialBalanceRow {
  account: Account;
  debit: Cents;
  credit: Cents;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: Cents;
  totalCredit: Cents;
  balanced: boolean;
}

export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly entries: JournalEntry[] = [];

  addAccount(account: Account): void {
    if (this.accounts.has(account.id)) {
      throw new AccountError(`Duplicate account id: ${account.id}`);
    }
    for (const existing of this.accounts.values()) {
      if (existing.code === account.code) {
        throw new AccountError(`Duplicate account code: ${account.code}`);
      }
    }
    this.accounts.set(account.id, account);
  }

  getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  listAccounts(): Account[] {
    return [...this.accounts.values()].sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Post a validated entry. Every line must reference a known account.
   */
  post(entry: JournalEntry): void {
    for (const line of entry.lines) {
      if (!this.accounts.has(line.accountId)) {
        throw new AccountError(`Entry ${entry.id} references unknown account ${line.accountId}`);
      }
    }
    this.entries.push(entry);
  }

  listEntries(): JournalEntry[] {
    return [...this.entries].sort((a, b) =>
      a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date),
    );
  }

  /** Raw debit-positive balance (debits - credits) for an account over an optional date window. */
  private rawBalance(accountId: string, from?: string, to?: string): { debit: Cents; credit: Cents } {
    let debit = 0;
    let credit = 0;
    for (const entry of this.entries) {
      if (from && entry.date < from) continue;
      if (to && entry.date > to) continue;
      for (const line of entry.lines) {
        if (line.accountId !== accountId) continue;
        debit += line.debit;
        credit += line.credit;
      }
    }
    return { debit, credit };
  }

  /** Balance in the account's normal sign (positive = normal side). */
  balanceOf(accountId: string, opts: { from?: string; to?: string } = {}): AccountBalance {
    const account = this.accounts.get(accountId);
    if (!account) throw new AccountError(`Unknown account: ${accountId}`);
    const { debit, credit } = this.rawBalance(accountId, opts.from, opts.to);
    const signed = normalBalanceOf(account.type) === "debit" ? debit - credit : credit - debit;
    return { account, balance: signed, totalDebit: debit, totalCredit: credit };
  }

  balancesByType(type: AccountType, opts: { from?: string; to?: string } = {}): AccountBalance[] {
    return this.listAccounts()
      .filter((a) => a.type === type)
      .map((a) => this.balanceOf(a.id, opts));
  }

  /**
   * Trial balance as of (optionally) a cutoff date. Debits and credits must
   * be equal for a consistent set of balanced entries.
   */
  trialBalance(opts: { asOf?: string } = {}): TrialBalance {
    const rows: TrialBalanceRow[] = [];
    let totalDebit = 0;
    let totalCredit = 0;
    for (const account of this.listAccounts()) {
      const { debit, credit } = this.rawBalance(account.id, undefined, opts.asOf);
      const net = debit - credit;
      if (net === 0 && debit === 0 && credit === 0) continue;
      const row: TrialBalanceRow =
        net >= 0
          ? { account, debit: net, credit: 0 }
          : { account, debit: 0, credit: -net };
      rows.push(row);
      totalDebit += row.debit;
      totalCredit += row.credit;
    }
    return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
  }
}
