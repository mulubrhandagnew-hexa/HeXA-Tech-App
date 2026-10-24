/**
 * Hub — the application service for the HeXA EV Hub. It owns customers and
 * vehicles, the charging network (stations, reservations, sessions) and the
 * car care shop (catalog, bays, appointments), and enforces the rules that
 * keep them consistent. This is the main entry point used by the API.
 */
import { type Cents, addCents } from "../domain/money.js";
import { type IdGenerator, uuidGenerator } from "../domain/ids.js";
import { HubError } from "../domain/errors.js";
import { MINUTE_MS, overlaps, toIso, toMs } from "../domain/time.js";
import { type Customer, type Vehicle } from "../domain/customers.js";
import {
  type ChargingSession,
  type Connector,
  type ConnectorType,
  type Reservation,
  type Station,
  MAX_RESERVATION_MINUTES,
  MIN_RESERVATION_MINUTES,
  computeBill,
} from "../domain/charging.js";
import {
  type CareAppointment,
  type CareService,
  type ServiceBay,
  DEFAULT_CARE_CATALOG,
} from "../domain/carcare.js";

export interface HubState {
  customers: Customer[];
  vehicles: Vehicle[];
  stations: Station[];
  reservations: Reservation[];
  sessions: ChargingSession[];
  catalog: CareService[];
  bays: ServiceBay[];
  appointments: CareAppointment[];
}

export function emptyState(): HubState {
  return {
    customers: [],
    vehicles: [],
    stations: [],
    reservations: [],
    sessions: [],
    catalog: [],
    bays: [],
    appointments: [],
  };
}

export type Clock = () => number;

/** A driver may plug in this many minutes before their reservation starts. */
export const EARLY_ARRIVAL_MINUTES = 15;

export interface NewConnector {
  type: ConnectorType;
  maxPowerKw: number;
  pricePerKwh: Cents;
  idleFeePerMinute: Cents;
}

export interface NewStation {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  connectors: NewConnector[];
}

export type ConnectorAvailability = "available" | "reserved" | "charging" | "out_of_service";

export interface StartSessionInput {
  stationId: string;
  connectorId: string;
  vehicleId: string;
  startMeterWh: number;
  reservationId?: string;
  at?: string;
}

export interface StopSessionInput {
  endMeterWh: number;
  at?: string;
  /** When charging finished, if the charger didn't already report it. */
  chargingCompletedAt?: string;
}

export interface BookAppointmentInput {
  vehicleId: string;
  serviceCodes: string[];
  start: string;
  bayId?: string;
  notes?: string;
}

export interface CustomerStatement {
  customer: Customer;
  sessions: ChargingSession[];
  appointments: CareAppointment[];
  chargingTotal: Cents;
  careTotal: Cents;
  total: Cents;
}

export interface RevenueReport {
  from: string;
  to: string;
  charging: { sessions: number; energyWh: number; energy: Cents; idle: Cents; total: Cents };
  care: { appointments: number; total: Cents; byService: Array<{ code: string; count: number; total: Cents }> };
  total: Cents;
}

export class Hub {
  private readonly state: HubState;

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

  // ---------------------------------------------------------------- customers

