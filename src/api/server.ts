/**
 * HeXA Books REST API.
 *
 * A thin HTTP layer over the Books service. All monetary fields in requests
 * accept a decimal string or number in major units (e.g. "19.99") and are
 * converted to integer cents. All amounts in responses are integer cents.
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";
import { Books } from "../service/books.js";
import { toCents, MoneyError } from "../domain/money.js";
import { AccountError } from "../domain/accounts.js";
import { JournalError } from "../domain/journal.js";
import {
  type BooksRepository,
  InMemoryRepository,
  type BooksState,
} from "../persistence/repository.js";
import { taxSummary, estimateTax, type TaxRateConfig } from "../tax/estimate.js";

const money = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return toCents(v);
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    return z.NEVER;
  }
});

const accountTypeSchema = z.enum(["asset", "liability", "equity", "income", "expense"]);

const newAccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: accountTypeSchema,
  taxCategory: z.string().min(1).optional(),
});

const lineSchema = z
  .object({
    accountId: z.string().min(1),
    debit: money.optional(),
    credit: money.optional(),
    memo: z.string().optional(),
  })
  .refine((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0, {
    message: "line must have a debit or a credit",
  });

const entrySchema = z.object({
  date: z.string(),
  description: z.string().min(1),
  reference: z.string().optional(),
  lines: z.array(lineSchema).min(2),
});

const invoiceSchema = z.object({
  date: z.string(),
  revenueAccountId: z.string().min(1),
  receivableAccountId: z.string().min(1).optional(),
  amount: money,
  description: z.string().min(1),
  reference: z.string().optional(),
});

const expenseSchema = z.object({
  date: z.string(),
  expenseAccountId: z.string().min(1),
  paidFromAccountId: z.string().min(1),
  amount: money,
  description: z.string().min(1),
  reference: z.string().optional(),
});

const paymentSchema = z.object({
  date: z.string(),
  toAccountId: z.string().min(1),
  fromAccountId: z.string().min(1),
  amount: money,
  description: z.string().min(1),
  reference: z.string().optional(),
});

export interface ServerOptions {
  books: Books;
  repository?: BooksRepository;
  /** Optional override for tax estimate rates. */
  rateConfig?: TaxRateConfig;
}

function snapshot(books: Books): BooksState {
  return { accounts: books.listAccounts(), entries: books.listEntries() };
}

export function createServer(opts: ServerOptions): Express {
  const { books } = opts;
  const repository = opts.repository ?? new InMemoryRepository();
  const app = express();
  app.use(express.json());

  // Serialize persistence so concurrent writes can't interleave a save.
  let saveChain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    saveChain = saveChain.then(() => repository.save(snapshot(books))).catch(() => {});
    return saveChain;
  };

  const wrap =
    (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res)).catch(next);
    };

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "hexa-books" });
  });

  app.get("/accounts", (_req, res) => {
    res.json({ accounts: books.listAccounts() });
  });

  app.post(
    "/accounts",
    wrap(async (req, res) => {
      const input = newAccountSchema.parse(req.body);
      const account = books.createAccount(input);
      await persist();
      res.status(201).json({ account });
    }),
  );

  app.post(
    "/accounts/seed-default",
    wrap(async (_req, res) => {
      const accounts = books.seedDefaultChart();
      await persist();
      res.status(201).json({ accounts });
    }),
  );

  app.get("/entries", (_req, res) => {
    res.json({ entries: books.listEntries() });
  });

  app.post(
    "/entries",
    wrap(async (req, res) => {
      const input = entrySchema.parse(req.body);
      const entry = books.recordEntry(input);
      await persist();
      res.status(201).json({ entry });
    }),
  );

  app.post(
    "/invoices",
    wrap(async (req, res) => {
      const input = invoiceSchema.parse(req.body);
      const entry = books.recordInvoice(input);
      await persist();
      res.status(201).json({ entry });
    }),
  );

  app.post(
    "/expenses",
    wrap(async (req, res) => {
      const input = expenseSchema.parse(req.body);
      const entry = books.recordExpense(input);
      await persist();
      res.status(201).json({ entry });
    }),
  );

  app.post(
    "/payments",
    wrap(async (req, res) => {
      const input = paymentSchema.parse(req.body);
      const entry = books.recordPayment(input);
      await persist();
      res.status(201).json({ entry });
    }),
  );

  app.get("/reports/trial-balance", (req, res) => {
    const asOf = typeof req.query.asOf === "string" ? req.query.asOf : undefined;
    res.json(books.trialBalance(asOf ? { asOf } : {}));
  });

  app.get("/reports/profit-loss", (req, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    res.json(books.profitAndLoss({ ...(from ? { from } : {}), ...(to ? { to } : {}) }));
  });

  app.get("/reports/balance-sheet", (req, res) => {
    const asOf = typeof req.query.asOf === "string" ? req.query.asOf : undefined;
    res.json(books.balanceSheet(asOf ? { asOf } : {}));
  });

  app.get("/tax/summary", (req, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    res.json(taxSummary(books, { ...(from ? { from } : {}), ...(to ? { to } : {}) }));
  });

  app.get("/tax/estimate", (req, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    const summary = taxSummary(books, { ...(from ? { from } : {}), ...(to ? { to } : {}) });
    const estimate = estimateTax(summary.netProfit, opts.rateConfig);
    res.json({ summary, estimate });
  });

  // Error handler: map domain errors to 400, everything else to 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "validation_error", issues: err.issues });
    }
    if (err instanceof AccountError || err instanceof JournalError || err instanceof MoneyError) {
      return res.status(400).json({ error: "bad_request", message: (err as Error).message });
    }
    return res.status(500).json({ error: "internal_error", message: (err as Error).message });
  });

  return app;
}

/** Build a Books instance from a repository's persisted state. */
export async function booksFromRepository(repository: BooksRepository): Promise<Books> {
  const state = await repository.load();
  return Books.hydrate(state.accounts, state.entries);
}
