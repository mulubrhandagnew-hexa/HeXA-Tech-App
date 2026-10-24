/**
 * HeXA EV ReCharge REST API.
 *
 * A thin HTTP layer over the Hub service. Monetary fields in requests accept a
 * decimal string or number in major units (e.g. "0.45" per kWh) and are
 * converted to integer cents. All amounts in responses are integer cents;
 * energy is in watt-hours.
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";
import { Hub } from "../service/hub.js";
import { toCents, MoneyError } from "../domain/money.js";
import { HubError } from "../domain/errors.js";
import { CONNECTOR_TYPES } from "../domain/charging.js";
import { type HubRepository, InMemoryRepository } from "../persistence/repository.js";

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return toCents(v);
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    return z.NEVER;
  }
});

const nonNegativeMoney = money.refine((c) => c >= 0, { message: "amount must not be negative" });
const connectorType = z.enum(CONNECTOR_TYPES);
const timestamp = z.string().min(1);
const wattHours = z.number().int().nonnegative();

const customerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const vehicleSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1990).max(2100).optional(),
  plate: z.string().min(1).optional(),
  batteryKwh: z.number().positive().optional(),
  connectorTypes: z.array(connectorType).default([]),
});

const stationSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  connectors: z
    .array(
      z.object({
        type: connectorType,
        maxPowerKw: z.number().positive(),
        pricePerKwh: nonNegativeMoney,
        idleFeePerMinute: nonNegativeMoney.default(0),
      }),
    )
    .min(1),
});

const reservationSchema = z.object({
  stationId: z.string().min(1),
  connectorId: z.string().min(1),
  vehicleId: z.string().min(1),
  start: timestamp,
  end: timestamp,
});

const startSessionSchema = z.object({
  stationId: z.string().min(1),
  connectorId: z.string().min(1),
  vehicleId: z.string().min(1),
  startMeterWh: wattHours,
  reservationId: z.string().min(1).optional(),
  at: timestamp.optional(),
});

const stopSessionSchema = z.object({
  endMeterWh: wattHours,
  at: timestamp.optional(),
  chargingCompletedAt: timestamp.optional(),
});

const careServiceSchema = z.object({
  code: z.string().min(1).regex(/^[A-Z0-9-]+$/, "use upper-case letters, digits and dashes"),
  name: z.string().min(1),
  category: z.enum(["battery", "tires", "brakes", "thermal", "software", "filters", "detailing"]),
  durationMinutes: z.number().int().positive(),
  price: nonNegativeMoney,
});

const appointmentSchema = z.object({
  vehicleId: z.string().min(1),
  serviceCodes: z.array(z.string().min(1)).min(1),
  start: timestamp,
  bayId: z.string().min(1).optional(),
  notes: z.string().max(1000).optional(),
});

const query = (req: Request, key: string): string | undefined =>
  typeof req.query[key] === "string" ? (req.query[key] as string) : undefined;

export interface ServerOptions {
  hub: Hub;
  repository?: HubRepository;
}

export function createServer(opts: ServerOptions): Express {
  const { hub } = opts;
  const repository = opts.repository ?? new InMemoryRepository();
  const app = express();
  app.use(express.json());

  // Serialize persistence so concurrent writes can't interleave a save.
  let saveChain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    const next = saveChain.then(() => repository.save(hub.snapshot()));
    saveChain = next.catch(() => {});
    return next;
  };

  const wrap =
    (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res)).catch(next);
    };

  /** POST handler that runs a mutation, persists, and replies 201 (or `status`). */
  const mutate = (key: string, fn: (req: Request) => unknown, status = 201) =>
    wrap(async (req, res) => {
      const result = fn(req);
      await persist();
      res.status(status).json({ [key]: result });
    });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "hexa-ev-recharge" });
  });

  // --- customers & vehicles
  app.get("/customers", (_req, res) => {
    res.json({ customers: hub.listCustomers() });
  });
  app.post("/customers", mutate("customer", (req) => hub.addCustomer(customerSchema.parse(req.body))));
  app.get(
    "/customers/:id",
    wrap((req, res) => {
      res.json({ customer: hub.getCustomer(req.params.id!), vehicles: hub.listVehicles(req.params.id) });
    }),
  );
  app.post(
    "/customers/:id/vehicles",
    mutate("vehicle", (req) => hub.addVehicle({ ...vehicleSchema.parse(req.body), customerId: req.params.id! })),
  );
  app.get(
    "/customers/:id/statement",
    wrap((req, res) => {
      res.json(hub.customerStatement(req.params.id!));
    }),
  );

  // --- charging network
  app.get(
    "/stations",
    wrap((req, res) => {
      const type = query(req, "connectorType");
      const minPower = query(req, "minPowerKw");
      res.json({
        stations: hub.listStations({
          ...(type ? { connectorType: connectorType.parse(type) } : {}),
          ...(minPower ? { minPowerKw: z.coerce.number().positive().parse(minPower) } : {}),
        }),
      });
    }),
  );
  app.post("/stations", mutate("station", (req) => hub.addStation(stationSchema.parse(req.body))));
  app.get(
    "/stations/:id",
    wrap((req, res) => {
      res.json({ station: hub.getStation(req.params.id!) });
    }),
  );
  app.get(
    "/stations/:id/availability",
    wrap((req, res) => {
      res.json({ connectors: hub.availability(req.params.id!, query(req, "at")) });
    }),
  );
  app.post(
    "/stations/:id/connectors/:connectorId/out-of-service",
    mutate("connector", (req) => hub.setConnectorOutOfService(req.params.id!, req.params.connectorId!, true), 200),
  );
  app.post(
    "/stations/:id/connectors/:connectorId/in-service",
    mutate("connector", (req) => hub.setConnectorOutOfService(req.params.id!, req.params.connectorId!, false), 200),
  );

  app.get("/reservations", (req, res) => {
    const customerId = query(req, "customerId");
    const stationId = query(req, "stationId");
    res.json({
      reservations: hub.listReservations({ ...(customerId ? { customerId } : {}), ...(stationId ? { stationId } : {}) }),
    });
  });
  app.post("/reservations", mutate("reservation", (req) => hub.reserve(reservationSchema.parse(req.body))));
  app.post("/reservations/:id/cancel", mutate("reservation", (req) => hub.cancelReservation(req.params.id!), 200));

  app.get(
    "/sessions",
    wrap((req, res) => {
      const customerId = query(req, "customerId");
      const stationId = query(req, "stationId");
      const status = query(req, "status");
      res.json({
        sessions: hub.listSessions({
          ...(customerId ? { customerId } : {}),
          ...(stationId ? { stationId } : {}),
          ...(status ? { status: z.enum(["active", "completed"]).parse(status) } : {}),
        }),
      });
    }),
  );
  app.post("/sessions", mutate("session", (req) => hub.startSession(startSessionSchema.parse(req.body))));
  app.get(
    "/sessions/:id",
    wrap((req, res) => {
      res.json({ session: hub.getSession(req.params.id!) });
    }),
  );
  app.post(
    "/sessions/:id/charging-complete",
    mutate(
      "session",
      (req) => hub.markChargingComplete(req.params.id!, z.object({ at: timestamp.optional() }).parse(req.body ?? {}).at),
      200,
    ),
  );
  app.post(
    "/sessions/:id/stop",
    mutate("session", (req) => hub.stopSession(req.params.id!, stopSessionSchema.parse(req.body)), 200),
  );

  // --- car care
  app.get("/care/catalog", (_req, res) => {
    res.json({ services: hub.listCatalog() });
  });
  app.post("/care/catalog", mutate("service", (req) => hub.addCareService(careServiceSchema.parse(req.body))));
  app.post("/care/catalog/seed-default", mutate("services", () => hub.seedDefaultCatalog()));
  app.get("/care/bays", (_req, res) => {
    res.json({ bays: hub.listBays() });
  });
  app.post(
    "/care/bays",
    mutate("bay", (req) => hub.addBay(z.object({ name: z.string().min(1) }).parse(req.body).name)),
  );
  app.get(
    "/care/appointments",
    wrap((req, res) => {
      const customerId = query(req, "customerId");
      const bayId = query(req, "bayId");
      const status = query(req, "status");
      res.json({
        appointments: hub.listAppointments({
          ...(customerId ? { customerId } : {}),
          ...(bayId ? { bayId } : {}),
          ...(status ? { status: z.enum(["booked", "in_progress", "completed", "cancelled"]).parse(status) } : {}),
        }),
      });
    }),
  );
  app.post(
    "/care/appointments",
    mutate("appointment", (req) => hub.bookAppointment(appointmentSchema.parse(req.body))),
  );
  app.post("/care/appointments/:id/start", mutate("appointment", (req) => hub.startAppointment(req.params.id!), 200));
  app.post(
    "/care/appointments/:id/complete",
    mutate("appointment", (req) => hub.completeAppointment(req.params.id!), 200),
  );
  app.post("/care/appointments/:id/cancel", mutate("appointment", (req) => hub.cancelAppointment(req.params.id!), 200));

  // --- reporting
  app.get(
    "/reports/revenue",
    wrap((req, res) => {
      const from = query(req, "from");
      const to = query(req, "to");
      if (!from || !to) throw new HubError("invalid", "`from` and `to` query parameters are required");
      res.json(hub.revenueReport(from, to));
    }),
  );

  // Error handler: map domain errors to 400 / 404 / 409, everything else to 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "validation_error", issues: err.issues });
    }
    if (err instanceof HubError) {
      const status = err.code === "not_found" ? 404 : err.code === "conflict" ? 409 : 400;
      return res.status(status).json({ error: err.code, message: err.message });
    }
    if (err instanceof MoneyError) {
      return res.status(400).json({ error: "invalid", message: err.message });
    }
    if (err instanceof SyntaxError) {
      return res.status(400).json({ error: "invalid_json", message: err.message });
    }
    return res.status(500).json({ error: "internal_error", message: (err as Error).message });
  });

  return app;
}

/** Build a Hub from a repository's persisted state. */
export async function hubFromRepository(repository: HubRepository): Promise<Hub> {
  return new Hub(await repository.load());
}
