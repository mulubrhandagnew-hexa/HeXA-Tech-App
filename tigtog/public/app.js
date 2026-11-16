// Tigtog web client — no build step, no dependencies.
// All user content is inserted with textContent / DOM APIs (never innerHTML).

const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");

// ------------------------------------------------------------------ state
const store = {
  get token() { try { return localStorage.getItem("tigtog.token"); } catch { return null; } },
  set token(v) { try { v ? localStorage.setItem("tigtog.token", v) : localStorage.removeItem("tigtog.token"); } catch {} },
  me: null,
};

async function api(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (store.token) h.Authorization = `Bearer ${store.token}`;
  let payload = body;
  if (body !== undefined && !raw) {
    h["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers: h, body: payload });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && store.token && path !== "/api/auth/login") {
      store.token = null; store.me = null;
    }
    const err = new Error(data.message || data.issues?.[0]?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------- helpers
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
}

const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : String(n);

function timeAgo(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

function captionNodes(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/#([\p{L}\p{N}_]{1,50})/gu)) {
    out.push(text.slice(last, m.index));
    out.push(el("a", { href: `#/tag/${encodeURIComponent(m[1].toLowerCase())}` }, m[0]));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

const initial = (u) => (u.displayName || u.username || "?").trim().charAt(0).toUpperCase();

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// Close buttons + backdrop click for all dialogs.
for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  });
}

// ------------------------------------------------------------------- auth
let authMode = "login";
let afterAuth = null;

function requireLogin(then) {
  if (store.me) return then?.();
  afterAuth = then;
  setAuthMode("login");
  $("#auth-error").textContent = "";
  $("#auth-dialog").showModal();
}

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === "signup";
  $("#auth-title").textContent = signup ? "Join Tigtog" : "Log in to Tigtog";
  $("#auth-submit").textContent = signup ? "Create account" : "Log in";
  $("#display-row").hidden = !signup;
  $("#auth-switch-text").textContent = signup ? "Have an account?" : "New here?";
  $("#auth-switch").textContent = signup ? "Log in" : "Create an account";
  $("#auth-form").password.autocomplete = signup ? "new-password" : "current-password";
}
$("#auth-switch").addEventListener("click", () => setAuthMode(authMode === "login" ? "signup" : "login"));

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const body = { username: f.username.value, password: f.password.value };
  if (authMode === "signup" && f.displayName.value) body.displayName = f.displayName.value;
  $("#auth-submit").disabled = true;
  try {
    const r = await api(`/api/auth/${authMode}`, { method: "POST", body });
    store.token = r.token;
    store.me = r.user;
    $("#auth-dialog").close();
    f.reset();
    toast(`Welcome, ${r.user.displayName}`);
    const next = afterAuth; afterAuth = null;
    next ? next() : route();
  } catch (err) {
    $("#auth-error").textContent = err.message;
  } finally {
    $("#auth-submit").disabled = false;
  }
});

async function loadMe() {
  if (!store.token) return;
  try { store.me = (await api("/api/me")).user; } catch { store.me = null; }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  store.token = null; store.me = null;
  location.hash = "#/";
  toast("Logged out");
}

// ----------------------------------------------------------------- upload
const uploadForm = $("#upload-form");
const preview = $("#upload-preview");
$("#upload-btn").addEventListener("click", () => requireLogin(openUpload));

function openUpload() {
  uploadForm.reset();
  preview.hidden = true;
  preview.removeAttribute("src");
  $("#drop-hint").hidden = false;
  $("#upload-error").textContent = "";
  $("#upload-dialog").showModal();
}

uploadForm.file.addEventListener("change", () => {
  const file = uploadForm.file.files[0];
  if (!file) return;
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  $("#drop-hint").hidden = true;
  preview.play().catch(() => {});
});

uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = uploadForm.file.files[0];
  if (!file) return;
  const btn = $("#upload-submit");
  btn.disabled = true; btn.textContent = "Uploading…";
  $("#upload-error").textContent = "";
  try {
    const type = file.type || (file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
    const { media } = await api("/api/media", { method: "POST", body: file, raw: true, headers: { "Content-Type": type } });
    const { post } = await api("/api/posts", { method: "POST", body: { caption: uploadForm.caption.value, mediaId: media.id } });
    $("#upload-dialog").close();
    toast("Posted!");
    location.hash = `#/u/${post.author.username}`;
    route();
  } catch (err) {
    $("#upload-error").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Post";
  }
});

