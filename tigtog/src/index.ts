/**
 * Tigtog server bootstrap.
 *
 * Env:
 *   PORT                — HTTP port (default 3001)
 *   TIGTOG_DB_PATH      — JSON snapshot path (default ./data/tigtog.json)
 *   TIGTOG_MEDIA_DIR    — uploaded video directory (default ./data/media)
 *   TIGTOG_VOICE_DIR    — private voice-dataset recordings (default ./data/voice)
 *   TIGTOG_MAX_UPLOAD_MB — upload size limit in MB (default 50)
 */
import { resolve } from "node:path";
import { createServer, tigtogFromRepository } from "./api/server.js";
import { JsonFileRepository } from "./persistence/repository.js";

const port = Number(process.env.PORT ?? 3001);
const dbPath = resolve(process.env.TIGTOG_DB_PATH ?? "./data/tigtog.json");
const mediaDir = resolve(process.env.TIGTOG_MEDIA_DIR ?? "./data/media");
const voiceDir = resolve(process.env.TIGTOG_VOICE_DIR ?? "./data/voice");
const maxUploadBytes = Number(process.env.TIGTOG_MAX_UPLOAD_MB ?? 50) * 1024 * 1024;

const repository = new JsonFileRepository(dbPath);
const tigtog = await tigtogFromRepository(repository);
const app = createServer({ tigtog, repository, mediaDir, voiceDir, maxUploadBytes });

app.listen(port, () => {
  console.log(`Tigtog listening on http://localhost:${port}`);
  console.log(`  data:  ${dbPath}`);
  console.log(`  media: ${mediaDir}`);
});
