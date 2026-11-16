import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, looksLikeAudio } from "./server.js";
import { Tigtog } from "../service/tigtog.js";
import { InMemoryRepository } from "../persistence/repository.js";

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40)]);
const CONSENT = { version: 1, adult: true, ownVoice: true, agree: true };

let root: string;
let mediaDir: string;
let voiceDir: string;
let app: ReturnType<typeof createServer>;
let repo: InMemoryRepository;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tigtog-voice-"));
  mediaDir = join(root, "media");
  voiceDir = join(root, "voice");
  repo = new InMemoryRepository();
  app = createServer({ tigtog: new Tigtog(), repository: repo, mediaDir, voiceDir });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function signup(username: string) {
  const r = await request(app).post("/api/auth/signup").send({ username, password: "password123" }).expect(201);
  return { Authorization: `Bearer ${r.body.token}` };
}
const upload = (auth: object, body = WEBM, type = "audio/webm") =>
  request(app).post("/api/voice/audio").set(auth).set("Content-Type", type).send(body);

function sample(audioId: string) {
  return {
    audioId, promptId: "ti-sweep-0", kind: "sweep", language: "ti",
    text: "ሀ ሁ ሂ ሃ ሄ ህ ሆ", phonemes: "h ae | h u | h i | h a | h e | h | h o",
    notes: [{ syllable: "ሀ", midi: 57, start: 0.5, dur: 0.7 }],
    bpm: 76, cents: 0, durationSec: 7.2,
  };
}

describe("voice dataset API", () => {
  it("checks audio signatures", () => {
    expect(looksLikeAudio(WEBM, "audio/webm")).toBe(true);
    expect(looksLikeAudio(Buffer.from("OggS" + "x".repeat(20)), "audio/ogg")).toBe(true);
    expect(looksLikeAudio(Buffer.from("RIFF0000WAVEfmt "), "audio/wav")).toBe(true);
    expect(looksLikeAudio(Buffer.from("<html>nope</html>"), "audio/webm")).toBe(false);
  });

  it("refuses a voice directory inside the public media directory", () => {
    expect(() => createServer({ tigtog: new Tigtog(), mediaDir, voiceDir: join(mediaDir, "voice") })).toThrow(/voiceDir/);
  });

  it("requires login and explicit, complete consent before recording", async () => {
    await request(app).get("/api/voice/consent").expect(401);
    const a = await signup("abeba");
    expect((await upload(a)).status).toBe(403);
    await request(app).post("/api/voice/consent").set(a).send({ ...CONSENT, adult: false }).expect(400);
    await request(app).post("/api/voice/consent").set(a).send({ ...CONSENT, version: 0 }).expect(400);
    await request(app).post("/api/voice/consent").set(a).send(CONSENT).expect(201);
    const c = await request(app).get("/api/voice/consent").set(a).expect(200);
    expect(c.body).toMatchObject({ consent: { version: 1 }, currentVersion: 1 });
  });

  it("stores labelled samples privately and reports stats", async () => {
    const a = await signup("abeba");
    await request(app).post("/api/voice/consent").set(a).send(CONSENT).expect(201);
    expect((await upload(a, Buffer.from("not audio at all"))).status).toBe(400);
    const up = await upload(a);
    expect(up.status).toBe(201);
    const s = await request(app).post("/api/voice/samples").set(a).send(sample(up.body.audio.id)).expect(201);
    expect(s.body.sample).toMatchObject({ language: "ti", consentVersion: 1, notes: [{ midi: 57 }] });
    await request(app).post("/api/voice/samples").set(a).send(sample(up.body.audio.id)).expect(409);

    // Files are on disk in the private dir, and not reachable over HTTP.
    const files = await readdir(voiceDir);
    expect(files).toHaveLength(1);
    await request(app).get(`/media/${files[0]}`).expect(404);
    await request(app).get(`/voice/${files[0]}`).expect((r) => expect(r.text).not.toContain("\u001aE"));

    const stats = await request(app).get("/api/voice/stats").expect(200);
    expect(stats.body.stats).toEqual([
      { language: "ti", samples: 1, minutes: 0.1, singers: 1 },
      { language: "am", samples: 0, minutes: 0, singers: 0 },
    ]);
    expect((await repo.load()).voiceSamples).toHaveLength(1);
  });

  it("only the singer can see or delete their recordings", async () => {
    const a = await signup("abeba");
    const b = await signup("bini");
    await request(app).post("/api/voice/consent").set(a).send(CONSENT);
    await request(app).post("/api/voice/consent").set(b).send(CONSENT);
    const up = await upload(a);
    // b cannot attach a's audio
    await request(app).post("/api/voice/samples").set(b).send(sample(up.body.audio.id)).expect(400);
    const s = await request(app).post("/api/voice/samples").set(a).send(sample(up.body.audio.id)).expect(201);
    expect((await request(app).get("/api/voice/samples").set(b)).body.samples).toHaveLength(0);
    await request(app).delete(`/api/voice/samples/${s.body.sample.id}`).set(b).expect(403);
    await request(app).delete(`/api/voice/samples/${s.body.sample.id}`).set(a).expect(204);
    expect(await readdir(voiceDir)).toHaveLength(0);
  });

  it("withdrawing consent deletes every recording and blocks new ones", async () => {
    const a = await signup("abeba");
    await request(app).post("/api/voice/consent").set(a).send(CONSENT);
    for (let i = 0; i < 3; i++) {
      const up = await upload(a);
      await request(app).post("/api/voice/samples").set(a).send({ ...sample(up.body.audio.id), promptId: `p${i}` }).expect(201);
    }
    expect(await readdir(voiceDir)).toHaveLength(3);
    await request(app).delete("/api/voice/consent").set(a).expect(204);
    expect(await readdir(voiceDir)).toHaveLength(0);
    expect((await request(app).get("/api/voice/samples").set(a)).body.samples).toHaveLength(0);
    expect((await upload(a)).status).toBe(403);
    const saved = await repo.load();
    expect(saved.voiceSamples).toHaveLength(0);
    expect(saved.voiceConsents).toHaveLength(0);
  });
});
