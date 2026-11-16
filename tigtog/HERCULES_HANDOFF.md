# Tigtog → Hercules handoff

For the Hercules agent building **Tigtog** (hexa-tech / tigtog). This package
brings over work done in GitHub (`mulubrhandagnew-hexa/HeXA-Tech-App`, branch
`claude/tigtog-app-0mc7ai`, folder `tigtog/`). Hercules is the main app from
now on.

## What Tigtog is

An app to **make and share music and videos in Tigrinya (ትግርኛ) and Amharic
(አማርኛ)**, with the focus on **traditional Tigrinya songs and Tigray beats**,
not borrowed or "modernised" Western/reggae beats.

## 1. Copy these files unchanged (`core/`)

Plain JavaScript (ES modules), no dependencies, work in any browser app
(React, Vue, plain). Put them in e.g. `src/lib/tigtog/`.

| File | What it does | Main exports |
|---|---|---|
| `music.js` | Web Audio music engine: ቕኒት scales, ጓይላ rhythms, krar/ዋጣ/ሸምበቆ/እምብልታ voices, ከበሮ, claps. All tuned on real recordings. | `MusicEngine`, `SCALES`, `RHYTHMS`, `RHYTHM_ORDER`, `INSTRUMENTS`, `KEYS`, `generateMelody`, `rowToMidi`, `renderKrar` |
| `fidel.js` | Type Latin, get Ge'ez: `selam`→ሰላም, `Ab`→ኣብ, `gWayla`→ጓይላ, `::`→። | `attachFidelInput(input, isOn)`, `transliterate(text)` |
| `g2p.js` | Fidel → phonemes for ti/am (for the voice dataset). | `g2p`, `phonemeString`, `phonemeInventory` |
| `i18n.js` | All UI text in ትግርኛ / አማርኛ / English. | `t(key, vars)`, `setLang`, `getLang`, `UI_LANGS` |
| `voice-prompts.js` | Recording prompts (ሀ ሁ ሂ rows + lines) and their guide melodies. Imports `music.js`. | `promptsFor(lang)`, `guideNotes(prompt, {root, bpm})` |

### Using the engine

```js
import { MusicEngine, RHYTHM_ORDER } from "./music.js";
const engine = new MusicEngine();          // create once
// Must be started from a click (browser audio rule):
await engine.start();                      // loops the current pattern
engine.stop();
engine.rhythm = "guaylaWedding";           // traditional (default)
engine.bpm = 88; engine.scale = "tizitaMajor"; engine.instrument = "krar";
engine.key = "A"; engine.cents = 0;        // key + fine tune (±50)
engine.notes = new Set(["5:0", "7:1"]);    // melody grid "row:column"
engine.recordDest.stream                   // MediaStream of the mix (for recording video)
engine.analyser                            // for visualisers
engine.onStep = (col) => {};               // playhead
```

