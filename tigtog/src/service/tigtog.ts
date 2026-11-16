/**
 * Tigtog core service: accounts, sessions, posts, engagement and feeds.
 *
 * Pure in-memory logic with no I/O. Persistence is handled by the caller via
 * `snapshot()` / `Tigtog.hydrate()`; media bytes are stored by the API layer.
 */
import {
  type Comment,
  type FeedPost,
  type Language,
  type PostKind,
  type Follow,
  type Like,
  type Media,
  type Post,
  type PublicUser,
  type Session,
  type TigtogState,
  type User,
  TigtogError,
  emptyState,
} from "../domain/types.js";
import {
  hashPassword,
  hashToken,
  newId,
  newToken,
  parseHashtags,
  verifyPassword,
} from "../domain/auth.js";

export const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

export interface FeedPage {
  posts: FeedPost[];
  nextCursor: string | null;
}

export interface FeedOptions {
  viewerId?: string | undefined;
  limit?: number;
  cursor?: string | undefined;
  /** Only posts in this language. */
  language?: Language | undefined;
  /** Injected clock for deterministic ranking in tests. */
  now?: Date;
}

const likeKey = (postId: string, userId: string) => `${postId}:${userId}`;
const followKey = (followerId: string, followeeId: string) => `${followerId}:${followeeId}`;

export class Tigtog {
  private users = new Map<string, User>();
  private usernames = new Map<string, string>(); // username -> id
  private sessions = new Map<string, Session>(); // tokenHash -> session
  private media = new Map<string, Media>();
  private posts = new Map<string, Post>();
  private likes = new Map<string, Like>();
  private comments = new Map<string, Comment>();
  private follows = new Map<string, Follow>();

  static hydrate(state: TigtogState): Tigtog {
    const t = new Tigtog();
    for (const u of state.users) {
      t.users.set(u.id, u);
      t.usernames.set(u.username, u.id);
    }
    for (const s of state.sessions) t.sessions.set(s.tokenHash, s);
    for (const m of state.media) t.media.set(m.id, m);
    // Posts saved before language/kind existed default to "other"/"video".
    for (const p of state.posts) t.posts.set(p.id, { ...p, language: p.language ?? "other", kind: p.kind ?? "video" });
    for (const l of state.likes) t.likes.set(likeKey(l.postId, l.userId), l);
    for (const c of state.comments) t.comments.set(c.id, c);
    for (const f of state.follows) t.follows.set(followKey(f.followerId, f.followeeId), f);
    return t;
  }

  snapshot(): TigtogState {
    const s = emptyState();
    s.users = [...this.users.values()];
    s.sessions = [...this.sessions.values()];
    s.media = [...this.media.values()];
    s.posts = [...this.posts.values()];
    s.likes = [...this.likes.values()];
    s.comments = [...this.comments.values()];
    s.follows = [...this.follows.values()];
    return structuredClone(s);
  }

  // ---------------------------------------------------------------- accounts

  signUp(input: { username: string; password: string; displayName?: string }): {
    user: PublicUser;
    token: string;
  } {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      throw new TigtogError(
        400,
        "invalid_username",
        "username must be 3-24 characters: lowercase letters, digits, _ or .",
      );
    }
    if (input.password.length < 8) {
      throw new TigtogError(400, "weak_password", "password must be at least 8 characters");
    }
    if (this.usernames.has(username)) {
      throw new TigtogError(409, "username_taken", "that username is already taken");
    }
    const user: User = {
      id: newId(),
      username,
      displayName: (input.displayName ?? "").trim() || username,
      bio: "",
      passwordHash: hashPassword(input.password),
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    this.usernames.set(username, user.id);
    return { user: this.publicUser(user), token: this.startSession(user.id) };
  }

