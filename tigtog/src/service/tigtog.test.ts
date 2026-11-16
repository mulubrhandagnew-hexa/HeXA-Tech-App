import { describe, it, expect } from "vitest";
import { Tigtog } from "./tigtog.js";
import { TigtogError } from "../domain/types.js";
import { parseHashtags, hashPassword, verifyPassword } from "../domain/auth.js";

function setup() {
  const t = new Tigtog();
  const a = t.signUp({ username: "Abeba", password: "password123", displayName: "Abeba" });
  const b = t.signUp({ username: "bini", password: "password123" });
  const post = (userId: string, caption = "hello #tigtog") => {
    const id = crypto.randomUUID();
    t.registerMedia({ id, ownerId: userId, fileName: `${id}.mp4`, contentType: "video/mp4", size: 10 });
    return t.createPost(userId, { caption, mediaId: id });
  };
  return { t, a: a.user, b: b.user, aToken: a.token, post };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as TigtogError).code;
  }
  return "no error";
};

describe("auth", () => {
  it("hashes and verifies passwords", () => {
    const h = hashPassword("s3cret-pass");
    expect(h).not.toContain("s3cret");
    expect(verifyPassword("s3cret-pass", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });

  it("signs up, logs in and out", () => {
    const { t, a, aToken } = setup();
    expect(a.username).toBe("abeba");
    expect(t.authenticate(aToken)).toBe(a.id);
    const { token } = t.logIn("ABEBA", "password123");
    expect(t.authenticate(token)).toBe(a.id);
    t.logOut(token);
    expect(t.authenticate(token)).toBeUndefined();
  });

  it("rejects bad usernames, weak passwords, duplicates and wrong passwords", () => {
    const { t } = setup();
    expect(code(() => t.signUp({ username: "a b", password: "password123" }))).toBe("invalid_username");
    expect(code(() => t.signUp({ username: "newbie", password: "short" }))).toBe("weak_password");
    expect(code(() => t.signUp({ username: "abeba", password: "password123" }))).toBe("username_taken");
    expect(code(() => t.logIn("abeba", "nope-nope"))).toBe("invalid_credentials");
  });

  it("never stores raw tokens or passwords", () => {
    const { t, aToken } = setup();
    const json = JSON.stringify(t.snapshot());
    expect(json).not.toContain(aToken);
    expect(json).not.toContain("password123");
  });
});

describe("posts and engagement", () => {
  it("parses hashtags", () => {
    expect(parseHashtags("Dance #Eskista and #eskista #Addis_2026!")).toEqual(["eskista", "addis_2026"]);
  });

  it("creates posts only from the uploader's own unused media", () => {
    const { t, a, b, post } = setup();
    const p = post(a.id);
    expect(p.hashtags).toEqual(["tigtog"]);
    expect(p.mediaUrl).toMatch(/^\/media\/.+\.mp4$/);
    t.registerMedia({ id: "m2", ownerId: a.id, fileName: "m2.mp4", contentType: "video/mp4", size: 1 });
    expect(code(() => t.createPost(b.id, { caption: "", mediaId: "m2" }))).toBe("forbidden");
    expect(code(() => t.createPost(a.id, { caption: "", mediaId: "missing" }))).toBe("media_not_found");
  });

  it("likes are idempotent per user", () => {
    const { t, a, b, post } = setup();
    const p = post(a.id);
    t.like(b.id, p.id);
    t.like(b.id, p.id);
    expect(t.getPost(p.id, b.id)).toMatchObject({ likes: 1, likedByMe: true });
    expect(t.getPost(p.id, a.id).likedByMe).toBe(false);
    t.unlike(b.id, p.id);
    expect(t.getPost(p.id).likes).toBe(0);
  });

  it("comments can be removed by their author or the post author only", () => {
    const { t, a, b, post } = setup();
    const p = post(a.id);
    const c1 = t.addComment(b.id, p.id, "nice!");
    const c2 = t.addComment(b.id, p.id, "again");
    const c = t.signUp({ username: "chala", password: "password123" }).user;
    expect(code(() => t.deleteComment(c.id, c1.id))).toBe("forbidden");
    t.deleteComment(b.id, c1.id);
    t.deleteComment(a.id, c2.id);
    expect(t.listComments(p.id)).toHaveLength(0);
    expect(code(() => t.addComment(b.id, p.id, "   "))).toBe("empty_comment");
  });

  it("deleting a post removes its likes, comments and media", () => {
    const { t, a, b, post } = setup();
    const p = post(a.id);
    t.like(b.id, p.id);
    t.addComment(b.id, p.id, "hi");
    expect(code(() => t.deletePost(b.id, p.id))).toBe("forbidden");
    const media = t.deletePost(a.id, p.id);
    expect(media?.fileName).toMatch(/\.mp4$/);
    const s = t.snapshot();
    expect(s.posts).toHaveLength(0);
    expect(s.likes).toHaveLength(0);
    expect(s.comments).toHaveLength(0);
    expect(s.media).toHaveLength(0);
  });
});

describe("follows and feeds", () => {
  it("follows, counts and unfollows", () => {
    const { t, a, b } = setup();
    expect(code(() => t.follow(a.id, "abeba"))).toBe("self_follow");
    expect(t.follow(a.id, "bini").followers).toBe(1);
    t.follow(a.id, "bini");
    expect(t.getUser(a.id).following).toBe(1);
    expect(t.unfollow(a.id, "bini").followers).toBe(0);
    void b;
  });

  it("following feed only shows followed authors, newest first", () => {
    const { t, a, b, post } = setup();
    post(a.id, "mine");
    post(b.id, "first");
    post(b.id, "second");
    expect(t.followingFeed(a.id).posts).toHaveLength(0);
    t.follow(a.id, "bini");
    const feed = t.followingFeed(a.id).posts;
    expect(feed.map((p) => p.caption)).toEqual(["second", "first"]);
    expect(feed[0]!.author.followedByMe).toBe(true);
  });

  it("for-you feed ranks engagement and paginates", () => {
    const { t, a, b, post } = setup();
    const quiet = post(a.id, "quiet");
    const hot = post(b.id, "hot");
    t.like(a.id, hot.id);
    t.addComment(a.id, hot.id, "🔥");
    void quiet;
    const page1 = t.forYouFeed({ limit: 1 });
    expect(page1.posts[0]!.caption).toBe("hot");
    expect(page1.nextCursor).toBe("1");
    const page2 = t.forYouFeed({ limit: 1, cursor: page1.nextCursor! });
    expect(page2.posts[0]!.caption).toBe("quiet");
    expect(page2.nextCursor).toBeNull();
  });

  it("finds posts by hashtag and search", () => {
    const { t, a, post } = setup();
    post(a.id, "coffee ceremony #buna");
    post(a.id, "other");
    expect(t.hashtagPosts("#BUNA").posts).toHaveLength(1);
    const r = t.search("abe");
    expect(r.users.map((u) => u.username)).toEqual(["abeba"]);
    expect(t.search("ceremony").posts).toHaveLength(1);
  });

  it("round-trips through snapshot/hydrate", () => {
    const { t, a, b, aToken, post } = setup();
    const p = post(a.id);
    t.like(b.id, p.id);
    t.follow(b.id, "abeba");
    const t2 = Tigtog.hydrate(t.snapshot());
    expect(t2.authenticate(aToken)).toBe(a.id);
    expect(t2.getPost(p.id, b.id)).toMatchObject({ likes: 1, likedByMe: true });
    expect(t2.getUser(a.id).followers).toBe(1);
  });
});