// --------------------------------------------------------------- comments
let commentsPost = null;
async function openComments(post, countEl) {
  commentsPost = { post, countEl };
  $("#comments-list").replaceChildren(el("li", { class: "muted" }, "Loading…"));
  $("#comments-dialog").showModal();
  await renderComments();
}

async function renderComments() {
  const { post, countEl } = commentsPost;
  const { comments } = await api(`/api/posts/${post.id}/comments`);
  $("#comments-count").textContent = `${comments.length} comment${comments.length === 1 ? "" : "s"}`;
  countEl.textContent = fmt(comments.length);
  const list = $("#comments-list");
  if (!comments.length) return list.replaceChildren(el("li", { class: "muted" }, "No comments yet. Start the conversation."));
  list.replaceChildren(...comments.map((c) => {
    const canDelete = store.me && (store.me.id === c.author.id || store.me.id === post.author.id);
    return el("li", {},
      el("a", { class: "avatar sm", href: `#/u/${c.author.username}` }, initial(c.author)),
      el("div", {},
        el("a", { class: "author", href: `#/u/${c.author.username}` }, c.author.displayName, el("small", {}, `@${c.author.username} · ${timeAgo(c.createdAt)}`)),
        el("p", {}, c.text)),
      canDelete ? el("button", { class: "del", onclick: async () => {
        await api(`/api/comments/${c.id}`, { method: "DELETE" });
        renderComments();
      } }, "Delete") : null);
  }));
  list.scrollTop = list.scrollHeight;
}

$("#comment-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  requireLogin(async () => {
    try {
      await api(`/api/posts/${commentsPost.post.id}/comments`, { method: "POST", body: { text: f.text.value } });
      f.reset();
      await renderComments();
    } catch (err) { toast(err.message); }
  });
});

// ------------------------------------------------------------------- feed
const viewed = new Set();
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const video = e.target.querySelector("video");
    if (e.isIntersecting && e.intersectionRatio > 0.6) {
      video.play().catch(() => {});
      e.target.classList.remove("paused");
      const id = e.target.dataset.id;
      if (!viewed.has(id)) { viewed.add(id); api(`/api/posts/${id}/view`, { method: "POST" }).catch(() => {}); }
    } else {
      video.pause();
    }
  }
}, { threshold: [0, 0.6] });

let muted = true;

function slide(post) {
  const video = el("video", { src: post.mediaUrl, loop: true, playsinline: true, preload: "metadata", muted: true });
  video.muted = muted;
  const likeCount = el("span", {}, fmt(post.likes));
  const commentCount = el("span", {}, fmt(post.comments));
  const isMine = store.me?.id === post.author.id;

  const likeBtn = el("button", { class: `action${post.likedByMe ? " liked" : ""}`, "aria-label": "Like", "aria-pressed": String(post.likedByMe) },
    el("span", { class: "icon" }, "♥"), likeCount);
  likeBtn.addEventListener("click", () => requireLogin(async () => {
    const on = !likeBtn.classList.contains("liked");
    likeBtn.classList.toggle("liked", on);
    likeBtn.setAttribute("aria-pressed", String(on));
    try {
      const r = await api(`/api/posts/${post.id}/like`, { method: on ? "POST" : "DELETE" });
      likeCount.textContent = fmt(r.likes);
    } catch (err) { likeBtn.classList.toggle("liked", !on); toast(err.message); }
  }));

  const followBtn = isMine ? null : el("button", { class: `follow-chip${post.author.followedByMe ? " on" : ""}` },
    post.author.followedByMe ? "Following" : "Follow");
  followBtn?.addEventListener("click", () => requireLogin(async () => {
    const on = !followBtn.classList.contains("on");
    try {
      await api(`/api/users/${post.author.username}/follow`, { method: on ? "POST" : "DELETE" });
      followBtn.classList.toggle("on", on);
      followBtn.textContent = on ? "Following" : "Follow";
    } catch (err) { toast(err.message); }
  }));

  const node = el("section", { class: "slide", dataset: { id: post.id } },
    video,
    el("div", { class: "tap-hint", "aria-hidden": "true" }, "▶"),
    el("div", { class: "overlay" },
      el("div", {},
        el("a", { class: "author", href: `#/u/${post.author.username}` }, post.author.displayName, el("small", {}, `@${post.author.username} · ${timeAgo(post.createdAt)}`)),
        followBtn),
      post.caption ? el("p", { class: "caption" }, captionNodes(post.caption)) : null),
    el("div", { class: "actions" },
      likeBtn,
      el("button", { class: "action", "aria-label": "Comments", onclick: () => openComments(post, commentCount) },
        el("span", { class: "icon" }, "💬"), commentCount),
      el("button", { class: "action", "aria-label": "Share", onclick: async () => {
        const url = `${location.origin}/#/p/${post.id}`;
        try {
          if (navigator.share) await navigator.share({ title: "Tigtog", url });
          else { await navigator.clipboard.writeText(url); toast("Link copied"); }
        } catch {}
      } }, el("span", { class: "icon" }, "↗"), el("span", {}, "Share")),
      el("button", { class: "action", "aria-label": "Toggle sound", onclick: (e) => {
        muted = !muted;
        document.querySelectorAll(".slide video").forEach((v) => (v.muted = muted));
        document.querySelectorAll(".sound-icon").forEach((s) => (s.textContent = muted ? "🔇" : "🔊"));
        e.stopPropagation();
      } }, el("span", { class: "icon sound-icon" }, muted ? "🔇" : "🔊"), el("span", {}, "Sound"))));

  video.addEventListener("click", () => {
    if (video.paused) { video.play().catch(() => {}); node.classList.remove("paused"); }
    else { video.pause(); node.classList.add("paused"); }
  });
  let lastTap = 0;
  video.addEventListener("dblclick", () => { if (!likeBtn.classList.contains("liked")) likeBtn.click(); });
  video.addEventListener("touchend", () => {
    const now = Date.now();
    if (now - lastTap < 300 && !likeBtn.classList.contains("liked")) likeBtn.click();
    lastTap = now;
  });
  io.observe(node);
  return node;
}

