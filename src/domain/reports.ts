/**
 * Financial statements derived from a Ledger: Profit & Loss and Balance Sheet.
 */
import { type Cents } from "./money.js";
import { type Account } from "./accounts.js";
import { type Ledger, type AccountBalance } from "./ledger.js";

export interface LineItem {
  account: Account;
  amount: Cents;
}

export interface ProfitAndLoss {
  from?: string;
  to?: string;
  income: LineItem[];
  expenses: LineItem[];
  totalIncome: Cents;
  totalExpenses: Cents;
  netIncome: Cents;
}

export interface BalanceSheet {
  asOf?: string;
  assets: LineItem[];
  liabilities: LineItem[];
  equity: LineItem[];
  /** Net income for all activity up to `asOf`, rolled into equity. */
  retainedFromActivity: Cents;
  totalAssets: Cents;
  totalLiabilities: Cents;
  totalEquity: Cents;
  /** True when assets == liabilities + equity (the accounting equation holds). */
  balanced: boolean;
}

function toLineItems(balances: AccountBalance[]): { items: LineItem[]; total: Cents } {
  const items = balances
    .filter((b) => b.balance !== 0)
    .map((b) => ({ account: b.account, amount: b.balance }));
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  return { items, total };
}

export function profitAndLoss(ledger: Ledger, opts: { from?: string; to?: string } = {}): ProfitAndLoss {
  const income = toLineItems(ledger.balancesByType("income", opts));
  const expenses = toLineItems(ledger.balancesByType("expense", opts));
  const result: ProfitAndLoss = {
    income: income.items,
    expenses: expenses.items,
    totalIncome: income.total,
    totalExpenses: expenses.total,
    netIncome: income.total - expenses.total,
  };
  if (opts.from !== undefined) result.from = opts.from;
  if (opts.to !== undefined) result.to = opts.to;
  return result;
}

export function balanceSheet(ledger: Ledger, opts: { asOf?: string } = {}): BalanceSheet {
  const window = opts.asOf ? { to: opts.asOf } : {};
  const assets = toLineItems(ledger.balancesByType("asset", window));
  const liabilities = toLineItems(ledger.balancesByType("liability", window));
  const equity = toLineItems(ledger.balancesByType("equity", window));

  // Net income earned through the period is not yet journaled into a retained
  // earnings account, so surface it explicitly so the sheet balances.
  const pnl = profitAndLoss(ledger, window);
  const retained = pnl.netIncome;

  const totalEquity = equity.total + retained;
  const result: BalanceSheet = {
    assets: assets.items,
    liabilities: liabilities.items,
    equity: equity.items,
    retainedFromActivity: retained,
    totalAssets: assets.total,
    totalLiabilities: liabilities.total,
    totalEquity,
    balanced: assets.total === liabilities.total + totalEquity,
  };
  if (opts.asOf !== undefined) result.asOf = opts.asOf;
  return result;
}
