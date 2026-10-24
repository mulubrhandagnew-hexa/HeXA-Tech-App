/**
 * Hub — the application service for Mobile EV Recharge, an on-demand
 * marketplace where independent providers bring charging and vehicle
 * services to the vehicle. It owns customers, vehicles, providers, the
 * service catalog and service requests, and enforces the dispatch lifecycle:
 *
 *   Request → Match → Track (en route, ETA) → Service → Complete (confirm, pay, rate)
 */
import { type Cents, addCents } from "../domain/money.js";
import { type IdGenerator, uuidGenerator } from "../domain/ids.js";
import { HubError } from "../domain/errors.js";
import { toIso, toMs } from "../domain/time.js";
import { type GeoPoint, assertPoint, distanceMiles, etaMinutes } from "../domain/geo.js";
import {
  type ServiceCode,
  type ServiceOffering,
  DEFAULT_CATALOG,
  computeBill,
} from "../domain/catalog.js";
import { type ConnectorType, type Customer, type Provider, type Vehicle } from "../domain/parties.js";
import {
  type Rating,
  type RequestSource,
  type RequestStatus,
  type ServiceLocation,
  type ServiceRequest,
  ACTIVE_JOB_STATUSES,
} from "../domain/requests.js";

export interface HubSettings {
  /** Platform commission in basis points (2000 = 20%). */
  commissionBps: number;
  /** Vehicle-initiated requests from autonomous fleets. Off until the integration launches. */
  autonomousApiEnabled: boolean;
}

export const DEFAULT_SETTINGS: HubSettings = { commissionBps: 2000, autonomousApiEnabled: false };

export interface HubState {
  settings: HubSettings;
  customers: Customer[];
  vehicles: Vehicle[];
  providers: Provider[];
  catalog: ServiceOffering[];
  requests: ServiceRequest[];
}

export function emptyState(): HubState {
  return { settings: { ...DEFAULT_SETTINGS }, customers: [], vehicles: [], providers: [], catalog: [], requests: [] };
}

export type Clock = () => number;

export interface NewCustomer {
  kind: Customer["kind"];
  name: string;
  company?: string;
  email?: string;
  phone?: string;
}

export interface NewVehicle {
  make: string;
  model: string;
  year?: number;
  plate?: string;
  connectorTypes: ConnectorType[];
  autonomous?: boolean;
}

export interface ProviderApplication {
  name: string;
  email?: string;
  phone?: string;
  services: ServiceCode[];
  connectorTypes?: ConnectorType[];
  serviceRadiusMiles: number;
}

export interface NewRequest {
  vehicleId: string;
  serviceCode: ServiceCode;
  location: ServiceLocation;
  notes?: string;
}

export interface Candidate {
  provider: Provider;
  distanceMiles: number;
  etaMinutes: number;
}

export interface Statement {
  requests: ServiceRequest[];
  total: Cents;
}

export interface RevenueReport {
  from: string;
  to: string;
  jobs: number;
  cancellations: number;
  gross: Cents;
  platformFees: Cents;
  providerPayouts: Cents;
  byService: Array<{ code: ServiceCode; jobs: number; gross: Cents }>;
}

/** Statuses from which a customer may cancel. Once work starts, the job must be finished. */
const CANCELLABLE: RequestStatus[] = ["requested", "matched", "en_route", "arrived"];
/** Cancelling after the provider has set off costs the call-out fee. */
const CANCELLATION_FEE_STATUSES: RequestStatus[] = ["en_route", "arrived"];

export class Hub {
  private state: HubState;

  constructor(
    initial: HubState = emptyState(),
    private readonly ids: IdGenerator = uuidGenerator,
    private readonly clock: Clock = Date.now,
  ) {
    this.state = structuredClone(initial);
  }

  snapshot(): HubState {
    return structuredClone(this.state);
  }

  settings(): HubSettings {
    return { ...this.state.settings };
  }

  updateSettings(patch: Partial<HubSettings>): HubSettings {
    const next = { ...this.state.settings, ...patch };
    if (!Number.isInteger(next.commissionBps) || next.commissionBps < 0 || next.commissionBps > 10000) {
      throw new HubError("invalid", "commissionBps must be an integer between 0 and 10000");
    }
    this.state.settings = next;
    return { ...next };
  }

  // ---------------------------------------------------------------- customers

