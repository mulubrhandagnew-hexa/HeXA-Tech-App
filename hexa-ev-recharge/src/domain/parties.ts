/**
 * The people and vehicles on the platform: customers (individual EV owners
 * and fleets), their vehicles, and independent service providers.
 */
import { type GeoPoint } from "./geo.js";
import { type ServiceCode } from "./catalog.js";

export const CONNECTOR_TYPES = ["CCS1", "CCS2", "CHAdeMO", "NACS", "Type2", "J1772"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export type CustomerKind = "individual" | "fleet";

export interface Customer {
  id: string;
  kind: CustomerKind;
  name: string;
  /** Company name for fleet accounts. */
  company?: string;
  email?: string;
  phone?: string;
}

export interface Vehicle {
  id: string;
  customerId: string;
  make: string;
  model: string;
  year?: number;
  plate?: string;
  /** Charging inlets the vehicle accepts. Empty means unknown and is not enforced. */
  connectorTypes: ConnectorType[];
  /** Self-driving vehicle that may request service through the autonomous API. */
  autonomous: boolean;
}

/** Providers apply, are verified by the platform, and can be suspended. */
export type ProviderStatus = "pending" | "active" | "suspended";

export interface Provider {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  services: ServiceCode[];
  /** Connectors the provider's mobile charging equipment supports. */
  connectorTypes: ConnectorType[];
  status: ProviderStatus;
  /** Provider has switched themselves on to receive requests. */
  online: boolean;
  location?: GeoPoint;
  serviceRadiusMiles: number;
  ratingTotal: number;
  ratingCount: number;
}
