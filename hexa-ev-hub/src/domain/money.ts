/**
 * Money is represented as an integer number of minor units (cents).
 * Floating-point math is never used for monetary amounts.
 */
export type Cents = number;

export class MoneyError extends Error {}

/** Assert a value is a valid integer cent amount. */
export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of cents, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} exceeds the safe integer range`);
  }
  return value;
}

/** Parse a decimal string or number of major units (e.g. "19.99", 19.99) into cents. */
export function toCents(amount: string | number): Cents {
  const str = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(str)) {
    throw new MoneyError(`Invalid money amount: "${amount}" (expected up to 2 decimal places)`);
  }
  const negative = str.startsWith("-");
  const [whole, frac = ""] = str.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return assertCents(negative ? -cents : cents);
}

/** Format cents as a decimal string in major units (e.g. 1999 -> "19.99"). */
export function formatCents(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function addCents(...values: Cents[]): Cents {
  return assertCents(values.reduce((sum, v) => sum + assertCents(v), 0));
}