  addCustomer(input: NewCustomer): Customer {
    if (input.kind === "fleet" && !input.company) throw new HubError("invalid", "fleet accounts need a company name");
    const customer: Customer = { id: this.ids(), ...input };
    this.state.customers.push(customer);
    return structuredClone(customer);
  }

  listCustomers(): Customer[] {
    return structuredClone(this.state.customers);
  }

  getCustomer(id: string): Customer {
    return structuredClone(this.customer(id));
  }

  addVehicle(customerId: string, input: NewVehicle): Vehicle {
    this.customer(customerId);
    const vehicle: Vehicle = {
      id: this.ids(),
      customerId,
      ...input,
      connectorTypes: [...new Set(input.connectorTypes)],
      autonomous: input.autonomous ?? false,
    };
    this.state.vehicles.push(vehicle);
    return structuredClone(vehicle);
  }

  listVehicles(customerId?: string): Vehicle[] {
    return structuredClone(this.state.vehicles.filter((v) => customerId === undefined || v.customerId === customerId));
  }

  // ---------------------------------------------------------------- providers

  /** "Become a provider": the application starts as pending until the platform verifies it. */
  applyAsProvider(input: ProviderApplication): Provider {
    if (input.services.length === 0) throw new HubError("invalid", "a provider must offer at least one service");
    if (!(input.serviceRadiusMiles > 0)) throw new HubError("invalid", "serviceRadiusMiles must be positive");
    const connectorTypes = [...new Set(input.connectorTypes ?? [])];
    if (input.services.includes("MOBILE_CHARGING") && connectorTypes.length === 0) {
      throw new HubError("invalid", "mobile charging providers must list the connectors their equipment supports");
    }
    const provider: Provider = {
      id: this.ids(),
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      services: [...new Set(input.services)],
      connectorTypes,
      status: "pending",
      online: false,
      serviceRadiusMiles: input.serviceRadiusMiles,
      ratingTotal: 0,
      ratingCount: 0,
    };
    this.state.providers.push(provider);
    return structuredClone(provider);
  }

  verifyProvider(id: string): Provider {
    const provider = this.provider(id);
    if (provider.status === "active") throw new HubError("conflict", "provider is already active");
    provider.status = "active";
    return structuredClone(provider);
  }

  suspendProvider(id: string): Provider {
    const provider = this.provider(id);
    if (this.activeJobOf(id)) throw new HubError("conflict", "provider has a job in progress");
    provider.status = "suspended";
    provider.online = false;
    return structuredClone(provider);
  }

  /** Provider goes online (with their current location) or offline. */
  setProviderOnline(id: string, online: boolean, location?: GeoPoint): Provider {
    const provider = this.provider(id);
    if (online) {
      if (provider.status !== "active") throw new HubError("conflict", `provider is ${provider.status}`);
      if (location) provider.location = { ...assertPoint(location) };
      if (!provider.location) throw new HubError("invalid", "a location is required to go online");
    }
    provider.online = online;
    return structuredClone(provider);
  }

  /** Live location ping. Refreshes the ETA of a job the provider is driving to. */
  updateProviderLocation(id: string, location: GeoPoint): Provider {
    const provider = this.provider(id);
    provider.location = { ...assertPoint(location) };
    const job = this.activeJobOf(id);
    if (job && (job.status === "matched" || job.status === "en_route")) {
      job.etaMinutes = etaMinutes(provider.location, job.location);
    }
    return structuredClone(provider);
  }

  listProviders(filter: { status?: Provider["status"]; service?: ServiceCode } = {}): Provider[] {
    return structuredClone(
      this.state.providers.filter(
        (p) =>
          (filter.status === undefined || p.status === filter.status) &&
          (filter.service === undefined || p.services.includes(filter.service)),
      ),
    );
  }

  getProvider(id: string): Provider {
    return structuredClone(this.provider(id));
  }

  // ---------------------------------------------------------------- catalog

  seedDefaultCatalog(): ServiceOffering[] {
    for (const offering of DEFAULT_CATALOG) {
      if (!this.state.catalog.some((o) => o.code === offering.code)) this.state.catalog.push({ ...offering });
    }
    return this.listCatalog();
  }

