/**
 * Books — the application service. Wraps a Ledger with id generation,
 * validation, and higher-level bookkeeping operations (invoices, expenses,
 * payments). This is the main entry point used by the API and persistence.
 */
import {
  type Account,
  type AccountType,
  AccountError,
  DEFAULT_CHART_OF_ACCOUNTS,
} from "../domain/accounts.js";
import { type Cents } from "../domain/money.js";
import {
  type DraftEntry,
  type JournalEntry,
  validateDraft,
} from "../domain/journal.js";
import { Ledger } from "../domain/ledger.js";
import { type IdGenerator, uuidGenerator } from "../domain/ids.js";
import {
  balanceSheet,
  profitAndLoss,
  type BalanceSheet,
  type ProfitAndLoss,
} from "../domain/reports.js";

export interface NewAccount {
  code: string;
  name: string;
  type: AccountType;
  taxCategory?: string;
}

export interface InvoiceInput {
  date: string;
  /** Account that receives the revenue (type: income). */
  revenueAccountId: string;
  /** Receivable/asset account to debit (defaults to Accounts Receivable by code 1100). */
  receivableAccountId?: string;
  amount: Cents;
  description: string;
  reference?: string;
}

export interface ExpenseInput {
  date: string;
  /** Expense account to debit. */
  expenseAccountId: string;
  /** Asset (cash/bank) or liability (payable) account to credit. */
  paidFromAccountId: string;
  amount: Cents;
  description: string;
  reference?: string;
}

export interface PaymentInput {
  date: string;
  /** Asset account that receives the money (e.g. Cash/Bank). */
  toAccountId: string;
  /** Account being cleared (e.g. Accounts Receivable). */
  fromAccountId: string;
  amount: Cents;
  description: string;
  reference?: string;
}

export class Books {
  private readonly ledger = new Ledger();
  constructor(private readonly nextId: IdGenerator = uuidGenerator) {}

  /** Rebuild a Books instance from persisted state. */
  static hydrate(accounts: Account[], entries: JournalEntry[], nextId: IdGenerator = uuidGenerator): Books {
    const books = new Books(nextId);
    for (const a of accounts) books.ledger.addAccount(a);
    for (const e of entries) books.ledger.post(e);
    return books;
  }

  /** Seed the default small-business chart of accounts. Returns created accounts. */
  seedDefaultChart(): Account[] {
    return DEFAULT_CHART_OF_ACCOUNTS.map((a) => this.createAccount(a));
  }

  createAccount(input: NewAccount): Account {
    const account: Account = {
      id: this.nextId(),
      code: input.code,
      name: input.name,
      type: input.type,
    };
    if (input.taxCategory !== undefined) account.taxCategory = input.taxCategory;
    this.ledger.addAccount(account);
    return account;
  }

  listAccounts(): Account[] {
    return this.ledger.listAccounts();
  }

  getAccountByCode(code: string): Account | undefined {
    return this.ledger.listAccounts().find((a) => a.code === code);
  }

  private requireAccount(id: string): Account {
    const a = this.ledger.getAccount(id);
    if (!a) throw new AccountError(`Unknown account: ${id}`);
    return a;
  }

  private expectType(id: string, type: AccountType): Account {
    const a = this.requireAccount(id);
    if (a.type !== type) {
      throw new AccountError(`Account ${a.code} is a ${a.type}, expected ${type}`);
    }
    return a;
  }

  recordEntry(draft: DraftEntry): JournalEntry {
    const lines = validateDraft(draft);
    const entry: JournalEntry = {
      id: this.nextId(),
      date: draft.date,
      description: draft.description.trim(),
      lines,
      createdAt: new Date().toISOString(),
    };
    if (draft.reference !== undefined) entry.reference = draft.reference;
    this.ledger.post(entry);
    return entry;
  }

  listEntries(): JournalEntry[] {
    return this.ledger.listEntries();
  }

  /** Record an issued invoice: debit receivable, credit revenue. */
  recordInvoice(input: InvoiceInput): JournalEntry {
    this.expectType(input.revenueAccountId, "income");
    const receivableId = input.receivableAccountId ?? this.getAccountByCode("1100")?.id;
    if (!receivableId) {
      throw new AccountError("No receivable account provided and no account with code 1100 found");
    }
    this.expectType(receivableId, "asset");
    return this.recordEntry({
      date: input.date,
      description: input.description,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      lines: [
        { accountId: receivableId, debit: input.amount },
        { accountId: input.revenueAccountId, credit: input.amount },
      ],
    });
  }

  /** Record a business expense: debit expense, credit the funding account. */
  recordExpense(input: ExpenseInput): JournalEntry {
    this.expectType(input.expenseAccountId, "expense");
    const funding = this.requireAccount(input.paidFromAccountId);
    if (funding.type !== "asset" && funding.type !== "liability") {
      throw new AccountError(`paidFrom account ${funding.code} must be an asset or liability`);
    }
    return this.recordEntry({
      date: input.date,
      description: input.description,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      lines: [
        { accountId: input.expenseAccountId, debit: input.amount },
        { accountId: input.paidFromAccountId, credit: input.amount },
      ],
    });
  }

  /** Record receipt of a payment: debit the asset received, credit the cleared account. */
  recordPayment(input: PaymentInput): JournalEntry {
    this.expectType(input.toAccountId, "asset");
    this.requireAccount(input.fromAccountId);
    return this.recordEntry({
      date: input.date,
      description: input.description,
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      lines: [
        { accountId: input.toAccountId, debit: input.amount },
        { accountId: input.fromAccountId, credit: input.amount },
      ],
    });
  }

  trialBalance(opts: { asOf?: string } = {}) {
    return this.ledger.trialBalance(opts);
  }

  profitAndLoss(opts: { from?: string; to?: string } = {}): ProfitAndLoss {
    return profitAndLoss(this.ledger, opts);
  }

  balanceSheet(opts: { asOf?: string } = {}): BalanceSheet {
    return balanceSheet(this.ledger, opts);
  }

  /** Expose the underlying ledger for read-only report composition (e.g. tax). */
  get view(): Ledger {
    return this.ledger;
  }
}
