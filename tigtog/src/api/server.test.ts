import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, looksLikeVideo } from "./server.js";
import { Tigtog } from "../service/tigtog.js";
import { InMemoryRepository } from "../persistence/repository.js";

// Minimal bytes that pass the MP4 signature check ("....ftypisom").
const FAKE_MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom", "latin1"),
  Buffer.alloc(32),
]);

let mediaDir: string;
let repo: InMemoryRepository;
let app: ReturnType<typeof createServer>;

beforeEach(async () => {
  mediaDir = await mkdtemp(join(tmpdir(), "tigtog-media-"));
  repo = new InMemoryRepository();
  app = createServer({ tigtog: new Tigtog(), repository: repo, mediaDir, maxUploadBytes: 1024 });
});
afterEach(async () => {
  await rm(mediaDir, { recursive: true, force: true });
});

async function signup(username: string) {
  const res = await request(app)
    .post("/api/auth/signup")
    .send({ username, password: "password123" })
    .expect(201);
  return res.body.token as string;
}

async function upload(token: string, body = FAKE_MP4, type = "video/mp4") {
  return request(app)
    .post("/api/media")
    .set("Authorization", `Bearer ${token}`)
    .set("Content-Type", type)
    .send(body);
}

async function publish(token: string, caption: string, extra: Record<string, string> = {}) {
  const media = await upload(token);
  expect(media.status).toBe(201);
  const res = await request(app)
    .post("/api/posts")
    .set("Authorization", `Bearer ${token}`)
    .send({ caption, mediaId: media.body.media.id, ...extra })
    .expect(201);
  return res.body.post;
}

describe("file signature check", () => {
  it("accepts mp4/webm signatures and rejects others", () => {
    expect(looksLikeVideo(FAKE_MP4, "video/mp4")).toBe(true);
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Array(12).fill(0)]);
    expect(looksLikeVideo(webm, "video/webm")).toBe(true);
    expect(looksLikeVideo(Buffer.from("<html><script>x</script></html>"), "video/mp4")).toBe(false);
  });
});

