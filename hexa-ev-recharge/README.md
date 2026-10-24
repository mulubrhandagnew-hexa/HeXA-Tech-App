# HeXA EV ReCharge — Mobile EV Recharge backend

**Mobile EV Recharge** is a HeXA Tech LLC brand, alongside HeXA Ride, HeXA
Elite and the other HeXA Tech companies. The service comes to the vehicle:
independent providers bring mobile charging, cleaning, roadside help and other
vehicle services to EVs parked wherever their owners are working, shopping,
dining or staying.

The customer-facing app is built and hosted on **Hercules**. This folder is a
standalone, tested reference implementation of the backend rules behind it:
dispatch, pricing, payouts and reporting. Its rules can be ported into the
Hercules app, or it can run as its own API.

> Charge · Clean · Repair · Recover · Keep moving

## Quick start

```bash
cd hexa-ev-recharge
npm install
npm test          # run the suite
npm run dev       # start the API with live reload (port 3100)
# or
npm run build && npm start
```

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3100` | HTTP port |
| `HUB_DB_PATH` | `./data/hub.json` | JSON snapshot location |

## How a job flows

```
REQUEST ─▶ MATCH ─▶ TRACK ─────────────▶ SERVICE ─────────────▶ COMPLETE
requested  matched  en_route ▶ arrived   in_service ▶ awaiting   completed
                                                     confirmation (confirm, pay, rate)
```

1. **Request:** the customer chooses a vehicle, a service and a location (GPS
   point plus an optional address such as "Hotel lot, level 2").
2. **Match:** the nearest eligible provider gets the job. Eligible means
   verified, online, offering the service, within their own service radius,
   not already on a job, and not having declined this job. For mobile
   charging, the provider's equipment must also fit the vehicle's charging
   inlet. A provider who declines sends the job back for re-matching.
3. **Track:** the provider sets off. Each location update recalculates the ETA
   (straight-line distance at 25 mph, plus 5 minutes to park and set up).
4. **Service:** the provider arrives, starts the work, and finishes it,
   reporting any metered amount (kWh charged, miles towed).
5. **Complete:** the customer confirms, which charges the bill, and can rate
   the provider 1–5 stars.

**Cancellation** is free until the provider sets off. After that, the call-out
fee is charged. Once work has started, the job can't be cancelled.

## Services and pricing

Every job has a **call-out fee**, and metered services also charge **per
unit**. The price is fixed when the request is made, so later catalog changes
don't affect open jobs. Money is integer cents, and metered amounts are
integer thousandths of a unit (Wh for kWh, thousandths of a mile for towing),
so no floating-point value ever reaches a price.

| Code | Service | Default price |
|---|---|---|
| `MOBILE_CHARGING` | Mobile EV charging | $25.00 + $0.55/kWh |
| `DETAILING` | Mobile cleaning & detailing | $79.00 |
| `BATTERY_12V` | 12V battery service | $69.00 |
| `ROADSIDE` | Roadside assistance | $89.00 |
| `INSPECTION` | Vehicle inspection | $99.00 |
| `ADAS_SENSOR` | ADAS & sensor service (camera, radar, sensor cleaning) | $59.00 |
| `TOWING` | Towing & recovery | $125.00 + $4.50/mile |
| `TIRE` | Tire service | $75.00 |

These prices are placeholders; adjust them with `PATCH /services/:code`. The
platform keeps a **commission** (default 20%, set with `commissionBps`). The
rest is the provider's payout. Commission rounds half-up, so platform fee plus
provider payout always equals the total exactly.

## Audiences

- **Individual EV owners** request a service in the app.
- **Providers** ("Become a provider") apply listing their services and service
  radius, and charging providers also list their connector types. The platform
  verifies them before they can go online, and each provider can see their
  earnings and average rating.
- **Fleets** have company accounts and can book many vehicles in one call. A
  batch either fully succeeds or makes no changes.
- **Autonomous vehicles** (future integration, **not yet active**): vehicles
  flagged `autonomous` will be able to request service themselves via
  `POST /autonomous/requests`. That endpoint returns `503` until
  `autonomousApiEnabled` is turned on in settings, matching the "Future
  Autonomous/API capability — not yet active" notice on the site.

## API

Money inputs are decimal strings or numbers in major units (`"0.55"`).
Responses always use integer cents. Errors return `400` invalid, `403` wrong
provider, `404` not found, `409` conflict or `503` not yet active.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET/PATCH | `/settings` | Commission, autonomous API switch |
| GET | `/services` | Service catalog |
| POST | `/services/seed-default` | Load the default catalog |
| PATCH | `/services/:code` | Change price or description |
| GET/POST | `/customers` | List / create (`kind: individual \| fleet`) |
| GET | `/customers/:id` | Customer and vehicles |
| POST | `/customers/:id/vehicles` | Add a vehicle (`connectorTypes`, `autonomous`) |
| GET | `/customers/:id/statement` | What the customer has been charged |
| POST | `/fleet/:id/requests` | Batch requests for fleet vehicles |
| GET | `/providers` | List (`?status=&service=`) |
| POST | `/providers/apply` | Become a provider |
| POST | `/providers/:id/verify` · `/suspend` | Platform verification |
| POST | `/providers/:id/online` · `/offline` | Availability (online takes a `location`) |
| POST | `/providers/:id/location` | Live location ping (updates ETA) |
| GET | `/providers/:id/earnings` | Payouts and average rating |
| GET/POST | `/requests` | List (`?customerId=&providerId=&status=&serviceCode=`) / request service |
| GET | `/requests/:id` | Request detail, including status and ETA |
| GET | `/requests/:id/candidates` | Eligible providers, nearest first |
| POST | `/requests/:id/match` | Match to the nearest provider or a named `providerId` |
| POST | `/requests/:id/decline` · `/depart` · `/arrive` · `/start` | Provider steps (`providerId`) |
| POST | `/requests/:id/finish` | Provider finishes (`providerId`, `quantity`) |
| POST | `/requests/:id/confirm` | Customer confirms and pays, with an optional `rating` |
| POST | `/requests/:id/cancel` | Customer cancels |
| POST | `/autonomous/requests` | Vehicle-initiated request (503 until enabled) |
| GET | `/reports/revenue?from=&to=` | Gross revenue, platform fees, payouts, by service |

## Not included yet

- **Login and roles.** Provider actions take `providerId` in the request body.
  In production, that must come from the logged-in provider instead.
- **Card payments and provider payouts.** "Confirm" records the charge, but no
  payment processor (such as Stripe) is connected yet.
- **Live tracking.** Location updates are polled. Pushing them live (for
  example over websockets) and road-based ETAs (from a maps API) would come
  with the real app.

## Architecture

```
src/
  domain/        pure rules, no I/O
    money.ts       integer-cents money type
    catalog.ts     service catalog, metered pricing, commission split
    parties.ts     customers, vehicles, providers
    requests.ts    service request model and lifecycle states
    geo.ts         distance and ETA
    time.ts        ISO timestamp parsing
  service/hub.ts application service: matching, dispatch, billing, reports
  persistence/   in-memory and atomic JSON-file repositories
  api/server.ts  Express + zod REST layer
  index.ts       server bootstrap
```
