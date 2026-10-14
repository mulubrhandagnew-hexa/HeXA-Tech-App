/**
 * HeXA Books server bootstrap.
 *
 * Env:
 *   PORT          — HTTP port (default 3000)
 *   BOOKS_DB_PATH — JSON snapshot path (default ./data/books.json)
 */
import { createServer, booksFromRepository } from "./api/server.js";
import { JsonFileRepository } from "./persistence/repository.js";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const dbPath = process.env.BOOKS_DB_PATH ?? "./data/books.json";

  const repository = new JsonFileRepository(dbPath);
  const books = await booksFromRepository(repository);

  const app = createServer({ books, repository });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`HeXA Books listening on http://localhost:${port} (db: ${dbPath})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start HeXA Books:", err);
  process.exit(1);
});
