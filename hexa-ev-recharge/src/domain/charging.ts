/**
 * EV recharge domain: stations, connectors, reservations, charging sessions,
 * and the pricing rules that turn metered energy into a bill.
 *
 * Energy is metered in integer watt-hours (Wh); prices are integer cents.
 */
import { type Cents, assertCents } from "./money.js";
import { HubError } from "./errors.js";
import { MINUTE_MS } from "./time.js";

export const CONNECTOR_TYPES = ["CCS1", "CCS2", "CHAdeMO", "NACS", "Type2", "J1772"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export interface Connector {
  id: string;
  type: ConnectorType;
  maxPowerKw: number;
  /** Energy price per kWh, in cents. */
  pricePerKwh: Cents;
  /** Fee per minute a vehicle stays plugged in after charging finished (beyond the grace period). */
  idleFeePerMinute: Cents;
  outOfService: boolean;
}

export interface Station {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  connectors: Connector[];
}

export type ReservationStatus = "booked" | "fulfilled" | "cancelled";

export interface Reservation {
  id: string;
  stationId: string;
  connectorId: string;
  customerId: string;
  vehicleId: string;
  start: string;
  end: string;
  status: ReservationStatus;
}

export type SessionStatus = "active" | "completed";

export interface ChargingSession {
  id: string;
  stationId: string;
  connectorId: string;
  customerId: string;
  vehicleId: string;
  reservationId?: string;
  startedAt: string;
  startMeterWh: number;
  /** Price snapshot taken at start, so later price changes don't rewrite the bill. */
  pricePerKwh: Cents;
  idleFeePerMinute: Cents;
  status: SessionStatus;
  endedAt?: string;
  endMeterWh?: number;
  /** When the vehicle stopped drawing power; idle fees accrue from here (plus grace) to endedAt. */
  chargingCompletedAt?: string;
  bill?: ChargingBill;
}

export interface ChargingBill {
  energyWh: number;
  energy: Cents;
  idleMinutes: number;
  idle: Cents;
  total: Cents;
}

/** Minutes a vehicle may remain plugged in after charging before idle fees start. */
export const IDLE_GRACE_MINUTES = 10;

/** Reservations: at least 15 minutes, at most 4 hours. */
export const MIN_RESERVATION_MINUTES = 15;
export const MAX_RESERVATION_MINUTES = 240;

/** Energy cost, rounded half-up to the nearest cent: Wh × (cents/kWh) / 1000. */
export function energyCost(energyWh: number, pricePerKwh: Cents): Cents {
  if (!Number.isSafeInteger(energyWh) || energyWh < 0) {
    throw new HubError("invalid", `energy must be a non-negative integer of Wh, got ${energyWh}`);
  }
  assertCents(pricePerKwh, "pricePerKwh");
  return assertCents(Math.floor((energyWh * pricePerKwh + 500) / 1000));
}

/** Whole minutes billable as idle time: (unplugged − charging complete) − grace, floored at zero. */
export function idleMinutes(chargingCompletedMs: number, endedMs: number): number {
  const minutes = Math.floor((endedMs - chargingCompletedMs) / MINUTE_MS) - IDLE_GRACE_MINUTES;
  return Math.max(0, minutes);
}

export function computeBill(input: {
  startMeterWh: number;
  endMeterWh: number;
  pricePerKwh: Cents;
  idleFeePerMinute: Cents;
  chargingCompletedMs?: number;
  endedMs: number;
}): ChargingBill {
  const energyWh = input.endMeterWh - input.startMeterWh;
  if (energyWh < 0) throw new HubError("invalid", "end meter reading is below the start reading");
  const energy = energyCost(energyWh, input.pricePerKwh);
  const idleMins =
    input.chargingCompletedMs === undefined ? 0 : idleMinutes(input.chargingCompletedMs, input.endedMs);
  const idle = assertCents(idleMins * input.idleFeePerMinute);
  return { energyWh, energy, idleMinutes: idleMins, idle, total: energy + idle };
}
