# HeXA Books

Double-entry bookkeeping and tax engine for the HeXA platform.

HeXA Books is a standalone TypeScript service that keeps a correct general
ledger, produces financial statements, and computes a configurable tax
estimate. It has **no native dependencies** and stores data as a single JSON
snapshot, so it runs anywhere Node 20+ runs.

> **Note on scope.** This is a self-contained bookkeeping service. It is not
> yet wired into the live hexatech.app (Convex) backend — see
> [Integrating with the HeXA platform](#integrating-with-the-hexa-platform).

## Why it's trustworthy

- **Integer cents everywhere.** Money is never a float; `src/domain/money.ts`
  parses, formats, and adds amounts as integer cents.
- **Enforced double entry.** Every journal entry must balance
  (`Σ debits == Σ credits`) and every line is a debit *or* a credit, never both.
- **Statements that reconcile.** The trial balance and balance sheet assert the
  accounting equation (`assets == liabilities + equity`) holds.
- **36 tests** covering money math, journal validation, ledger balances,
  reports, tax, persistence, and the HTTP API.

## Quick start

```bash
npm install
npm test          # run the suite
npm run dev       # start the API with live reload (port 3000)
# or
npm run build && npm start
```

Environment:

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `BOOKS_DB_PATH` | `./data/books.json` | JSON snapshot location |

## Architecture

```
src/
  domain/        pure accounting core (no I/O)
    money.ts       integer-cents money type
    accounts.ts    account types, normal balances, default chart of accounts
    journal.ts     journal entries + balance validation
    ledger.ts      posting, balances, trial balance
    reports.ts     profit & loss, balance sheet
    ids.ts         id generators (uuid / sequential for tests)
  service/
    books.ts       application service: invoices, expenses, payments, reports
  tax/
    categories.ts  Schedule C-style category keys
    estimate.ts    tax summary + configurable SE/income tax estimate
  persistence/
    repository.ts  BooksRepository: in-memory + atomic JSON-file store
  api/
    server.ts      Express REST API (Zod-validated)
  index.ts         server bootstrap
```

The domain layer is pure and framework-free; the service, persistence, and API
layers depend inward on it.

## API

All request money fields accept a decimal string or number in major units
(`"19.99"`); all response amounts are integer cents.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/accounts` | list accounts |
| POST | `/accounts` | create an account |
| POST | `/accounts/seed-default` | seed the default chart of accounts |
| GET | `/entries` | list journal entries |
| POST | `/entries` | post a raw balanced journal entry |
| POST | `/invoices` | record an invoice (debit receivable, credit revenue) |
| POST | `/expenses` | record an expense (debit expense, credit funding account) |
| POST | `/payments` | record a payment received (debit asset, credit cleared account) |
| GET | `/reports/trial-balance?asOf=` | trial balance |
| GET | `/reports/profit-loss?from=&to=` | profit & loss |
| GET | `/reports/balance-sheet?asOf=` | balance sheet |
| GET | `/tax/summary?from=&to=` | income/expense totals by tax category |
| GET | `/tax/estimate?from=&to=` | tax summary + estimated tax owed |

### Example

```bash
curl -X POST localhost:3000/accounts/seed-default
# grab the id of account 4000 (Service Revenue), then:
curl -X POST localhost:3000/invoices -H 'content-type: application/json' \
  -d '{"date":"2026-01-10","revenueAccountId":"<id>","amount":"5000.00","description":"Consulting"}'
curl localhost:3000/reports/profit-loss
curl localhost:3000/tax/estimate
```

## Tax estimate — read this

The tax figures are a **planning aid, not tax advice and not a filing**. Rates
in `DEFAULT_RATE_CONFIG` are deliberately simplified placeholders (a flat
self-employment rate plus a short progressive income schedule) and do **not**
reflect current law, filing status, deductions, or credits. Supply a reviewed
`TaxRateConfig` before relying on the numbers. Every estimate response carries a
disclaimer to this effect.

## Integrating with the HeXA platform

The live hexatech.app runs on Convex. To connect HeXA Books:

1. **As a service:** deploy this API and have the platform call it per client
   business (scope data by a `businessId` — a natural next step; the current
   store is single-tenant).
2. **As a library:** import the `src/domain` + `src/service` modules directly
   into a Node/Convex action and persist via a `BooksRepository` adapter backed
   by your database.

Multi-tenancy, authentication, and an accounting-provider sync (QuickBooks/Xero)
are intentionally out of scope for this first increment.
