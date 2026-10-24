/**
 * Mobile EV Recharge REST API.
 *
 * A thin HTTP layer over the Hub service. Monetary fields in requests accept
 * a decimal string or number in major units (e.g. "25.00") and are converted
 * to integer cents. All amounts in responses are integer cents.
 *
 * Provider actions carry the acting `providerId` in the body. In production
 * that id must come from the authenticated provider session instead.
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";
import { Hub } from "../service/hub.js";
import { toCents, MoneyError } from "../domain/money.js";
import { HubError } from "../domain/errors.js";
import { SERVICE_CODES } from "../domain/catalog.js";
import { CONNECTOR_TYPES } from "../domain/parties.js";
import { type HubRepository, InMemoryRepository } from "../persistence/repository.js";

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return toCents(v);
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    return z.NEVER;
  }
});

const price = money.refine((c) => c >= 0, { message: "amount must not be negative" });
const serviceCode = z.enum(SERVICE_CODES);
const connectorType = z.enum(CONNECTOR_TYPES);
const point = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const requestStatus = z.enum([
  "requested",
  "matched",
  "en_route",
  "arrived",
  "in_service",
  "awaiting_confirmation",
  "completed",
  "cancelled",
]);

const customerSchema = z.object({
  kind: z.enum(["individual", "fleet"]).default("individual"),
  name: z.string().min(1),
  company: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
});

const vehicleSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1990).max(2100).optional(),
  plate: z.string().min(1).optional(),
  connectorTypes: z.array(connectorType).default([]),
  autonomous: z.boolean().optional(),
});

const providerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  services: z.array(serviceCode).min(1),
  connectorTypes: z.array(connectorType).optional(),
  serviceRadiusMiles: z.number().positive().max(200),
});

const requestSchema = z.object({
  vehicleId: z.string().min(1),
  serviceCode,
  location: point.extend({ address: z.string().min(1).optional() }),
  notes: z.string().max(1000).optional(),
});

const offeringPatchSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    calloutFee: price,
    unitPrice: price,
    estimatedMinutes: z.number().int().positive(),
  })
  .partial();

const settingsPatchSchema = z
  .object({ commissionBps: z.number().int().min(0).max(10000), autonomousApiEnabled: z.boolean() })
  .partial();

const providerAction = z.object({ providerId: z.string().min(1) });

const query = (req: Request, key: string): string | undefined =>
  typeof req.query[key] === "string" ? (req.query[key] as string) : undefined;

const STATUS_BY_CODE = { invalid: 400, forbidden: 403, not_found: 404, conflict: 409, unavailable: 503 } as const;

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

  /** Handler that runs a mutation, persists, and replies with `{ [key]: result }`. */
  const mutate = (key: string, fn: (req: Request) => unknown, status = 200) =>
    wrap(async (req, res) => {
      const result = fn(req);
      await persist();
      res.status(status).json({ [key]: result });
    });

  const id = (req: Request, key = "id") => req.params[key]!;

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "hexa-ev-recharge" });
  });

  app.get("/settings", (_req, res) => {
    res.json({ settings: hub.settings() });
  });
  app.patch("/settings", mutate("settings", (req) => hub.updateSettings(settingsPatchSchema.parse(req.body))));

  // --- service catalog
  app.get("/services", (_req, res) => {
    res.json({ services: hub.listCatalog() });
  });
  app.post("/services/seed-default", mutate("services", () => hub.seedDefaultCatalog(), 201));
  app.patch(
    "/services/:code",
    mutate("service", (req) => hub.updateOffering(serviceCode.parse(id(req, "code")), offeringPatchSchema.parse(req.body))),
  );

  // --- customers, vehicles and fleets
  app.get("/customers", (_req, res) => {
    res.json({ customers: hub.listCustomers() });
  });
  app.post("/customers", mutate("customer", (req) => hub.addCustomer(customerSchema.parse(req.body)), 201));
  app.get(
    "/customers/:id",
    wrap((req, res) => {
      res.json({ customer: hub.getCustomer(id(req)), vehicles: hub.listVehicles(id(req)) });
    }),
  );
  app.post(
    "/customers/:id/vehicles",
    mutate("vehicle", (req) => hub.addVehicle(id(req), vehicleSchema.parse(req.body)), 201),
  );
  app.get(
    "/customers/:id/statement",
    wrap((req, res) => {
      res.json(hub.customerStatement(id(req)));
    }),
  );
  app.post(
    "/fleet/:id/requests",
    mutate(
      "requests",
      (req) => hub.requestFleetService(id(req), z.object({ requests: z.array(requestSchema).min(1) }).parse(req.body).requests),
      201,
    ),
  );

  // --- providers
  app.get(
    "/providers",
    wrap((req, res) => {
      const status = query(req, "status");
      const service = query(req, "service");
      res.json({
        providers: hub.listProviders({
          ...(status ? { status: z.enum(["pending", "active", "suspended"]).parse(status) } : {}),
          ...(service ? { service: serviceCode.parse(service) } : {}),
        }),
      });
    }),
  );
  app.post("/providers/apply", mutate("provider", (req) => hub.applyAsProvider(providerSchema.parse(req.body)), 201));
  app.get(
    "/providers/:id",
    wrap((req, res) => {
      res.json({ provider: hub.getProvider(id(req)) });
    }),
  );
  app.post("/providers/:id/verify", mutate("provider", (req) => hub.verifyProvider(id(req))));
  app.post("/providers/:id/suspend", mutate("provider", (req) => hub.suspendProvider(id(req))));
  app.post(
    "/providers/:id/online",
    mutate("provider", (req) => {
      const { location } = z.object({ location: point.optional() }).parse(req.body ?? {});
      return hub.setProviderOnline(id(req), true, location);
    }),
  );
  app.post("/providers/:id/offline", mutate("provider", (req) => hub.setProviderOnline(id(req), false)));
  app.post("/providers/:id/location", mutate("provider", (req) => hub.updateProviderLocation(id(req), point.parse(req.body))));
  app.get(
    "/providers/:id/earnings",
    wrap((req, res) => {
      res.json(hub.providerEarnings(id(req)));
    }),
  );

  // --- service requests: Request → Match → Track → Service → Complete
  app.get(
    "/requests",
    wrap((req, res) => {
      const customerId = query(req, "customerId");
      const providerId = query(req, "providerId");
      const status = query(req, "status");
      const service = query(req, "serviceCode");
      res.json({
        requests: hub.listRequests({
          ...(customerId ? { customerId } : {}),
          ...(providerId ? { providerId } : {}),
          ...(status ? { status: requestStatus.parse(status) } : {}),
          ...(service ? { serviceCode: serviceCode.parse(service) } : {}),
        }),
      });
    }),
  );
  app.post("/requests", mutate("request", (req) => hub.requestService(requestSchema.parse(req.body)), 201));
  app.get(
    "/requests/:id",
    wrap((req, res) => {
      res.json({ request: hub.getRequest(id(req)) });
    }),
  );
  app.get(
    "/requests/:id/candidates",
    wrap((req, res) => {
      res.json({ candidates: hub.candidates(id(req)) });
    }),
  );
  app.post(
    "/requests/:id/match",
    mutate("request", (req) => hub.match(id(req), z.object({ providerId: z.string().min(1).optional() }).parse(req.body ?? {}).providerId)),
  );
  app.post("/requests/:id/decline", mutate("request", (req) => hub.decline(id(req), providerAction.parse(req.body).providerId)));
  app.post("/requests/:id/depart", mutate("request", (req) => hub.depart(id(req), providerAction.parse(req.body).providerId)));
  app.post("/requests/:id/arrive", mutate("request", (req) => hub.arrive(id(req), providerAction.parse(req.body).providerId)));
  app.post("/requests/:id/start", mutate("request", (req) => hub.startService(id(req), providerAction.parse(req.body).providerId)));
  app.post(
    "/requests/:id/finish",
    mutate("request", (req) => {
      const body = providerAction.extend({ quantity: z.number().int().nonnegative().default(0) }).parse(req.body);
      return hub.finishService(id(req), body.providerId, body.quantity);
    }),
  );
  app.post(
    "/requests/:id/confirm",
    mutate("request", (req) => {
      const { rating } = z
        .object({ rating: z.object({ stars: z.number().int().min(1).max(5), comment: z.string().max(1000).optional() }).optional() })
        .parse(req.body ?? {});
      return hub.confirm(id(req), rating);
    }),
  );
  app.post("/requests/:id/cancel", mutate("request", (req) => hub.cancel(id(req))));

  // --- autonomous vehicles (future integration; returns 503 until enabled in settings)
  app.post(
    "/autonomous/requests",
    mutate("request", (req) => hub.requestService(requestSchema.parse(req.body), "autonomous_api"), 201),
  );

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

  // Error handler: map domain errors to their status, everything else to 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "validation_error", issues: err.issues });
    }
    if (err instanceof HubError) {
      return res.status(STATUS_BY_CODE[err.code]).json({ error: err.code, message: err.message });
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
