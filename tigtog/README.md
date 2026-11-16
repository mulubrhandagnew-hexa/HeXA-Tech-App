# Tigtog

A short-video social app: a full-screen vertical feed with autoplay, video
uploads, likes, comments, follows, hashtags, search and profiles.

Tigtog is one TypeScript/Express service that serves both the JSON API and a
web client with no build step (`public/`). Like HeXA Books, it has **no native
dependencies**: records live in a single JSON file and uploaded videos are
stored on disk.

## Quick start

```bash
cd tigtog
npm install
npm test          # 23 tests: service logic + HTTP API
npm run dev       # http://localhost:3001 with live reload
# or
npm run build && npm start
```

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | HTTP port |
| `TIGTOG_DB_PATH` | `./data/tigtog.json` | JSON snapshot of all records |
| `TIGTOG_MEDIA_DIR` | `./data/media` | Uploaded video files |
| `TIGTOG_MAX_UPLOAD_MB` | `50` | Max upload size |

## Features

- **For you** feed: every post, ranked by engagement and decayed by age:
  `(1 + 3·likes + 5·comments + 0.1·views) / (ageHours + 2)^1.5`
- **Following** feed: newest posts from accounts you follow
- Upload MP4 / WebM / MOV; captions with clickable `#hashtags`
- Like (tap the heart or double-tap the video), comment, share link, follow
- Profiles with video grid, editable display name and bio
- Search people and captions; hashtag pages
- Videos autoplay when on screen and pause when scrolled away; views are counted once per session

## Architecture

```
src/
  domain/types.ts        records, public views, TigtogError
  domain/auth.ts         scrypt passwords, tokens, hashtag parsing
  service/tigtog.ts      accounts, posts, likes, comments, follows, feeds (no I/O)
  persistence/           InMemoryRepository, JsonFileRepository (atomic writes)
  api/server.ts          Express routes, uploads, static client, error mapping
  index.ts               bootstrap
public/                  web client (index.html, app.js, styles.css)
```

## API

All endpoints return JSON. Write endpoints need `Authorization: Bearer <token>`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/signup` | `{username, password, displayName?}` → `{user, token}` |
| POST | `/api/auth/login` | `{username, password}` → `{user, token}` |
| POST | `/api/auth/logout` | revokes the token |
| GET / PATCH | `/api/me` | PATCH `{displayName?, bio?}` |
| POST | `/api/media` | raw video body, `Content-Type: video/mp4 \| video/webm \| video/quicktime` → `{media: {id, url}}` |
| POST | `/api/posts` | `{caption, mediaId}` |
| GET / DELETE | `/api/posts/:id` | delete: author only (also deletes the file) |
| POST | `/api/posts/:id/view` | increments views |
| POST / DELETE | `/api/posts/:id/like` | like / unlike |
| GET / POST | `/api/posts/:id/comments` | POST `{text}` |
| DELETE | `/api/comments/:id` | comment author or post author |
| GET | `/api/feed/for-you`, `/api/feed/following` | `?limit=&cursor=` → `{posts, nextCursor}` |
| GET | `/api/users/:username`, `/api/users/:username/posts` | profile, videos |
| POST / DELETE | `/api/users/:username/follow` | follow / unfollow |
| GET | `/api/tags/:tag`, `/api/search?q=` | hashtag page, search |

## Security notes

- Passwords are hashed with scrypt. Session tokens are random 256-bit values,
  and only their SHA-256 is stored.
- Uploads must match an allowed `Content-Type` and the file's own signature
  (MP4/MOV `ftyp` box or WebM EBML header). Media is served with
  `X-Content-Type-Options: nosniff`.
- The client renders all user text with `textContent`, never `innerHTML`.

## Before production

This is a working MVP. For real traffic you would still want:
- a database (Postgres/Convex/Supabase) instead of the JSON snapshot, which is
  rewritten on every change and fits only a single instance
- object storage + CDN for videos, and server-side transcoding/thumbnails (ffmpeg)
- rate limiting, token expiry, password reset, reporting/blocking and moderation
