/**
 * Tax summary and *estimate*. This is a planning aid, not tax advice and not a
 * filing. All rates are configurable; the defaults are deliberately simple
 * placeholders and must be reviewed against current law before real use.
 */
import { type Cents } from "../domain/money.js";
import { type Books } from "../service/books.js";
import { getTaxCategory } from "./categories.js";

export interface TaxCategorySummary {
  key: string;
  label: string;
  kind: "income" | "expense";
  amount: Cents;
}

export interface TaxSummary {
  from?: string;
  to?: string;
  categories: TaxCategorySummary[];
  grossIncome: Cents;
  totalDeductions: Cents;
  /** Income minus categorized deductible expenses; floored at 0 for tax purposes. */
  netProfit: Cents;
  /** Accounts with no taxCategory assigned; their amounts are excluded from the summary. */
  uncategorizedAccountCodes: string[];
}

/**
 * Aggregate income and expense balances by their account tax category over a
 * period. Accounts lacking a taxCategory are reported separately rather than
 * silently folded in.
 */
export function taxSummary(books: Books, opts: { from?: string; to?: string } = {}): TaxSummary {
  const totals = new Map<string, Cents>();
  const uncategorized: string[] = [];

  for (const type of ["income", "expense"] as const) {
    for (const bal of books.view.balancesByType(type, opts)) {
      if (bal.balance === 0) continue;
      const key = bal.account.taxCategory;
      if (!key || !getTaxCategory(key)) {
        uncategorized.push(bal.account.code);
        continue;
      }
      totals.set(key, (totals.get(key) ?? 0) + bal.balance);
    }
  }

  const categories: TaxCategorySummary[] = [];
  let grossIncome = 0;
  let totalDeductions = 0;
  for (const [key, amount] of totals) {
    const cat = getTaxCategory(key)!;
    categories.push({ key, label: cat.label, kind: cat.kind, amount });
    if (cat.kind === "income") grossIncome += amount;
    else totalDeductions += amount;
  }
  categories.sort((a, b) => a.key.localeCompare(b.key));

  const result: TaxSummary = {
    categories,
    grossIncome,
    totalDeductions,
    netProfit: Math.max(0, grossIncome - totalDeductions),
    uncategorizedAccountCodes: [...new Set(uncategorized)].sort(),
  };
  if (opts.from !== undefined) result.from = opts.from;
  if (opts.to !== undefined) result.to = opts.to;
  return result;
}

export interface TaxBracket {
  /** Upper bound of this bracket in cents, or null for the top (open-ended) bracket. */
  upTo: Cents | null;
  /** Marginal rate as a fraction, e.g. 0.12 for 12%. */
  rate: number;
}

export interface TaxRateConfig {
  /** Combined self-employment rate applied to net profit (e.g. 0.153). */
  selfEmploymentRate: number;
  /**
   * Portion of SE tax that is deductible before income tax (the employer-equivalent
   * half). Set 0.5 to mirror the common US treatment, 0 to disable.
   */
  selfEmploymentDeductibleFraction: number;
  /** Progressive income-tax brackets applied to taxable income. */
  incomeBrackets: TaxBracket[];
}

/**
 * Placeholder defaults — simplified, single-filer-ish, NOT current-law exact.
 * Override with real, reviewed values before using for anything that matters.
 */
export const DEFAULT_RATE_CONFIG: TaxRateConfig = {
  selfEmploymentRate: 0.153,
  selfEmploymentDeductibleFraction: 0.5,
  incomeBrackets: [
    { upTo: 1160000, rate: 0.1 },
    { upTo: 4715000, rate: 0.12 },
    { upTo: 10052500, rate: 0.22 },
    { upTo: null, rate: 0.24 },
  ],
};

export interface TaxEstimate {
  netProfit: Cents;
  selfEmploymentTax: Cents;
  taxableIncome: Cents;
  incomeTax: Cents;
  totalEstimatedTax: Cents;
  /** Effective rate against net profit, as a fraction. */
  effectiveRate: number;
  disclaimer: string;
}

function roundCents(value: number): Cents {
  return Math.round(value);
}

function progressiveTax(taxable: Cents, brackets: TaxBracket[]): Cents {
  let tax = 0;
  let lower = 0;
  for (const bracket of brackets) {
    const upper = bracket.upTo ?? Infinity;
    if (taxable <= lower) break;
    const slice = Math.min(taxable, upper) - lower;
    if (slice > 0) tax += slice * bracket.rate;
    lower = upper;
  }
  return roundCents(tax);
}

/**
 * Estimate total tax on net profit using a simplified SE + progressive income
 * model. Intended for rough quarterly planning only.
 */
export function estimateTax(netProfit: Cents, config: TaxRateConfig = DEFAULT_RATE_CONFIG): TaxEstimate {
  const profit = Math.max(0, netProfit);
  const seTax = roundCents(profit * config.selfEmploymentRate);
  const seDeduction = roundCents(seTax * config.selfEmploymentDeductibleFraction);
  const taxableIncome = Math.max(0, profit - seDeduction);
  const incomeTax = progressiveTax(taxableIncome, config.incomeBrackets);
  const total = seTax + incomeTax;
  return {
    netProfit: profit,
    selfEmploymentTax: seTax,
    taxableIncome,
    incomeTax,
    totalEstimatedTax: total,
    effectiveRate: profit > 0 ? total / profit : 0,
    disclaimer:
      "Estimate only. Uses simplified, configurable rates and does not account for " +
      "deductions, credits, filing status, or current law. Not tax advice.",
  };
}