  /** Change an offering's price or description. Open requests keep the price they were quoted. */
  updateOffering(code: ServiceCode, patch: Partial<Omit<ServiceOffering, "code" | "unit">>): ServiceOffering {
    const offering = this.offering(code);
    if (patch.unitPrice !== undefined && offering.unit === undefined) {
      throw new HubError("invalid", `${code} is not metered and has no unit price`);
    }
    Object.assign(offering, patch);
    return { ...offering };
  }

  listCatalog(): ServiceOffering[] {
    return structuredClone(this.state.catalog);
  }

  // ---------------------------------------------------------------- requests

  /** A customer requests a service for one of their vehicles at its current location. */
  requestService(input: NewRequest, source: RequestSource = "app"): ServiceRequest {
    const vehicle = this.vehicle(input.vehicleId);
    const customer = this.customer(vehicle.customerId);
    const offering = this.offering(input.serviceCode);
    assertPoint(input.location);

    if (source === "fleet" && customer.kind !== "fleet") {
      throw new HubError("invalid", "fleet requests require a fleet account");
    }
    if (source === "autonomous_api") {
      if (!this.state.settings.autonomousApiEnabled) {
        throw new HubError("unavailable", "the autonomous vehicle API is not yet active");
      }
      if (!vehicle.autonomous) throw new HubError("invalid", "vehicle is not registered as autonomous");
    }
    const open = this.state.requests.find(
      (r) => r.vehicleId === vehicle.id && r.serviceCode === offering.code && !["completed", "cancelled"].includes(r.status),
    );
    if (open) throw new HubError("conflict", `vehicle already has an open ${offering.code} request (${open.id})`);

    const request: ServiceRequest = {
      id: this.ids(),
      customerId: customer.id,
      vehicleId: vehicle.id,
      serviceCode: offering.code,
      source,
      location: { ...input.location },
      ...(input.notes ? { notes: input.notes } : {}),
      quote: {
        calloutFee: offering.calloutFee,
        ...(offering.unit ? { unit: offering.unit, unitPrice: offering.unitPrice ?? 0 } : {}),
      },
      status: "requested",
      declinedBy: [],
      requestedAt: this.now(),
    };
    this.state.requests.push(request);
    return structuredClone(request);
  }

  /** Fleet coordination: request service for several fleet vehicles at once. All succeed or none do. */
  requestFleetService(customerId: string, items: NewRequest[]): ServiceRequest[] {
    const customer = this.customer(customerId);
    if (customer.kind !== "fleet") throw new HubError("invalid", "fleet requests require a fleet account");
    if (items.length === 0) throw new HubError("invalid", "at least one request is required");
    return this.atomically(() =>
      items.map((item) => {
        if (this.vehicle(item.vehicleId).customerId !== customerId) {
          throw new HubError("invalid", `vehicle ${item.vehicleId} does not belong to this fleet`);
        }
        return this.requestService(item, "fleet");
      }),
    );
  }

  getRequest(id: string): ServiceRequest {
    return structuredClone(this.request(id));
  }

  listRequests(
    filter: { customerId?: string; providerId?: string; status?: RequestStatus; serviceCode?: ServiceCode } = {},
  ): ServiceRequest[] {
    return structuredClone(
      this.state.requests.filter(
        (r) =>
          (filter.customerId === undefined || r.customerId === filter.customerId) &&
          (filter.providerId === undefined || r.providerId === filter.providerId) &&
          (filter.status === undefined || r.status === filter.status) &&
          (filter.serviceCode === undefined || r.serviceCode === filter.serviceCode),
      ),
    );
  }

  /**
   * Providers who can take a request now, nearest first: verified, online,
   * offering the service, within their own radius, free of other jobs, not
   * having declined it, and (for charging) with equipment the vehicle accepts.
   */
  candidates(requestId: string): Candidate[] {
    const request = this.request(requestId);
    const vehicle = this.vehicle(request.vehicleId);
    return this.state.providers
      .filter(
        (p) =>
          p.status === "active" &&
          p.online &&
          p.location !== undefined &&
          p.services.includes(request.serviceCode) &&
          !request.declinedBy.includes(p.id) &&
          !this.activeJobOf(p.id) &&
          (request.serviceCode !== "MOBILE_CHARGING" ||
            vehicle.connectorTypes.length === 0 ||
            p.connectorTypes.some((c) => vehicle.connectorTypes.includes(c))),
      )
      .map((p) => ({
        provider: structuredClone(p),
        distanceMiles: Math.round(distanceMiles(p.location!, request.location) * 10) / 10,
        etaMinutes: etaMinutes(p.location!, request.location),
      }))
      .filter((c) => c.distanceMiles <= c.provider.serviceRadiusMiles)
      .sort((a, b) => a.distanceMiles - b.distanceMiles);
  }