  addCustomer(input: Omit<Customer, "id">): Customer {
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

  addVehicle(input: Omit<Vehicle, "id">): Vehicle {
    this.customer(input.customerId);
    const vehicle: Vehicle = { id: this.ids(), ...input, connectorTypes: [...new Set(input.connectorTypes)] };
    this.state.vehicles.push(vehicle);
    return structuredClone(vehicle);
  }

  listVehicles(customerId?: string): Vehicle[] {
    const all = this.state.vehicles.filter((v) => customerId === undefined || v.customerId === customerId);
    return structuredClone(all);
  }

  // ---------------------------------------------------------------- stations

  addStation(input: NewStation): Station {
    if (input.connectors.length === 0) throw new HubError("invalid", "a station needs at least one connector");
    const station: Station = {
      id: this.ids(),
      name: input.name,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      connectors: input.connectors.map((c) => ({ id: this.ids(), ...c, outOfService: false })),
    };
    this.state.stations.push(station);
    return structuredClone(station);
  }

  listStations(filter: { connectorType?: ConnectorType; minPowerKw?: number } = {}): Station[] {
    const matches = this.state.stations.filter((s) =>
      s.connectors.some(
        (c) =>
          (filter.connectorType === undefined || c.type === filter.connectorType) &&
          (filter.minPowerKw === undefined || c.maxPowerKw >= filter.minPowerKw),
      ),
    );
    return structuredClone(matches);
  }

  getStation(id: string): Station {
    return structuredClone(this.station(id));
  }

  setConnectorOutOfService(stationId: string, connectorId: string, outOfService: boolean): Connector {
    const connector = this.connector(stationId, connectorId);
    if (outOfService && this.activeSessionOn(connectorId)) {
      throw new HubError("conflict", "connector has an active charging session");
    }
    connector.outOfService = outOfService;
    return structuredClone(connector);
  }

  /** Live status of every connector at a station, at `at` (default: now). */
  availability(stationId: string, at?: string): Array<{ connectorId: string; type: ConnectorType; status: ConnectorAvailability }> {
    const station = this.station(stationId);
    const now = at === undefined ? this.clock() : toMs(at, "at");
    return station.connectors.map((c) => {
      let status: ConnectorAvailability = "available";
      if (c.outOfService) status = "out_of_service";
      else if (this.activeSessionOn(c.id)) status = "charging";
      else if (this.bookedReservationsOn(c.id).some((r) => overlaps(now, now + 1, toMs(r.start), toMs(r.end))))
        status = "reserved";
      return { connectorId: c.id, type: c.type, status };
    });
  }

  // ------------------------------------------------------------ reservations

  reserve(input: { stationId: string; connectorId: string; vehicleId: string; start: string; end: string }): Reservation {
    const connector = this.connector(input.stationId, input.connectorId);
    const vehicle = this.vehicle(input.vehicleId);
    this.assertCompatible(vehicle, connector);
    if (connector.outOfService) throw new HubError("conflict", "connector is out of service");

    const start = toMs(input.start, "start");
    const end = toMs(input.end, "end");
    const minutes = (end - start) / MINUTE_MS;
    if (minutes < MIN_RESERVATION_MINUTES || minutes > MAX_RESERVATION_MINUTES) {
      throw new HubError(
        "invalid",
        `reservation must last between ${MIN_RESERVATION_MINUTES} and ${MAX_RESERVATION_MINUTES} minutes`,
      );
    }
    if (end <= this.clock()) throw new HubError("invalid", "reservation must end in the future");

    const clash = this.bookedReservationsOn(connector.id).find((r) => overlaps(start, end, toMs(r.start), toMs(r.end)));
    if (clash) throw new HubError("conflict", `connector is already reserved ${clash.start} – ${clash.end}`);

    const reservation: Reservation = {
      id: this.ids(),
      stationId: input.stationId,
      connectorId: connector.id,
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      start: toIso(start),
      end: toIso(end),
      status: "booked",
    };
    this.state.reservations.push(reservation);
    return structuredClone(reservation);
  }

  listReservations(filter: { customerId?: string; stationId?: string } = {}): Reservation[] {
    return structuredClone(
      this.state.reservations.filter(
        (r) =>
          (filter.customerId === undefined || r.customerId === filter.customerId) &&
          (filter.stationId === undefined || r.stationId === filter.stationId),
      ),
    );
  }

  cancelReservation(id: string): Reservation {
    const reservation = this.reservation(id);
    if (reservation.status !== "booked") {
      throw new HubError("conflict", `reservation is ${reservation.status} and cannot be cancelled`);
    }
    reservation.status = "cancelled";
    return structuredClone(reservation);
  }

  // ---------------------------------------------------------------- sessions

  startSession(input: StartSessionInput): ChargingSession {
    const connector = this.connector(input.stationId, input.connectorId);
    const vehicle = this.vehicle(input.vehicleId);
    this.assertCompatible(vehicle, connector);
    if (!Number.isSafeInteger(input.startMeterWh) || input.startMeterWh < 0) {
      throw new HubError("invalid", "startMeterWh must be a non-negative integer");
    }
    if (connector.outOfService) throw new HubError("conflict", "connector is out of service");
    if (this.activeSessionOn(connector.id)) throw new HubError("conflict", "connector is already in use");
    if (this.state.sessions.some((s) => s.status === "active" && s.vehicleId === vehicle.id)) {
      throw new HubError("conflict", "vehicle already has an active charging session");
    }

    const now = input.at === undefined ? this.clock() : toMs(input.at, "at");
    // Reservations whose window (including the early-arrival allowance) covers now.
    const covering = this.bookedReservationsOn(connector.id).filter((r) =>
      overlaps(now, now + 1, toMs(r.start) - EARLY_ARRIVAL_MINUTES * MINUTE_MS, toMs(r.end)),
    );
    let reservation: Reservation | undefined;
    if (input.reservationId !== undefined) {
      reservation = covering.find((r) => r.id === input.reservationId);
      if (!reservation) {
        this.reservation(input.reservationId); // 404 if it doesn't exist at all
        throw new HubError("conflict", "reservation is not active for this connector at this time");
      }
    } else {
      reservation = covering.find((r) => r.vehicleId === vehicle.id);
    }
    if (reservation && reservation.vehicleId !== vehicle.id) {
      throw new HubError("conflict", "reservation belongs to a different vehicle");
    }
    if (covering.some((r) => r.vehicleId !== vehicle.id)) {
      throw new HubError("conflict", "connector is reserved by another driver");
    }
    if (reservation) reservation.status = "fulfilled";

    const session: ChargingSession = {
      id: this.ids(),
      stationId: input.stationId,
      connectorId: connector.id,
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      ...(reservation ? { reservationId: reservation.id } : {}),
      startedAt: toIso(now),
      startMeterWh: input.startMeterWh,
      pricePerKwh: connector.pricePerKwh,
      idleFeePerMinute: connector.idleFeePerMinute,
      status: "active",
    };
    this.state.sessions.push(session);
    return structuredClone(session);
  }

  /** Charger reports the battery is full / the vehicle stopped drawing power. Idle fees start after the grace period. */
  markChargingComplete(sessionId: string, at?: string): ChargingSession {
    const session = this.activeSession(sessionId);
    const ms = at === undefined ? this.clock() : toMs(at, "at");
    if (ms < toMs(session.startedAt)) throw new HubError("invalid", "charging cannot complete before it started");
    session.chargingCompletedAt = toIso(ms);
    return structuredClone(session);
  }

  stopSession(sessionId: string, input: StopSessionInput): ChargingSession {
    const session = this.activeSession(sessionId);
    const endedMs = input.at === undefined ? this.clock() : toMs(input.at, "at");
    if (endedMs < toMs(session.startedAt)) throw new HubError("invalid", "session cannot end before it started");
    if (input.chargingCompletedAt !== undefined && session.chargingCompletedAt === undefined) {
      session.chargingCompletedAt = toIso(toMs(input.chargingCompletedAt, "chargingCompletedAt"));
    }
    const completedMs = session.chargingCompletedAt === undefined ? undefined : toMs(session.chargingCompletedAt);
    if (completedMs !== undefined && (completedMs < toMs(session.startedAt) || completedMs > endedMs)) {
      throw new HubError("invalid", "chargingCompletedAt must fall within the session");
    }
    if (!Number.isSafeInteger(input.endMeterWh)) throw new HubError("invalid", "endMeterWh must be an integer");

    const bill = computeBill({
      startMeterWh: session.startMeterWh,
      endMeterWh: input.endMeterWh,
      pricePerKwh: session.pricePerKwh,
      idleFeePerMinute: session.idleFeePerMinute,
      ...(completedMs !== undefined ? { chargingCompletedMs: completedMs } : {}),
      endedMs,
    });
    session.status = "completed";
    session.endedAt = toIso(endedMs);
    session.endMeterWh = input.endMeterWh;
    session.bill = bill;
    return structuredClone(session);
  }

  listSessions(filter: { customerId?: string; stationId?: string; status?: ChargingSession["status"] } = {}): ChargingSession[] {
    return structuredClone(
      this.state.sessions.filter(
        (s) =>
          (filter.customerId === undefined || s.customerId === filter.customerId) &&
          (filter.stationId === undefined || s.stationId === filter.stationId) &&
          (filter.status === undefined || s.status === filter.status),
      ),
    );
  }

  getSession(id: string): ChargingSession {
    return structuredClone(this.session(id));
  }

  // ---------------------------------------------------------------- car care

  seedDefaultCatalog(): CareService[] {
    for (const service of DEFAULT_CARE_CATALOG) {
      if (!this.state.catalog.some((s) => s.code === service.code)) this.state.catalog.push({ ...service });
    }
    return this.listCatalog();
  }

  addCareService(service: CareService): CareService {
    if (this.state.catalog.some((s) => s.code === service.code)) {
      throw new HubError("conflict", `service code ${service.code} already exists`);
    }
    if (!Number.isInteger(service.durationMinutes) || service.durationMinutes <= 0) {
      throw new HubError("invalid", "durationMinutes must be a positive integer");
    }
    this.state.catalog.push({ ...service });
    return { ...service };
  }

  listCatalog(): CareService[] {
    return structuredClone(this.state.catalog);
  }

  addBay(name: string): ServiceBay {
    const bay: ServiceBay = { id: this.ids(), name };
    this.state.bays.push(bay);
    return { ...bay };
  }

  listBays(): ServiceBay[] {
    return structuredClone(this.state.bays);
  }

  /** Book care services back-to-back in one bay. If no bay is given, the first free bay is chosen. */
  bookAppointment(input: BookAppointmentInput): CareAppointment {
    const vehicle = this.vehicle(input.vehicleId);
    if (input.serviceCodes.length === 0) throw new HubError("invalid", "at least one service is required");
    if (new Set(input.serviceCodes).size !== input.serviceCodes.length) {
      throw new HubError("invalid", "duplicate service codes");
    }
    const lines = input.serviceCodes.map((code) => {
      const service = this.state.catalog.find((s) => s.code === code);
      if (!service) throw new HubError("not_found", `unknown care service ${code}`);
      return { code: service.code, name: service.name, durationMinutes: service.durationMinutes, price: service.price };
    });
    const start = toMs(input.start, "start");
    if (start <= this.clock()) throw new HubError("invalid", "appointment must start in the future");
    const end = start + lines.reduce((m, l) => m + l.durationMinutes, 0) * MINUTE_MS;

    const candidates = input.bayId === undefined ? this.state.bays : [this.bay(input.bayId)];
    if (candidates.length === 0) throw new HubError("conflict", "no service bays are configured");
    const bay = candidates.find((b) => this.bayIsFree(b.id, start, end));
    if (!bay) {
      throw new HubError("conflict", input.bayId ? "bay is booked at that time" : "no bay is free at that time");
    }

    const appointment: CareAppointment = {
      id: this.ids(),
      customerId: vehicle.customerId,
      vehicleId: vehicle.id,
      bayId: bay.id,
      start: toIso(start),
      end: toIso(end),
      lines,
      total: addCents(...lines.map((l) => l.price)),
      status: "booked",
      ...(input.notes ? { notes: input.notes } : {}),
    };
    this.state.appointments.push(appointment);
    return structuredClone(appointment);
  }

  startAppointment(id: string): CareAppointment {
    return this.transitionAppointment(id, "booked", "in_progress");
  }

  completeAppointment(id: string): CareAppointment {
    return this.transitionAppointment(id, "in_progress", "completed");
  }

  cancelAppointment(id: string): CareAppointment {
    return this.transitionAppointment(id, "booked", "cancelled");
  }

  listAppointments(filter: { customerId?: string; bayId?: string; status?: CareAppointment["status"] } = {}): CareAppointment[] {
    return structuredClone(
      this.state.appointments.filter(
        (a) =>
          (filter.customerId === undefined || a.customerId === filter.customerId) &&
          (filter.bayId === undefined || a.bayId === filter.bayId) &&
          (filter.status === undefined || a.status === filter.status),
      ),
    );
  }

  // ---------------------------------------------------------------- reporting

  /** Everything a customer owes: completed charging sessions and completed care appointments. */
  customerStatement(customerId: string): CustomerStatement {
    const customer = this.customer(customerId);
    const sessions = this.state.sessions.filter((s) => s.customerId === customerId && s.status === "completed");
    const appointments = this.state.appointments.filter((a) => a.customerId === customerId && a.status === "completed");
    const chargingTotal = addCents(...sessions.map((s) => s.bill!.total));
    const careTotal = addCents(...appointments.map((a) => a.total));
    return structuredClone({
      customer,
      sessions,
      appointments,
      chargingTotal,
      careTotal,
      total: chargingTotal + careTotal,
    });
  }

  /** Revenue recognised in [from, to): sessions by end time, care by appointment end time. */
  revenueReport(from: string, to: string): RevenueReport {
    const fromMs = toMs(from, "from");
    const toMsValue = toMs(to, "to");
    if (toMsValue <= fromMs) throw new HubError("invalid", "`to` must be after `from`");
    const inRange = (iso: string) => {
      const ms = toMs(iso);
      return ms >= fromMs && ms < toMsValue;
    };

    const sessions = this.state.sessions.filter((s) => s.status === "completed" && inRange(s.endedAt!));
    const energyWh = sessions.reduce((sum, s) => sum + s.bill!.energyWh, 0);
    const energy = addCents(...sessions.map((s) => s.bill!.energy));
    const idle = addCents(...sessions.map((s) => s.bill!.idle));

    const appointments = this.state.appointments.filter((a) => a.status === "completed" && inRange(a.end));
    const byService = new Map<string, { code: string; count: number; total: Cents }>();
    for (const line of appointments.flatMap((a) => a.lines)) {
      const row = byService.get(line.code) ?? { code: line.code, count: 0, total: 0 };
      row.count += 1;
      row.total = addCents(row.total, line.price);
      byService.set(line.code, row);
    }
    const careTotal = addCents(...appointments.map((a) => a.total));

    return {
      from: toIso(fromMs),
      to: toIso(toMsValue),
      charging: { sessions: sessions.length, energyWh, energy, idle, total: energy + idle },
      care: {
        appointments: appointments.length,
        total: careTotal,
        byService: [...byService.values()].sort((a, b) => b.total - a.total),
      },
      total: energy + idle + careTotal,
    };
  }

  // ---------------------------------------------------------------- internals

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

  private station(id: string): Station {
    const found = this.state.stations.find((s) => s.id === id);
    if (!found) throw new HubError("not_found", `station ${id} not found`);
    return found;
  }

  private connector(stationId: string, connectorId: string): Connector {
    const found = this.station(stationId).connectors.find((c) => c.id === connectorId);
    if (!found) throw new HubError("not_found", `connector ${connectorId} not found at station ${stationId}`);
    return found;
  }

  private reservation(id: string): Reservation {
    const found = this.state.reservations.find((r) => r.id === id);
    if (!found) throw new HubError("not_found", `reservation ${id} not found`);
    return found;
  }

  private session(id: string): ChargingSession {
    const found = this.state.sessions.find((s) => s.id === id);
    if (!found) throw new HubError("not_found", `session ${id} not found`);
    return found;
  }

  private activeSession(id: string): ChargingSession {
    const session = this.session(id);
    if (session.status !== "active") throw new HubError("conflict", "session is already completed");
    return session;
  }

  private bay(id: string): ServiceBay {
    const found = this.state.bays.find((b) => b.id === id);
    if (!found) throw new HubError("not_found", `bay ${id} not found`);
    return found;
  }

  private appointment(id: string): CareAppointment {
    const found = this.state.appointments.find((a) => a.id === id);
    if (!found) throw new HubError("not_found", `appointment ${id} not found`);
    return found;
  }

  private activeSessionOn(connectorId: string): ChargingSession | undefined {
    return this.state.sessions.find((s) => s.connectorId === connectorId && s.status === "active");
  }

  private bookedReservationsOn(connectorId: string): Reservation[] {
    return this.state.reservations.filter((r) => r.connectorId === connectorId && r.status === "booked");
  }

  private bayIsFree(bayId: string, start: number, end: number): boolean {
    return !this.state.appointments.some(
      (a) =>
        a.bayId === bayId &&
        (a.status === "booked" || a.status === "in_progress") &&
        overlaps(start, end, toMs(a.start), toMs(a.end)),
    );
  }

  private assertCompatible(vehicle: Vehicle, connector: Connector): void {
    if (vehicle.connectorTypes.length > 0 && !vehicle.connectorTypes.includes(connector.type)) {
      throw new HubError(
        "invalid",
        `vehicle accepts ${vehicle.connectorTypes.join("/")} but connector is ${connector.type}`,
      );
    }
  }

  private transitionAppointment(
    id: string,
    from: CareAppointment["status"],
    to: CareAppointment["status"],
  ): CareAppointment {
    const appointment = this.appointment(id);
    if (appointment.status !== from) {
      throw new HubError("conflict", `appointment is ${appointment.status}; expected ${from}`);
    }
    appointment.status = to;
    return structuredClone(appointment);
  }
}
