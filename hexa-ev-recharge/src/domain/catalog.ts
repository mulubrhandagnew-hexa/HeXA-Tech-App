/**
 * The mobile service catalog and its pricing.
 *
 * Every service has a call-out fee. Metered services also charge per unit
 * (kWh delivered for mobile charging, miles towed for recovery). Quantities
 * are integer milli-units (1 kWh = 1000 Wh, 1 mile = 1000 milli-miles), so
 * no floating-point value ever reaches a price.
 */
import { type Cents, assertCents } from "./money.js";
import { HubError } from "./errors.js";

export const SERVICE_CODES = [
  "MOBILE_CHARGING",
  "DETAILING",
  "BATTERY_12V",
  "ROADSIDE",
  "INSPECTION",
  "ADAS_SENSOR",
  "TOWING",
  "TIRE",
] as const;
export type ServiceCode = (typeof SERVICE_CODES)[number];

export type MeteredUnit = "kwh" | "mile";

export interface ServiceOffering {
  code: ServiceCode;
  name: string;
  description: string;
  calloutFee: Cents;
  /** Present for metered services. */
  unit?: MeteredUnit;
  unitPrice?: Cents;
  /** Typical on-site time, used for scheduling estimates. */
  estimatedMinutes: number;
}

export const DEFAULT_CATALOG: ServiceOffering[] = [
  { code: "MOBILE_CHARGING", name: "Mobile EV charging", description: "Charging delivered to your parked EV.", calloutFee: 2500, unit: "kwh", unitPrice: 55, estimatedMinutes: 60 },
  { code: "DETAILING", name: "Mobile cleaning & detailing", description: "Exterior wash and interior clean at the vehicle.", calloutFee: 7900, estimatedMinutes: 75 },
  { code: "BATTERY_12V", name: "12V battery service", description: "Low-voltage battery test, jump and replacement.", calloutFee: 6900, estimatedMinutes: 30 },
  { code: "ROADSIDE", name: "Roadside assistance", description: "Help when unexpected vehicle problems occur.", calloutFee: 8900, estimatedMinutes: 45 },
  { code: "INSPECTION", name: "Vehicle inspection", description: "Multi-point EV inspection and diagnostics scan.", calloutFee: 9900, estimatedMinutes: 45 },
  { code: "ADAS_SENSOR", name: "ADAS & sensor service", description: "Camera, radar and sensor cleaning.", calloutFee: 5900, estimatedMinutes: 30 },
  { code: "TOWING", name: "Towing & recovery", description: "Breakdown and disabled vehicle recovery.", calloutFee: 12500, unit: "mile", unitPrice: 450, estimatedMinutes: 60 },
  { code: "TIRE", name: "Tire service", description: "Low pressure, flat tires and replacement.", calloutFee: 7500, estimatedMinutes: 40 },
];

/** Price of a metered quantity, rounded half-up to the cent: milli-units × unit price / 1000. */
export function meteredCost(milliUnits: number, unitPrice: Cents): Cents {
  if (!Number.isSafeInteger(milliUnits) || milliUnits < 0) {
    throw new HubError("invalid", `quantity must be a non-negative integer of milli-units, got ${milliUnits}`);
  }
  assertCents(unitPrice, "unitPrice");
  return assertCents(Math.floor((milliUnits * unitPrice + 500) / 1000));
}

export interface ServiceBill {
  callout: Cents;
  quantity: number;
  metered: Cents;
  total: Cents;
  /** The platform's commission, rounded half-up. */
  platformFee: Cents;
  providerPayout: Cents;
}

/** Bill a completed job. `commissionBps` is the platform's share in basis points (2000 = 20%). */
export function computeBill(
  quote: Pick<ServiceOffering, "calloutFee" | "unit" | "unitPrice">,
  quantity: number,
  commissionBps: number,
): ServiceBill {
  if (quote.unit === undefined && quantity !== 0) {
    throw new HubError("invalid", "this service is not metered; quantity must be 0");
  }
  const metered = quote.unit === undefined ? 0 : meteredCost(quantity, quote.unitPrice ?? 0);
  const total = quote.calloutFee + metered;
  const platformFee = Math.floor((total * commissionBps + 5000) / 10000);
  return { callout: quote.calloutFee, quantity, metered, total, platformFee, providerPayout: total - platformFee };
}