describe("Tigtog API", () => {
  it("health check", async () => {
    await request(app).get("/health").expect(200, { status: "ok", service: "tigtog" });
  });

  it("signup, me, login, logout", async () => {
    const token = await signup("abeba");
    const me = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`).expect(200);
    expect(me.body.user.username).toBe("abeba");
    expect(me.body.user.passwordHash).toBeUndefined();

    await request(app).post("/api/auth/login").send({ username: "abeba", password: "bad-pass" }).expect(401);
    await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`).expect(204);
    await request(app).get("/api/me").set("Authorization", `Bearer ${token}`).expect(401);
  });

  it("requires auth for writes", async () => {
    await request(app).post("/api/posts").send({ caption: "x", mediaId: "y" }).expect(401);
    await request(app).post("/api/media").set("Content-Type", "video/mp4").send(FAKE_MP4).expect(401);
  });

  it("validates uploads: type, signature and size", async () => {
    const token = await signup("abeba");
    expect((await upload(token, Buffer.from("not a video at all"), "video/mp4")).status).toBe(400);
    expect((await upload(token, FAKE_MP4, "image/png")).status).toBe(400);
    expect((await upload(token, Buffer.concat([FAKE_MP4, Buffer.alloc(2048)]))).status).toBe(413);
    const ok = await upload(token);
    expect(ok.status).toBe(201);
    const file = await request(app).get(ok.body.media.url).expect(200);
    expect(file.headers["content-type"]).toBe("video/mp4");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("full social flow: post, like, comment, follow, feeds", async () => {
    const a = await signup("abeba");
    const b = await signup("bini");
    const post = await publish(a, "Weekend in Mekelle #travel");
    const authB = { Authorization: `Bearer ${b}` };

    await request(app).post(`/api/posts/${post.id}/view`).expect(200, { views: 1 });
    const like = await request(app).post(`/api/posts/${post.id}/like`).set(authB).expect(200);
    expect(like.body).toEqual({ likes: 1, likedByMe: true });
    await request(app).post(`/api/posts/${post.id}/comments`).set(authB).send({ text: "Beautiful!" }).expect(201);
    const comments = await request(app).get(`/api/posts/${post.id}/comments`).expect(200);
    expect(comments.body.comments[0]).toMatchObject({ text: "Beautiful!", author: { username: "bini" } });

    await request(app).get("/api/feed/following").set(authB).expect(200, { posts: [], nextCursor: null });
    await request(app).post("/api/users/abeba/follow").set(authB).expect(200);
    const following = await request(app).get("/api/feed/following").set(authB).expect(200);
    expect(following.body.posts).toHaveLength(1);
    expect(following.body.posts[0]).toMatchObject({ likedByMe: true, likes: 1, comments: 1, views: 1 });

    const forYou = await request(app).get("/api/feed/for-you").expect(200);
    expect(forYou.body.posts[0].likedByMe).toBe(false); // anonymous viewer

    const profile = await request(app).get("/api/users/abeba").set(authB).expect(200);
    expect(profile.body).toMatchObject({ user: { followers: 1, posts: 1 }, followedByMe: true });

    const tag = await request(app).get("/api/tags/travel").expect(200);
    expect(tag.body.posts).toHaveLength(1);

    // Persisted after writes.
    const saved = await repo.load();
    expect(saved.posts).toHaveLength(1);
    expect(saved.likes).toHaveLength(1);
  });

  it("only the author can delete a post; deleting removes the file", async () => {
    const a = await signup("abeba");
    const b = await signup("bini");
    const post = await publish(a, "bye");
    await request(app).delete(`/api/posts/${post.id}`).set("Authorization", `Bearer ${b}`).expect(403);
    expect(await readdir(mediaDir)).toHaveLength(1);
    await request(app).delete(`/api/posts/${post.id}`).set("Authorization", `Bearer ${a}`).expect(204);
    expect(await readdir(mediaDir)).toHaveLength(0);
    await request(app).get(`/api/posts/${post.id}`).expect(404);
  });

  it("returns JSON errors for bad input and unknown routes", async () => {
    await request(app).post("/api/auth/signup").send({ username: "x" }).expect(400);
    await request(app)
      .post("/api/auth/signup")
      .set("Content-Type", "application/json")
      .send("{bad json")
      .expect(400);
    await request(app).get("/api/nope").expect(404);
    await request(app).get("/media/missing.mp4").expect(404);
  });

  it("tags posts with language and kind, and filters feeds by language", async () => {
    const a = await signup("abeba");
    const ti = await publish(a, "ሰላም #ጓይላ", { language: "ti", kind: "music" });
    expect(ti).toMatchObject({ language: "ti", kind: "music", hashtags: ["ጓይላ"] });
    const plain = await publish(a, "hello");
    expect(plain).toMatchObject({ language: "other", kind: "video" });
    await publish(a, "እንኳን ደህና መጡ", { language: "am" });

    const tiFeed = await request(app).get("/api/feed/for-you?lang=ti").expect(200);
    expect(tiFeed.body.posts.map((p: { id: string }) => p.id)).toEqual([ti.id]);
    const amFeed = await request(app).get("/api/users/abeba/posts?lang=am").expect(200);
    expect(amFeed.body.posts).toHaveLength(1);
    const all = await request(app).get("/api/feed/for-you?lang=nonsense").expect(200);
    expect(all.body.posts).toHaveLength(3);
    const tag = await request(app).get(`/api/tags/${encodeURIComponent("ጓይላ")}`).expect(200);
    expect(tag.body.posts).toHaveLength(1);

    const media = await upload(a);
    await request(app)
      .post("/api/posts")
      .set("Authorization", `Bearer ${a}`)
      .send({ caption: "", mediaId: media.body.media.id, language: "fr" })
      .expect(400);
  });

  it("serves the web client", async () => {
    const res = await request(app).get("/").expect(200);
    expect(res.text).toContain("<title>Tigtog</title>");
  });
});