  logIn(usernameRaw: string, password: string): { user: PublicUser; token: string } {
    const id = this.usernames.get(usernameRaw.trim().toLowerCase());
    const user = id ? this.users.get(id) : undefined;
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new TigtogError(401, "invalid_credentials", "wrong username or password");
    }
    return { user: this.publicUser(user), token: this.startSession(user.id) };
  }

  logOut(token: string): void {
    this.sessions.delete(hashToken(token));
  }

  /** Resolve a bearer token to a user id, or undefined if invalid. */
  authenticate(token: string): string | undefined {
    const s = this.sessions.get(hashToken(token));
    return s && this.users.has(s.userId) ? s.userId : undefined;
  }

  private startSession(userId: string): string {
    const token = newToken();
    this.sessions.set(hashToken(token), {
      tokenHash: hashToken(token),
      userId,
      createdAt: new Date().toISOString(),
    });
    return token;
  }

  updateProfile(userId: string, patch: { displayName?: string; bio?: string }): PublicUser {
    const user = this.requireUser(userId);
    if (patch.displayName !== undefined) user.displayName = patch.displayName.trim() || user.username;
    if (patch.bio !== undefined) user.bio = patch.bio.trim();
    return this.publicUser(user);
  }

  getUserByUsername(username: string): PublicUser {
    const id = this.usernames.get(username.toLowerCase());
    if (!id) throw new TigtogError(404, "user_not_found", "no such user");
    return this.publicUser(this.requireUser(id));
  }

  getUser(id: string): PublicUser {
    return this.publicUser(this.requireUser(id));
  }

  private requireUser(id: string): User {
    const u = this.users.get(id);
    if (!u) throw new TigtogError(404, "user_not_found", "no such user");
    return u;
  }

  private publicUser(u: User): PublicUser {
    let followers = 0;
    let following = 0;
    for (const f of this.follows.values()) {
      if (f.followeeId === u.id) followers++;
      if (f.followerId === u.id) following++;
    }
    let posts = 0;
    for (const p of this.posts.values()) if (p.authorId === u.id) posts++;
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      bio: u.bio,
      createdAt: u.createdAt,
      followers,
      following,
      posts,
    };
  }

  // ------------------------------------------------------------------- media

  registerMedia(input: Omit<Media, "createdAt">): Media {
    const m: Media = { ...input, createdAt: new Date().toISOString() };
    this.media.set(m.id, m);
    return m;
  }

  getMedia(id: string): Media | undefined {
    return this.media.get(id);
  }

  // ------------------------------------------------------------------- posts

  createPost(
    authorId: string,
    input: { caption: string; mediaId: string; language?: Language; kind?: PostKind },
  ): FeedPost {
    this.requireUser(authorId);
    const media = this.media.get(input.mediaId);
    if (!media) throw new TigtogError(400, "media_not_found", "upload the video first");
    if (media.ownerId !== authorId) {
      throw new TigtogError(403, "forbidden", "you can only post your own uploads");
    }
    for (const p of this.posts.values()) {
      if (p.mediaId === media.id) {
        throw new TigtogError(409, "media_in_use", "this upload is already posted");
      }
    }
    const caption = input.caption.trim();
    const post: Post = {
      id: newId(),
      authorId,
      caption,
      language: input.language ?? "other",
      kind: input.kind ?? "video",
      hashtags: parseHashtags(caption),
      mediaId: media.id,
      views: 0,
      createdAt: new Date().toISOString(),
    };
    this.posts.set(post.id, post);
    return this.toFeedPost(post, authorId);
  }

  getPost(postId: string, viewerId?: string): FeedPost {
    return this.toFeedPost(this.requirePost(postId), viewerId);
  }

  /** Delete a post (author only). Returns the media file to remove, if any. */
  deletePost(userId: string, postId: string): Media | undefined {
    const post = this.requirePost(postId);
    if (post.authorId !== userId) {
      throw new TigtogError(403, "forbidden", "you can only delete your own posts");
    }
    this.posts.delete(postId);
    for (const [k, l] of this.likes) if (l.postId === postId) this.likes.delete(k);
    for (const [k, c] of this.comments) if (c.postId === postId) this.comments.delete(k);
    const media = this.media.get(post.mediaId);
    this.media.delete(post.mediaId);
    return media;
  }

  recordView(postId: string): number {
    const post = this.requirePost(postId);
    post.views += 1;
    return post.views;
  }

  private requirePost(id: string): Post {
    const p = this.posts.get(id);
    if (!p) throw new TigtogError(404, "post_not_found", "no such post");
    return p;
  }

  // -------------------------------------------------------------- engagement

  like(userId: string, postId: string): { likes: number; likedByMe: true } {
    this.requireUser(userId);
    this.requirePost(postId);
    const k = likeKey(postId, userId);
    if (!this.likes.has(k)) {
      this.likes.set(k, { postId, userId, createdAt: new Date().toISOString() });
    }
    return { likes: this.likeCount(postId), likedByMe: true };
  }

  unlike(userId: string, postId: string): { likes: number; likedByMe: false } {
    this.requirePost(postId);
    this.likes.delete(likeKey(postId, userId));
    return { likes: this.likeCount(postId), likedByMe: false };
  }

  addComment(userId: string, postId: string, text: string) {
    const author = this.requireUser(userId);
    this.requirePost(postId);
    const body = text.trim();
    if (!body) throw new TigtogError(400, "empty_comment", "comment cannot be empty");
    const c: Comment = {
      id: newId(),
      postId,
      authorId: userId,
      text: body,
      createdAt: new Date().toISOString(),
    };
    this.comments.set(c.id, c);
    return this.toPublicComment(c, author);
  }

  listComments(postId: string) {
    this.requirePost(postId);
    return [...this.comments.values()]
      .filter((c) => c.postId === postId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => this.toPublicComment(c, this.users.get(c.authorId)));
  }

  deleteComment(userId: string, commentId: string): void {
    const c = this.comments.get(commentId);
    if (!c) throw new TigtogError(404, "comment_not_found", "no such comment");
    const post = this.posts.get(c.postId);
    // The comment's author or the post's author may remove a comment.
    if (c.authorId !== userId && post?.authorId !== userId) {
      throw new TigtogError(403, "forbidden", "you cannot delete this comment");
    }
    this.comments.delete(commentId);
  }

  private toPublicComment(c: Comment, author: User | undefined) {
    return {
      id: c.id,
      postId: c.postId,
      text: c.text,
      createdAt: c.createdAt,
      author: author
        ? { id: author.id, username: author.username, displayName: author.displayName }
        : { id: c.authorId, username: "deleted", displayName: "deleted" },
    };
  }

  follow(followerId: string, followeeUsername: string): PublicUser {
    this.requireUser(followerId);
    const target = this.usernames.get(followeeUsername.toLowerCase());
    if (!target) throw new TigtogError(404, "user_not_found", "no such user");
    if (target === followerId) throw new TigtogError(400, "self_follow", "you cannot follow yourself");
    const k = followKey(followerId, target);
    if (!this.follows.has(k)) {
      this.follows.set(k, { followerId, followeeId: target, createdAt: new Date().toISOString() });
    }
    return this.getUser(target);
  }

  unfollow(followerId: string, followeeUsername: string): PublicUser {
    const target = this.usernames.get(followeeUsername.toLowerCase());
    if (!target) throw new TigtogError(404, "user_not_found", "no such user");
    this.follows.delete(followKey(followerId, target));
    return this.getUser(target);
  }

  isFollowing(followerId: string | undefined, followeeId: string): boolean {
    return !!followerId && this.follows.has(followKey(followerId, followeeId));
  }

  private likeCount(postId: string): number {
    let n = 0;
    for (const l of this.likes.values()) if (l.postId === postId) n++;
    return n;
  }

  private commentCount(postId: string): number {
    let n = 0;
    for (const c of this.comments.values()) if (c.postId === postId) n++;
    return n;
  }

  // ------------------------------------------------------------------- feeds

  /**
   * "For you" feed: every post, ranked by engagement decayed by age.
   *   score = (1 + 3·likes + 5·comments + 0.1·views) / (ageHours + 2)^1.5
   */
  forYouFeed(opts: FeedOptions = {}): FeedPage {
    const now = (opts.now ?? new Date()).getTime();
    const scored = [...this.posts.values()].map((p) => {
      const ageHours = Math.max(0, (now - Date.parse(p.createdAt)) / 3_600_000);
      const engagement =
        1 + 3 * this.likeCount(p.id) + 5 * this.commentCount(p.id) + 0.1 * p.views;
      return { p, score: engagement / Math.pow(ageHours + 2, 1.5) };
    });
    scored.sort((a, b) => b.score - a.score || b.p.createdAt.localeCompare(a.p.createdAt));
    return this.page(
      scored.map((s) => s.p),
      opts,
    );
  }

  /** Posts from accounts the viewer follows, newest first. */
  followingFeed(viewerId: string, opts: FeedOptions = {}): FeedPage {
    const posts = this.postsNewestFirst()
      .filter((p) => this.follows.has(followKey(viewerId, p.authorId)));
    return this.page(posts, { ...opts, viewerId });
  }

  userPosts(username: string, opts: FeedOptions = {}): FeedPage {
    const id = this.usernames.get(username.toLowerCase());
    if (!id) throw new TigtogError(404, "user_not_found", "no such user");
    const posts = this.postsNewestFirst().filter((p) => p.authorId === id);
    return this.page(posts, opts);
  }

  hashtagPosts(tag: string, opts: FeedOptions = {}): FeedPage {
    const t = tag.replace(/^#/, "").toLowerCase();
    const posts = this.postsNewestFirst().filter((p) => p.hashtags.includes(t));
    return this.page(posts, opts);
  }

  search(query: string, viewerId?: string) {
    const q = query.trim().toLowerCase();
    if (!q) return { users: [], posts: [] };
    const users = [...this.users.values()]
      .filter((u) => u.username.includes(q) || u.displayName.toLowerCase().includes(q))
      .slice(0, 20)
      .map((u) => this.publicUser(u));
    const posts = this.postsNewestFirst()
      .filter((p) => p.caption.toLowerCase().includes(q))
      .slice(0, 20)
      .map((p) => this.toFeedPost(p, viewerId));
    return { users, posts };
  }

  /** Newest first; ties (same millisecond) broken by insertion order. */
  private postsNewestFirst(): Post[] {
    return [...this.posts.values()].reverse().sort(byNewest);
  }

  /** Offset-based pagination; cursor is the stringified offset. */
  private page(all: Post[], opts: FeedOptions): FeedPage {
    const posts = opts.language ? all.filter((p) => p.language === opts.language) : all;
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const offset = Math.max(0, Number.parseInt(opts.cursor ?? "0", 10) || 0);
    const slice = posts.slice(offset, offset + limit);
    const next = offset + limit < posts.length ? String(offset + limit) : null;
    return { posts: slice.map((p) => this.toFeedPost(p, opts.viewerId)), nextCursor: next };
  }

  private toFeedPost(p: Post, viewerId?: string): FeedPost {
    const author = this.users.get(p.authorId);
    const media = this.media.get(p.mediaId);
    return {
      id: p.id,
      caption: p.caption,
      language: p.language,
      kind: p.kind,
      hashtags: p.hashtags,
      mediaUrl: media ? `/media/${media.fileName}` : "",
      contentType: media?.contentType ?? "",
      views: p.views,
      likes: this.likeCount(p.id),
      comments: this.commentCount(p.id),
      likedByMe: !!viewerId && this.likes.has(likeKey(p.id, viewerId)),
      createdAt: p.createdAt,
      author: {
        id: p.authorId,
        username: author?.username ?? "deleted",
        displayName: author?.displayName ?? "deleted",
        followedByMe: this.isFollowing(viewerId, p.authorId),
      },
    };
  }
}

function byNewest(a: Post, b: Post): number {
  return b.createdAt.localeCompare(a.createdAt);
}