async function renderFeed(endpoint, emptyState) {
  const feed = el("div", { class: "feed" });
  view.replaceChildren(feed);
  let cursor = null;
  let loading = false;
  let done = false;

  async function more() {
    if (loading || done) return;
    loading = true;
    try {
      const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const page = await api(`${endpoint}${q}`);
      if (!page.posts.length && !feed.children.length) feed.replaceWith(emptyState());
      for (const p of page.posts) feed.append(slide(p));
      cursor = page.nextCursor;
      done = !cursor;
    } catch (err) {
      if (!feed.children.length) feed.replaceWith(empty("Couldn't load the feed", err.message));
    } finally { loading = false; }
  }
  feed.addEventListener("scroll", () => {
    if (feed.scrollTop + feed.clientHeight * 2 >= feed.scrollHeight) more();
  }, { passive: true });
  await more();
}

function empty(title, text, action) {
  return el("div", { class: "empty" }, el("h2", {}, title), el("p", {}, text), action ?? null);
}

// ----------------------------------------------------------------- pages
function grid(posts) {
  return el("div", { class: "grid" }, posts.map((p) =>
    el("a", { class: "tile", href: `#/p/${p.id}` },
      el("video", { src: p.mediaUrl, muted: true, preload: "metadata", playsinline: true }),
      el("span", {}, `▶ ${fmt(p.views)}`))));
}

async function renderProfile(username) {
  const page = el("div", { class: "page" }, el("p", { class: "muted" }, "Loading…"));
  view.replaceChildren(page);
  let data, posts;
  try {
    [data, posts] = await Promise.all([api(`/api/users/${encodeURIComponent(username)}`), api(`/api/users/${encodeURIComponent(username)}/posts?limit=50`)]);
  } catch (err) {
    return page.replaceChildren(empty("User not found", err.message));
  }
  const u = data.user;
  const isMe = store.me?.id === u.id;
  const followers = el("b", {}, fmt(u.followers));
  let following = data.followedByMe;

  const actions = isMe
    ? el("div", { style: "display:flex;gap:8px" },
        el("button", { class: "secondary", onclick: () => editProfile(u) }, "Edit profile"),
        el("button", { class: "secondary", onclick: logout }, "Log out"))
    : el("button", { class: following ? "secondary" : "primary", onclick: (e) => requireLogin(async () => {
        try {
          const r = await api(`/api/users/${u.username}/follow`, { method: following ? "DELETE" : "POST" });
          following = r.followedByMe;
          followers.textContent = fmt(r.user.followers);
          e.target.className = following ? "secondary" : "primary";
          e.target.textContent = following ? "Following" : "Follow";
        } catch (err) { toast(err.message); }
      }) }, following ? "Following" : "Follow");

  page.replaceChildren(
    el("div", { class: "profile-head" },
      el("div", { class: "avatar" }, initial(u)),
      el("div", {},
        el("h2", { style: "margin:0" }, u.displayName),
        el("p", { class: "muted", style: "margin:2px 0 8px" }, `@${u.username}`),
        el("div", { class: "stats" },
          el("span", {}, el("b", {}, fmt(u.following)), " following"),
          el("span", {}, followers, " followers"),
          el("span", {}, el("b", {}, fmt(u.posts)), " videos")),
        u.bio ? el("p", {}, u.bio) : null),
      el("div", { style: "margin-left:auto" }, actions)),
    posts.posts.length ? grid(posts.posts)
      : empty(isMe ? "Post your first video" : "No videos yet", isMe ? "Tap ＋ to upload." : "Check back later.",
        isMe ? el("button", { class: "primary", onclick: openUpload }, "Upload") : null));
}

