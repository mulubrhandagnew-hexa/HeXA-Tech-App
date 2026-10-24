/**
 * EV car care domain: a service catalog, service bays, and appointments.
 */
import { type Cents } from "./money.js";

export type CareCategory = "battery" | "tires" | "brakes" | "thermal" | "software" | "filters" | "detailing";

export interface CareService {
  code: string;
  name: string;
  category: CareCategory;
  durationMinutes: number;
  price: Cents;
}

export interface ServiceBay {
  id: string;
  name: string;
}

export type AppointmentStatus = "booked" | "in_progress" | "completed" | "cancelled";

export interface AppointmentLine {
  code: string;
  name: string;
  durationMinutes: number;
  /** Price snapshot at booking time. */
  price: Cents;
}

export interface CareAppointment {
  id: string;
  customerId: string;
  vehicleId: string;
  bayId: string;
  start: string;
  end: string;
  lines: AppointmentLine[];
  total: Cents;
  status: AppointmentStatus;
  notes?: string;
}

/** Default catalog of EV-focused services. Prices in cents. */
export const DEFAULT_CARE_CATALOG: CareService[] = [
  { code: "BATT-HEALTH", name: "High-voltage battery health diagnostic", category: "battery", durationMinutes: 45, price: 8900 },
  { code: "BATT-12V", name: "12V auxiliary battery test & replacement", category: "battery", durationMinutes: 30, price: 17900 },
  { code: "TIRE-ROTATE", name: "Tire rotation & pressure check", category: "tires", durationMinutes: 30, price: 4900 },
  { code: "TIRE-ALIGN", name: "Wheel alignment", category: "tires", durationMinutes: 60, price: 11900 },
  { code: "BRAKE-INSPECT", name: "Brake inspection & caliper service", category: "brakes", durationMinutes: 45, price: 7900 },
  { code: "BRAKE-FLUID", name: "Brake fluid flush", category: "brakes", durationMinutes: 30, price: 8900 },
  { code: "THERMAL-CHECK", name: "Battery coolant & thermal system check", category: "thermal", durationMinutes: 45, price: 9900 },
  { code: "SW-DIAG", name: "Software update & fault-code diagnostics", category: "software", durationMinutes: 30, price: 5900 },
  { code: "CABIN-FILTER", name: "Cabin air filter replacement", category: "filters", durationMinutes: 15, price: 3900 },
  { code: "DETAIL-EXT", name: "Exterior wash & detail", category: "detailing", durationMinutes: 60, price: 6900 },
  { code: "DETAIL-INT", name: "Interior deep clean", category: "detailing", durationMinutes: 90, price: 12900 },
];
