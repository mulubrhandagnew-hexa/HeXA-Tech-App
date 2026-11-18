# Recording a real ከበሮ for Tigtog

Tigtog plays real ከበሮ hits when they're installed, and its synthesized
drum otherwise. Two short phone recordings are enough.

## What to record

| File | Stroke | How many |
|---|---|---|
| `dum` | Deep, open stroke in the middle of the big head ("DUM") | 10–15 hits |
| `ta` | Sharp stroke near the edge, or on the small head ("ta") | 10–15 hits |

- One stroke type per recording.
- About **one second of silence between hits**. Let each hit ring out.
- Play them a little differently (softer, harder), like in a real song.
- Quiet room, no music or talking. Phone about 50 cm from the drum.
- Any phone recorder is fine (m4a, mp3, wav…).
- Only record a ከበሮ you or the player are happy to have used in the app.

## Installing them (developer)

```bash
python3 -m venv .venv && .venv/bin/pip install librosa soundfile
.venv/bin/python tools/slice-hits.py dum.m4a --stroke dum --out public/samples/kebero
.venv/bin/python tools/slice-hits.py ta.m4a  --stroke ta  --out public/samples/kebero
```

The tool finds each hit, trims it, evens out the levels, skips accidental
taps, and writes `public/samples/kebero/manifest.json`. The studio and the
voice page load it automatically; each hit is picked at random (never the
same one twice in a row) with a slight variation, like a real hand.
