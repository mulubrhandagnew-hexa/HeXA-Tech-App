/**
 * Chart of accounts and account-type semantics for double-entry bookkeeping.
 */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

/** The side of the ledger on which an account type normally carries a positive balance. */
export type NormalBalance = "debit" | "credit";

export const NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
};

export interface Account {
  id: string;
  /** Human-facing account code, e.g. "4000" for revenue. */
  code: string;
  name: string;
  type: AccountType;
  /** Optional tax category key (see src/tax/categories.ts). */
  taxCategory?: string;
  archived?: boolean;
}

export class AccountError extends Error {}

export function normalBalanceOf(type: AccountType): NormalBalance {
  return NORMAL_BALANCE[type];
}

/**
 * A minimal, sensible default chart of accounts for a small service business.
 * Codes follow the common convention: 1xxx assets, 2xxx liabilities,
 * 3xxx equity, 4xxx income, 5xxx+ expenses.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: ReadonlyArray<Omit<Account, "id">> = [
  { code: "1000", name: "Cash / Bank", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2200", name: "Sales Tax Payable", type: "liability" },
  { code: "3000", name: "Owner's Equity", type: "equity" },
  { code: "3900", name: "Retained Earnings", type: "equity" },
  { code: "4000", name: "Service Revenue", type: "income", taxCategory: "gross_receipts" },
  { code: "5000", name: "Contractor & Labor", type: "expense", taxCategory: "contract_labor" },
  { code: "5100", name: "Software & Subscriptions", type: "expense", taxCategory: "office_expense" },
  { code: "5200", name: "Advertising & Marketing", type: "expense", taxCategory: "advertising" },
  { code: "5300", name: "Office & Supplies", type: "expense", taxCategory: "supplies" },
  { code: "5400", name: "Travel", type: "expense", taxCategory: "travel" },
  { code: "5500", name: "Meals", type: "expense", taxCategory: "meals" },
  { code: "5600", name: "Professional Fees", type: "expense", taxCategory: "legal_professional" },
  { code: "5900", name: "Bank & Processing Fees", type: "expense", taxCategory: "other" },
];
