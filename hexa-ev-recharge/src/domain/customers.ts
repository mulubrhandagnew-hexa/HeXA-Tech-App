import { type ConnectorType } from "./charging.js";

export interface Customer {
  id: string;
  name: string;
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
  batteryKwh?: number;
  /** Connector types the vehicle can accept. Empty means "unknown" and is not enforced. */
  connectorTypes: ConnectorType[];
}
