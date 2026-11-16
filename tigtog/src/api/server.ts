/**
 * Tigtog HTTP API + static web client.
 *
 * Auth: `Authorization: Bearer <token>` from /api/auth/signup or /api/auth/login.
 * Uploads: POST /api/media with the raw video as the body and its Content-Type
 * (video/mp4, video/webm or video/quicktime); then POST /api/posts with the
 * returned mediaId.
 */
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { z, ZodError } from "zod";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Tigtog } from "../service/tigtog.js";
import { TigtogError } from "../domain/types.js";
import { newId } from "../domain/auth.js";
import { type TigtogRepository, InMemoryRepository } from "../persistence/repository.js";

export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** Check the file signature so a mislabeled upload can't be served as video. */
export function looksLikeVideo(buf: Buffer, contentType: string): boolean {
  if (buf.length < 12) return false;
  if (contentType === "video/webm") {
    return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  }
  // MP4 / QuickTime: ISO base media file with an "ftyp" box at offset 4.
  return buf.subarray(4, 8).toString("latin1") === "ftyp";
}

const signupSchema = z.object({
  username: z.string(),
  password: z.string().max(200),
  displayName: z.string().max(50).optional(),
});
const loginSchema = z.object({ username: z.string(), password: z.string().max(200) });
const profileSchema = z.object({
  displayName: z.string().max(50).optional(),
  bio: z.string().max(160).optional(),
});
const postSchema = z.object({ caption: z.string().max(300).default(""), mediaId: z.string().min(1) });
const commentSchema = z.object({ text: z.string().min(1).max(300) });

export interface ServerOptions {
  tigtog: Tigtog;
  repository?: TigtogRepository;
  /** Directory where uploaded media files are stored. */
  mediaDir: string;
  /** Max upload size in bytes (default 50 MB). */
  maxUploadBytes?: number;
  /** Serve the bundled web client (default true). */
  serveClient?: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    userId?: string;
    token?: string;
  }
}

const PUBLIC_DIR = fileURLToPath(new URL("../../public", import.meta.url));

