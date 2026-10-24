/**
 * HeXA EV ReCharge server bootstrap.
 *
 * Env:
 *   PORT        — HTTP port (default 3100)
 *   HUB_DB_PATH — JSON snapshot path (default ./data/hub.json)
 */
import { createServer, hubFromRepository } from "./api/server.js";
import { JsonFileRepository } from "./persistence/repository.js";

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3100);
  const dbPath = process.env.HUB_DB_PATH ?? "./data/hub.json";

  const repository = new JsonFileRepository(dbPath);
  const hub = await hubFromRepository(repository);

  const app = createServer({ hub, repository });
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`HeXA EV ReCharge listening on http://localhost:${port} (db: ${dbPath})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start HeXA EV ReCharge:", err);
  process.exit(1);
});
