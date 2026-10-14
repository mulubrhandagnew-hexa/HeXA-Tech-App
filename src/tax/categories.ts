/**
 * Tax categories loosely modeled on US IRS Schedule C (Form 1040) expense
 * lines, with a generic "gross_receipts" for income. These are mapping keys
 * only — they carry no filing logic and are safe to extend per jurisdiction.
 */
export interface TaxCategory {
  key: string;
  label: string;
  /** "income" categories increase gross receipts; "expense" reduce taxable profit. */
  kind: "income" | "expense";
  /** Optional reference to a schedule line, informational only. */
  scheduleLine?: string;
}

export const TAX_CATEGORIES: ReadonlyArray<TaxCategory> = [
  { key: "gross_receipts", label: "Gross receipts or sales", kind: "income", scheduleLine: "Sch C, Line 1" },
  { key: "advertising", label: "Advertising", kind: "expense", scheduleLine: "Sch C, Line 8" },
  { key: "contract_labor", label: "Contract labor", kind: "expense", scheduleLine: "Sch C, Line 11" },
  { key: "legal_professional", label: "Legal & professional services", kind: "expense", scheduleLine: "Sch C, Line 17" },
  { key: "office_expense", label: "Office expense", kind: "expense", scheduleLine: "Sch C, Line 18" },
  { key: "supplies", label: "Supplies", kind: "expense", scheduleLine: "Sch C, Line 22" },
  { key: "travel", label: "Travel", kind: "expense", scheduleLine: "Sch C, Line 24a" },
  { key: "meals", label: "Deductible meals", kind: "expense", scheduleLine: "Sch C, Line 24b" },
  { key: "other", label: "Other expenses", kind: "expense", scheduleLine: "Sch C, Line 27a" },
];

const BY_KEY = new Map(TAX_CATEGORIES.map((c) => [c.key, c]));

export function getTaxCategory(key: string): TaxCategory | undefined {
  return BY_KEY.get(key);
}

export function isKnownTaxCategory(key: string): boolean {
  return BY_KEY.has(key);
}
