/**
 * Service requests and their lifecycle:
 *
 *   requested → matched → en_route → arrived → in_service → awaiting_confirmation → completed
 *
 * A request can be cancelled up to `in_service`. A provider can decline a
 * matched job, which returns it to `requested` for re-matching.
 */
import { type Cents } from "./money.js";
import { type GeoPoint } from "./geo.js";
import { type ServiceBill, type ServiceCode, type ServiceOffering } from "./catalog.js";

export type RequestStatus =
  | "requested"
  | "matched"
  | "en_route"
  | "arrived"
  | "in_service"
  | "awaiting_confirmation"
  | "completed"
  | "cancelled";

/** Where the request came from: the customer app, a fleet manager, or the vehicle itself. */
export type RequestSource = "app" | "fleet" | "autonomous_api";

export interface ServiceLocation extends GeoPoint {
  address?: string;
}

export interface Rating {
  stars: number;
  comment?: string;
}

export interface ServiceRequest {
  id: string;
  customerId: string;
  vehicleId: string;
  serviceCode: ServiceCode;
  source: RequestSource;
  location: ServiceLocation;
  notes?: string;
  /** Price snapshot at request time. */
  quote: Pick<ServiceOffering, "calloutFee" | "unit" | "unitPrice">;
  status: RequestStatus;
  providerId?: string;
  /** Providers who declined this job; they are skipped when re-matching. */
  declinedBy: string[];
  etaMinutes?: number;
  requestedAt: string;
  matchedAt?: string;
  arrivedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  cancellationFee?: Cents;
  bill?: ServiceBill;
  rating?: Rating;
}

/** Requests that occupy a provider. */
export const ACTIVE_JOB_STATUSES: RequestStatus[] = ["matched", "en_route", "arrived", "in_service"];