  /** Match a request to a provider: the one given, or the nearest eligible one. */
  match(requestId: string, providerId?: string): ServiceRequest {
    const request = this.request(requestId);
    this.expectStatus(request, "requested");
    const candidates = this.candidates(requestId);
    const chosen = providerId === undefined ? candidates[0] : candidates.find((c) => c.provider.id === providerId);
    if (!chosen) {
      if (providerId !== undefined) this.provider(providerId);
      throw new HubError("conflict", providerId ? "provider is not eligible for this request" : "no provider is available nearby");
    }
    request.status = "matched";
    request.providerId = chosen.provider.id;
    request.etaMinutes = chosen.etaMinutes;
    request.matchedAt = this.now();
    return structuredClone(request);
  }

  /** The matched provider turns the job down; it goes back to the queue for someone else. */
  decline(requestId: string, providerId: string): ServiceRequest {
    const request = this.assigned(requestId, providerId);
    this.expectStatus(request, "matched");
    request.status = "requested";
    request.declinedBy.push(providerId);
    delete request.providerId;
    delete request.etaMinutes;
    delete request.matchedAt;
    return structuredClone(request);
  }

  depart(requestId: string, providerId: string): ServiceRequest {
    const request = this.assigned(requestId, providerId);
    this.expectStatus(request, "matched");
    request.status = "en_route";
    const provider = this.provider(providerId);
    if (provider.location) request.etaMinutes = etaMinutes(provider.location, request.location);
    return structuredClone(request);
  }

  arrive(requestId: string, providerId: string): ServiceRequest {
    const request = this.assigned(requestId, providerId);
    this.expectStatus(request, "en_route");
    request.status = "arrived";
    request.etaMinutes = 0;
    request.arrivedAt = this.now();
    return structuredClone(request);
  }

  startService(requestId: string, providerId: string): ServiceRequest {
    const request = this.assigned(requestId, providerId);
    this.expectStatus(request, "arrived");
    request.status = "in_service";
    request.startedAt = this.now();
    return structuredClone(request);
  }

  /** Provider finishes the job and reports the metered quantity (Wh charged, milli-miles towed; 0 otherwise). */
  finishService(requestId: string, providerId: string, quantity = 0): ServiceRequest {
    const request = this.assigned(requestId, providerId);
    this.expectStatus(request, "in_service");
    request.bill = computeBill(request.quote, quantity, this.state.settings.commissionBps);
    request.status = "awaiting_confirmation";
    request.finishedAt = this.now();
    return structuredClone(request);
  }

  /** Customer confirms the work (which charges the bill) and optionally rates the provider. */
  confirm(requestId: string, rating?: Rating): ServiceRequest {
    const request = this.request(requestId);
    this.expectStatus(request, "awaiting_confirmation");
    if (rating) {
      if (!Number.isInteger(rating.stars) || rating.stars < 1 || rating.stars > 5) {
        throw new HubError("invalid", "rating must be 1 to 5 stars");
      }
      request.rating = { ...rating };
      const provider = this.provider(request.providerId!);
      provider.ratingTotal += rating.stars;
      provider.ratingCount += 1;
    }
    request.status = "completed";
    request.completedAt = this.now();
    return structuredClone(request);
  }

  /** Customer cancels. Free until the provider sets off; after that the call-out fee is charged. */
  cancel(requestId: string): ServiceRequest {
    const request = this.request(requestId);
    if (!CANCELLABLE.includes(request.status)) {
      throw new HubError("conflict", `a request that is ${request.status} cannot be cancelled`);
    }
    if (CANCELLATION_FEE_STATUSES.includes(request.status)) {
      request.cancellationFee = request.quote.calloutFee;
      request.bill = computeBill({ calloutFee: request.quote.calloutFee }, 0, this.state.settings.commissionBps);
    }
    request.status = "cancelled";
    request.cancelledAt = this.now();
    return structuredClone(request);
  }

  // ---------------------------------------------------------------- reporting