function editProfile(u) {
  const displayName = prompt("Display name", u.displayName);
  if (displayName === null) return;
  const bio = prompt("Bio (160 characters)", u.bio);
  if (bio === null) return;
  api("/api/me", { method: "PATCH", body: { displayName, bio: bio.slice(0, 160) } })
    .then((r) => { store.me = r.user; route(); toast("Profile updated"); })
    .catch((err) => toast(err.message));
}

async function renderPost(id) {
  try {
    const { post } = await api(`/api/posts/${encodeURIComponent(id)}`);
    const feed = el("div", { class: "feed" }, slide(post));
    view.replaceChildren(feed);
  } catch (err) {
    view.replaceChildren(empty("Video not found", err.message));
  }
}

async function renderTag(tag) {
  const page = el("div", { class: "page" });
  view.replaceChildren(page);
  const r = await api(`/api/tags/${encodeURIComponent(tag)}?limit=50`).catch(() => ({ posts: [] }));
  page.append(el("h2", {}, `#${tag}`), el("p", { class: "muted" }, `${r.posts.length} videos`),
    r.posts.length ? grid(r.posts) : empty("Nothing here yet", "Be the first to use this hashtag."));
}

async function renderSearch(q) {
  const input = el("input", { type: "search", value: q, placeholder: "Search people, captions", style: "width:100%;padding:12px 14px;border-radius:999px;border:0;background:var(--surface-2)", "aria-label": "Search" });
  const form = el("form", { onsubmit: (e) => { e.preventDefault(); location.hash = `#/search?q=${encodeURIComponent(input.value)}`; } }, input);
  const page = el("div", { class: "page" }, form);
  view.replaceChildren(page);
  if (!q) return input.focus();
  const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
  page.append(
    el("h3", {}, "People"),
    r.users.length ? el("div", {}, r.users.map((u) => el("a", { class: "user-row", href: `#/u/${u.username}` },
      el("div", { class: "avatar sm" }, initial(u)),
      el("div", {}, el("b", {}, u.displayName), el("div", { class: "muted" }, `@${u.username} · ${fmt(u.followers)} followers`)))))
      : el("p", { class: "muted" }, "No people found."),
    el("h3", {}, "Videos"),
    r.posts.length ? grid(r.posts) : el("p", { class: "muted" }, "No videos found."));
}

// ----------------------------------------------------------------- router
function setTab(tab) {
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
}

async function route() {
  document.querySelectorAll(".slide").forEach((s) => io.unobserve(s));
  const hash = location.hash.slice(1) || "/";
  const [path, query = ""] = hash.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  setTab(parts.length === 0 ? "for-you" : parts[0] === "following" ? "following" : "");

  switch (parts[0]) {
    case undefined:
      return renderFeed("/api/feed/for-you", () => empty("No videos yet", "Be the first to post on Tigtog.",
        el("button", { class: "primary", onclick: () => requireLogin(openUpload) }, "Upload a video")));
    case "following":
      if (!store.me) {
        return view.replaceChildren(empty("See videos from people you follow", "Log in to get your Following feed.",
          el("button", { class: "primary", onclick: () => requireLogin(route) }, "Log in")));
      }
      return renderFeed("/api/feed/following", () => empty("Your Following feed is empty", "Follow creators from the For you feed and their videos will show up here."));
    case "me":
      if (!store.me) return requireLogin(() => { location.hash = `#/u/${store.me.username}`; });
      location.hash = `#/u/${store.me.username}`;
      return;
    case "u": return renderProfile(parts[1] ?? "");
    case "p": return renderPost(parts[1] ?? "");
    case "tag": return renderTag(parts[1] ?? "");
    case "search": return renderSearch(new URLSearchParams(query).get("q") ?? "");
    default: return view.replaceChildren(empty("Page not found", "That link doesn't go anywhere."));
  }
}

$("#search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  location.hash = `#/search?q=${encodeURIComponent($("#search-input").value)}`;
});

window.addEventListener("hashchange", route);
await loadMe();
route();
