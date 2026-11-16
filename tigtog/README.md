# Tigtog

Make and share **music and videos in Tigrinya (ትግርኛ) and Amharic (አማርኛ)**.

- **Studio**: compose a loop in an Ethiopian/Eritrean qenet (ቅኝት: Tizita,
  Bati, Ambassel, Anchihoye), over Guayla, Eskista, Chikchika or slow 4/4
  rhythms, with krar, masinko or washint-style melody and kebero drums. Write
  lyrics in Fidel, then record a 9:16 music video (animated or camera
  background, optional vocals), with karaoke-style lyrics, and post it.
- **Fidel typing** everywhere: type Latin, get Ge'ez (`selam` → ሰላም,
  `Ab` → ኣብ, `` `amet `` → ዓመት, `::` → ።). No special keyboard needed.
- **Interface in ትግርኛ, አማርኛ and English.** Posts are tagged by language, and
  the feed can be filtered to ትግርኛ or አማርኛ.
- A full-screen vertical feed with autoplay, video uploads, likes, comments,
  follows, hashtags (including Ge'ez hashtags such as `#ጓይላ`), search and profiles.

Tigtog is one TypeScript/Express service that serves both the JSON API and a
web client with no build step (`public/`). Like HeXA Books, it has **no native
dependencies**: records live in a single JSON file and uploaded videos are
stored on disk.

## Quick start

```bash
cd tigtog
npm install
npm test          # 31 tests: service, HTTP API, Fidel keymap
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

## Fidel keymap

| Type | Get | | Type | Get |
|---|---|---|---|---|
| `le lu li la lE l lo` | ለ ሉ ሊ ላ ሌ ል ሎ | | `lW` | ሏ |
| `sh` / `x`, `ch` / `c` | ሽ, ች | | `ts` / `S` | ጽ |
| `ny` / `N`, `zh` / `Z` | ኝ, ዥ | | `kh` / `K`, `qh` / `Q` | ኽ, ቕ (Tigrinya) |
| `H`, `T`, `C`, `P` | ሕ, ጥ, ጭ, ጵ | | `` ` `` | ዕ |
| `a A u i E e o` | አ ኣ ኡ ኢ ኤ እ ኦ | | `'` | separator (`s'a` → ስአ) |
| `::` `:` `,` `;` | ። ፡ ፣ ፤ | | | |

On phones whose keyboards use composition (Android), use the
**Latin → ፊደል** button to convert the text after typing.

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
public/
  app.js                 feed, profiles, upload, comments, routing
  studio.js              music-video studio: controls, canvas renderer, recorder
  music.js               Web Audio engine: qenet scales, rhythms, synth voices
  fidel.js               Latin → Ge'ez phonetic typing (pure, unit-tested)
  i18n.js                ትግርኛ / አማርኛ / English strings
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
| POST | `/api/posts` | `{caption, mediaId, language?: "ti"\|"am"\|"other", kind?: "video"\|"music"}` |
| GET / DELETE | `/api/posts/:id` | delete: author only (also deletes the file) |
| POST | `/api/posts/:id/view` | increments views |
| POST / DELETE | `/api/posts/:id/like` | like / unlike |
| GET / POST | `/api/posts/:id/comments` | POST `{text}` |
| DELETE | `/api/comments/:id` | comment author or post author |
| GET | `/api/feed/for-you`, `/api/feed/following` | `?limit=&cursor=&lang=ti\|am` → `{posts, nextCursor}` |
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

- **Translations** in `public/i18n.js` were written carefully but need review by
  native Tigrinya and Amharic speakers.
- Instruments are synthesized approximations of krar, masinko, washint and
  kebero. Recorded samples from real players would sound far more authentic.

This is a working MVP. For real traffic you would still want:
- a database (Postgres/Convex/Supabase) instead of the JSON snapshot, which is
  rewritten on every change and fits only a single instance
- object storage + CDN for videos, and server-side transcoding/thumbnails (ffmpeg)
- rate limiting, token expiry, password reset, reporting/blocking and moderation