  /** Charges to a customer: confirmed jobs and paid cancellations. */
  customerStatement(customerId: string): Statement & { customer: Customer } {
    const customer = this.customer(customerId);
    const requests = this.billed().filter((r) => r.customerId === customerId);
    return structuredClone({ customer, requests, total: addCents(...requests.map((r) => r.bill!.total)) });
  }

  /** What a provider has earned after the platform commission. */
  providerEarnings(providerId: string): Statement & { provider: Provider; averageRating: number | null } {
    const provider = this.provider(providerId);
    const requests = this.billed().filter((r) => r.providerId === providerId);
    return structuredClone({
      provider,
      requests,
      total: addCents(...requests.map((r) => r.bill!.providerPayout)),
      averageRating: provider.ratingCount === 0 ? null : Math.round((provider.ratingTotal / provider.ratingCount) * 10) / 10,
    });
  }

  /** Platform revenue for [from, to), by completion or cancellation time. */
  revenueReport(from: string, to: string): RevenueReport {
    const fromMs = toMs(from, "from");
    const toMsValue = toMs(to, "to");
    if (toMsValue <= fromMs) throw new HubError("invalid", "`to` must be after `from`");
    const requests = this.billed().filter((r) => {
      const ms = toMs((r.completedAt ?? r.cancelledAt)!);
      return ms >= fromMs && ms < toMsValue;
    });
    const byService = new Map<ServiceCode, { code: ServiceCode; jobs: number; gross: Cents }>();
    for (const r of requests) {
      const row = byService.get(r.serviceCode) ?? { code: r.serviceCode, jobs: 0, gross: 0 };
      row.jobs += 1;
      row.gross = addCents(row.gross, r.bill!.total);
      byService.set(r.serviceCode, row);
    }
    return {
      from: toIso(fromMs),
      to: toIso(toMsValue),
      jobs: requests.filter((r) => r.status === "completed").length,
      cancellations: requests.filter((r) => r.status === "cancelled").length,
      gross: addCents(...requests.map((r) => r.bill!.total)),
      platformFees: addCents(...requests.map((r) => r.bill!.platformFee)),
      providerPayouts: addCents(...requests.map((r) => r.bill!.providerPayout)),
      byService: [...byService.values()].sort((a, b) => b.gross - a.gross),
    };
  }

  // ---------------------------------------------------------------- internals

  private now(): string {
    return toIso(this.clock());
  }

  /** Requests whose bill has been charged. */
  private billed(): ServiceRequest[] {
    return this.state.requests.filter((r) => r.bill !== undefined && (r.status === "completed" || r.status === "cancelled"));
  }

  private atomically<T>(fn: () => T): T {
    const before = structuredClone(this.state);
    try {
      return fn();
    } catch (e) {
      this.state = before;
      throw e;
    }
  }

  private expectStatus(request: ServiceRequest, status: RequestStatus): void {
    if (request.status !== status) {
      throw new HubError("conflict", `request is ${request.status}; expected ${status}`);
    }
  }

  private assigned(requestId: string, providerId: string): ServiceRequest {
    const request = this.request(requestId);
    if (request.providerId !== providerId) throw new HubError("forbidden", "request is not assigned to this provider");
    return request;
  }

  private activeJobOf(providerId: string): ServiceRequest | undefined {
    return this.state.requests.find((r) => r.providerId === providerId && ACTIVE_JOB_STATUSES.includes(r.status));
  }

  private customer(id: string): Customer {
    const found = this.state.customers.find((c) => c.id === id);
    if (!found) throw new HubError("not_found", `customer ${id} not found`);
    return found;
  }

  private vehicle(id: string): Vehicle {
    const found = this.state.vehicles.find((v) => v.id === id);
    if (!found) throw new HubError("not_found", `vehicle ${id} not found`);
    return found;
  }

  private provider(id: string): Provider {
    const found = this.state.providers.find((p) => p.id === id);
    if (!found) throw new HubError("not_found", `provider ${id} not found`);
    return found;
  }

  private offering(code: ServiceCode): ServiceOffering {
    const found = this.state.catalog.find((o) => o.code === code);
    if (!found) throw new HubError("not_found", `service ${code} is not offered`);
    return found;
  }

  private request(id: string): ServiceRequest {
    const found = this.state.requests.find((r) => r.id === id);
    if (!found) throw new HubError("not_found", `request ${id} not found`);
    return found;
  }
}
