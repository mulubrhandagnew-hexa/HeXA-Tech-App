# HeXA EV Hub

Standalone **EV recharge** and **EV car care** service for HeXA.

One hub runs a charging network (stations, connectors, reservations and
metered charging sessions) next to a car care shop (EV service catalog,
service bays and appointments). Both bill the same customers, and both feed
one revenue report.

It is a self-contained TypeScript service with **no native dependencies**. It
stores its data as a single JSON snapshot and runs anywhere Node 20+ runs. It
does not depend on HeXA Books or any other HeXA service.

## Quick start

```bash
cd hexa-ev-hub
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

## Rules the hub enforces

**Charging**
- Money is integer cents and energy is integer watt-hours (Wh). Energy cost is
  `Wh × cents/kWh ÷ 1000`, rounded half-up to the cent.
- A session copies the connector's price when it starts, so a later price
  change doesn't change bills already in progress.
- **Idle fee:** once charging finishes, the driver gets a 10-minute grace
  period. After that, every whole minute the car stays plugged in is billed at
  the connector's idle rate.
- A vehicle can only use connectors it supports (CCS1/CCS2/CHAdeMO/NACS/Type2/J1772).
- Each connector runs one session at a time, and each vehicle has at most one
  active session.
- Reservations last 15 minutes to 4 hours and can't overlap on a connector.
  During a reservation, and for 15 minutes before it starts (the early-arrival
  window), only the reserving vehicle can plug in. Plugging in marks the
  reservation fulfilled.
- A connector can't be taken out of service while a car is charging on it.

**Car care**
- The default catalog has 11 EV-focused services: high-voltage battery health
  check, 12V battery, tire rotation and alignment, brakes, brake fluid, battery
  thermal/coolant check, software diagnostics, cabin filter and detailing.
- An appointment runs its services back-to-back. Its length is the sum of the
  service durations, and prices are copied at booking time.
- If no bay is given, the first free bay is chosen. Bays can't be double-booked.
- Appointment lifecycle: `booked → in_progress → completed`, or `booked → cancelled`.

## API

Money inputs are decimal strings or numbers in major units (`"0.45"`).
Responses always use integer cents. Timestamps must be ISO-8601 with an offset
(`2026-05-01T10:00:00Z`). Errors return `400` (invalid), `404` (not found) or
`409` (conflict).

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness |
| GET/POST | `/customers` | List / create customers |
| GET | `/customers/:id` | Customer and their vehicles |
| POST | `/customers/:id/vehicles` | Register a vehicle (`connectorTypes`, `batteryKwh`, …) |
| GET | `/customers/:id/statement` | Completed charging and care, with totals |
| GET/POST | `/stations` | Find (`?connectorType=CCS2&minPowerKw=50`) / add stations |
| GET | `/stations/:id` | Station detail |
| GET | `/stations/:id/availability` | Per-connector `available / reserved / charging / out_of_service` (`?at=`) |
| POST | `/stations/:id/connectors/:cid/out-of-service` · `/in-service` | Maintenance toggle |
| GET/POST | `/reservations` | List / book a connector slot |
| POST | `/reservations/:id/cancel` | Cancel a booking |
| GET/POST | `/sessions` | List / start a charging session (`startMeterWh`) |
| POST | `/sessions/:id/charging-complete` | Charger reports battery full |
| POST | `/sessions/:id/stop` | Unplug: `endMeterWh` → bill |
| GET/POST | `/care/catalog` | List / add care services |
| POST | `/care/catalog/seed-default` | Load the default EV service catalog |
| GET/POST | `/care/bays` | List / add service bays |
| GET/POST | `/care/appointments` | List / book an appointment |
| POST | `/care/appointments/:id/start` · `/complete` · `/cancel` | Lifecycle |
| GET | `/reports/revenue?from=&to=` | Charging and care revenue for a period |

## Architecture

```
src/
  domain/        pure rules, no I/O
    money.ts       integer-cents money type
    time.ts        ISO timestamp parsing, interval overlap
    charging.ts    stations, connectors, reservations, sessions, pricing
    carcare.ts     care catalog, bays, appointments
    customers.ts   customers and vehicles
  service/hub.ts application service enforcing the rules above
  persistence/   in-memory and atomic JSON-file repositories
  api/server.ts  Express + zod REST layer
  index.ts       server bootstrap
```