export function createServer(opts: ServerOptions): Express {
  const { tigtog, mediaDir } = opts;
  const repository = opts.repository ?? new InMemoryRepository();
  const maxUpload = opts.maxUploadBytes ?? 50 * 1024 * 1024;
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  let saveChain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    saveChain = saveChain
      .then(() => repository.save(tigtog.snapshot()))
      .catch((e) => console.error("tigtog: failed to persist state", e));
    return saveChain;
  };

  const wrap =
    (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res)).catch(next);
    };

  // Attach the viewer (if any) to every request.
  app.use((req, _res, next) => {
    const h = req.header("authorization");
    if (h?.startsWith("Bearer ")) {
      const token = h.slice(7).trim();
      const userId = tigtog.authenticate(token);
      if (userId) {
        req.userId = userId;
        req.token = token;
      }
    }
    next();
  });

  const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.userId) return next(new TigtogError(401, "unauthorized", "log in first"));
    next();
  };
  const me = (req: Request) => req.userId as string;
  const feedOpts = (req: Request) => ({
    viewerId: req.userId,
    limit: Number(req.query.limit) || undefined,
    cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
  });

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "tigtog" }));

  // ---------------------------------------------------------------- auth
  app.post(
    "/api/auth/signup",
    wrap(async (req, res) => {
      const result = tigtog.signUp(signupSchema.parse(req.body));
      await persist();
      res.status(201).json(result);
    }),
  );
  app.post(
    "/api/auth/login",
    wrap(async (req, res) => {
      const { username, password } = loginSchema.parse(req.body);
      const result = tigtog.logIn(username, password);
      await persist();
      res.json(result);
    }),
  );
  app.post(
    "/api/auth/logout",
    requireAuth,
    wrap(async (req, res) => {
      tigtog.logOut(req.token as string);
      await persist();
      res.status(204).end();
    }),
  );

  app.get("/api/me", requireAuth, (req, res) => res.json({ user: tigtog.getUser(me(req)) }));
  app.patch(
    "/api/me",
    requireAuth,
    wrap(async (req, res) => {
      const user = tigtog.updateProfile(me(req), profileSchema.parse(req.body));
      await persist();
      res.json({ user });
    }),
  );

  // --------------------------------------------------------------- media
  app.post(
    "/api/media",
    requireAuth,
    express.raw({ type: Object.keys(VIDEO_TYPES), limit: maxUpload }),
    wrap(async (req, res) => {
      const contentType = (req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      const ext = VIDEO_TYPES[contentType];
      if (!ext) {
        throw new TigtogError(400, "unsupported_media", "upload an MP4, WebM or MOV video");
      }
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new TigtogError(400, "empty_upload", "no video data received");
      }
      if (!looksLikeVideo(body, contentType)) {
        throw new TigtogError(400, "unsupported_media", "file is not a valid " + ext + " video");
      }
      const id = newId();
      const fileName = `${id}.${ext}`;
      await mkdir(mediaDir, { recursive: true });
      await writeFile(join(mediaDir, fileName), body);
      const media = tigtog.registerMedia({
        id,
        ownerId: me(req),
        fileName,
        contentType,
        size: body.length,
      });
      await persist();
      res.status(201).json({ media: { id: media.id, url: `/media/${fileName}`, size: media.size } });
    }),
  );

  app.use(
    "/media",
    express.static(mediaDir, {
      fallthrough: false,
      index: false,
      dotfiles: "deny",
      setHeaders: (res) => res.setHeader("X-Content-Type-Options", "nosniff"),
    }),
  );

  // --------------------------------------------------------------- posts
  app.post(
    "/api/posts",
    requireAuth,
    wrap(async (req, res) => {
      const post = tigtog.createPost(me(req), postSchema.parse(req.body));
      await persist();
      res.status(201).json({ post });
    }),
  );
  app.get("/api/posts/:id", (req, res) => {
    res.json({ post: tigtog.getPost(req.params.id!, req.userId) });
  });
  app.delete(
    "/api/posts/:id",
    requireAuth,
    wrap(async (req, res) => {
      const media = tigtog.deletePost(me(req), req.params.id!);
      await persist();
      if (media) await unlink(join(mediaDir, media.fileName)).catch(() => {});
      res.status(204).end();
    }),
  );
  app.post(
    "/api/posts/:id/view",
    wrap(async (req, res) => {
      const views = tigtog.recordView(req.params.id!);
      await persist();
      res.json({ views });
    }),
  );
  app.post(
    "/api/posts/:id/like",
    requireAuth,
    wrap(async (req, res) => {
      const r = tigtog.like(me(req), req.params.id!);
      await persist();
      res.json(r);
    }),
  );
  app.delete(
    "/api/posts/:id/like",
    requireAuth,
    wrap(async (req, res) => {
      const r = tigtog.unlike(me(req), req.params.id!);
      await persist();
      res.json(r);
    }),
  );
  app.get("/api/posts/:id/comments", (req, res) => {
    res.json({ comments: tigtog.listComments(req.params.id!) });
  });
  app.post(
    "/api/posts/:id/comments",
    requireAuth,
    wrap(async (req, res) => {
      const { text } = commentSchema.parse(req.body);
      const comment = tigtog.addComment(me(req), req.params.id!, text);
      await persist();
      res.status(201).json({ comment });
    }),
  );
  app.delete(
    "/api/comments/:id",
    requireAuth,
    wrap(async (req, res) => {
      tigtog.deleteComment(me(req), req.params.id!);
      await persist();
      res.status(204).end();
    }),
  );

  // --------------------------------------------------------------- feeds
  app.get("/api/feed/for-you", (req, res) => res.json(tigtog.forYouFeed(feedOpts(req))));
  app.get("/api/feed/following", requireAuth, (req, res) =>
    res.json(tigtog.followingFeed(me(req), feedOpts(req))),
  );
  app.get("/api/tags/:tag", (req, res) => res.json(tigtog.hashtagPosts(req.params.tag!, feedOpts(req))));
  app.get("/api/search", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    res.json(tigtog.search(q, req.userId));
  });

  // --------------------------------------------------------------- users
  app.get("/api/users/:username", (req, res) => {
    const user = tigtog.getUserByUsername(req.params.username!);
    res.json({ user, followedByMe: tigtog.isFollowing(req.userId, user.id) });
  });
  app.get("/api/users/:username/posts", (req, res) =>
    res.json(tigtog.userPosts(req.params.username!, feedOpts(req))),
  );
  app.post(
    "/api/users/:username/follow",
    requireAuth,
    wrap(async (req, res) => {
      const user = tigtog.follow(me(req), req.params.username!);
      await persist();
      res.json({ user, followedByMe: true });
    }),
  );
  app.delete(
    "/api/users/:username/follow",
    requireAuth,
    wrap(async (req, res) => {
      const user = tigtog.unfollow(me(req), req.params.username!);
      await persist();
      res.json({ user, followedByMe: false });
    }),
  );

  app.use("/api", (_req, _res, next) => next(new TigtogError(404, "not_found", "no such endpoint")));

  // ---------------------------------------------------------- web client
  if (opts.serveClient !== false) {
    app.use(express.static(PUBLIC_DIR, { index: "index.html" }));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "validation_error", issues: err.issues });
    }
    if (err instanceof TigtogError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e.type === "entity.too.large") {
      return res.status(413).json({ error: "too_large", message: "file is too large" });
    }
    if (e.type === "entity.parse.failed") {
      return res.status(400).json({ error: "bad_json", message: "request body is not valid JSON" });
    }
    if (e.status === 404) return res.status(404).json({ error: "not_found", message: "not found" });
    console.error(err);
    return res.status(500).json({ error: "internal_error", message: "something went wrong" });
  });

  return app;
}

export async function tigtogFromRepository(repository: TigtogRepository): Promise<Tigtog> {
  return Tigtog.hydrate(await repository.load());
}