`fidel.js` example: `attachFidelInput(textarea, () => fidelOn)` on every text
field where people write Tigrinya/Amharic (captions, comments, lyrics,
search). Also offer a "Latin → ፊደል" button using `transliterate()`
(Android keyboards don't always fire the per-key events).

## 2. Rebuild these features in Hercules (`reference/` shows how)

`reference/studio.js`, `reference/voice.js` and `reference/app.js` are working
vanilla-DOM versions. Rebuild them with Hercules's own UI; keep the behaviour.

1. **Interface in ትግርኛ / አማርኛ / English** with a language switcher; Noto
   Sans Ethiopic font; `<html lang>` set.
2. **Feed:** full-screen vertical videos, autoplay on screen, like, comment,
   share, follow; filter chips ሁሉም / ትግርኛ / አማርኛ.
3. **Posts** carry `language` (`ti`/`am`/`other`) and `kind` (`video`/`music`);
   hashtags in Ge'ez work (`#ጓይላ`).
4. **Studio** (`reference/studio.js`): pick ቕኒት, ስዕስዒት (rhythm),
   instrument, key, fine-tune, tempo; melody grid; lyrics with Fidel typing;
   animated or camera background; record a 9:16 music video (canvas +
   `engine.recordDest`, `MediaRecorder`) with karaoke lyrics; post it with
   Ge'ez hashtags.
5. **"Teach Tigtog to sing"** voice dataset (`reference/voice.js`): see §4.

## 3. Rules learned the hard way — do not undo

- **ከበሮ must not slide in pitch.** An earlier version swept 150→52 Hz on every
  hit; a native listener said it sounded like **Indian tabla**. The current
  `_drumHit` uses fixed-pitch drum modes + hand-on-skin noise.
- **No bass/drone in traditional ጓይላ** (`RHYTHMS.guaylaWedding.bass = false`).
  A root–fifth drone sounded like a tanpura. Bass guitar only in "modern" Guayla.
- **Traditional first:** default rhythm `guaylaWedding` (88 BPM, ከበሮ on each
  beat + pickup + claps), shown first; the modern one is labelled "ዘመናዊ".
- **Tuning:** most reference songs are 27–46 cents off A440 — keep the key and
  fine-tune controls.
- **Scale:** ትዝታ (Tizita) major fits 8 of 9 reference songs; it's the default.
- **Krar** plays in its real range (≈118–356 Hz), plucked-string model.
- **ዋጣ** (`masinko` internally): slow ~4 Hz vibrato varied per note, no fixed scoop.
- Measurements can catch wrong sounds but **can't prove it sounds Tigrinya —
  native listeners must judge**. Real ከበሮ/ኽራር recordings from Tigrinya
  musicians would beat any synthesis.
- Instrument names in ትግርኛ: ኽራር, ጭራ-ዋጣ (ዋጣ), ሸምበቆ, እምብልታ; terms ቕኒት (scale),
  ስዕስዒት (dance/rhythm). Interface translations need native review.

## 4. Voice dataset — privacy and consent are requirements

Goal: train Tigtog's own Tigrinya singing voice later (DiffSinger, Apache-2.0).

- **Consent first**, versioned (`VOICE_CONSENT_VERSION = 1`): three explicit
  checkboxes — 18+, my own voice, agree to use for training.
- **Recordings are private**: never in public storage, never served by URL,
  never shown to other users. Use a private bucket/table.
- Singers can **delete any recording**, or **withdraw**, which deletes all
  their audio and labels.
- **Modes:** (a) *ባህላዊ ደርፊ* (default): traditional ከበሮ+claps loop at 88 BPM
  (adjustable); singer sings a traditional song from memory, types its words
  in Fidel, confirms it is **traditional or their own** (not another artist's
  song). Save `rhythm`, `bpm`, `beatStart` (seconds to first downbeat).
  (b) *guided*: `promptsFor("ti")` with `guideNotes()`, count-in, guide melody
  + traditional ከበሮ; save exact notes.
- Record raw mic: `echoCancellation/noiseSuppression/autoGainControl: false`;
  tell singers to use headphones.
- Tigrinya is the default language here.

### Data model

```
VoiceConsent { userId, version, givenAt }
VoiceAudio   { id, ownerId, fileRef (private), contentType, size, createdAt }
VoiceSample  { id, userId, audioId, promptId, kind: "sweep"|"line"|"song",
               language: "ti"|"am", text, phonemes, notes: [{syllable, midi, start, dur}],
               bpm, cents, durationSec, rhythm?, beatStart?, songSource?: "traditional"|"own",
               consentVersion, createdAt }
Post         { id, authorId, caption, language, kind, hashtags[], mediaRef, views, createdAt }
```

Server checks (from `reference/server-voice.ts`): reject uploads whose bytes
aren't real audio/video (check file signature, not just content type);
guided samples need ≥1 note and ≤120 s; songs need `rhythm`, `beatStart`,
`songSource`, ≤10 min.

## 5. Check it works

- `transliterate("selam")` = `ሰላም`, `("gWayla")` = `ጓይላ`, `("Qnit")` = `ቕኒት`.
- `phonemeString("ትግርኛ","ti")` = `t ix g r ix ny a`.
- Studio: default rhythm is ጓይላ ባህላዊ, no bass audible, ከበሮ has no pitch "wow".
- Voice: can't record before consent; recordings not reachable by any URL;
  withdraw deletes everything.
- `reference/tests/` has the original unit tests (expected values).

Listening clips of the drum fix: `listening/` (before/after).
