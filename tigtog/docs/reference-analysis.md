# Reference analysis: Tigrinya songs

To make the studio's ጓይላ sound like real Tigrinya music, nine reference
recordings were analysed with `tools/analyze_reference.py`. Only measurements
were kept. **No audio from these recordings is stored in the repo or used as
sound in the app.**

| Song | Tempo | Subdivision | Tuning vs A440 | Closest qenet (weak) |
|---|---|---|---|---|
| Gebrehiwet Gebremaryam – Guramayle | 77 | triplet | +2¢ | Tizita-major family |
| Merkeb – Akayda | 80 | triplet | +1¢ | Tizita-major family |
| Timnit Welday – Shane | 77 | triplet | 0¢ | Tizita-major family |
| Eyasu Berhe – Hengidu | 80 | triplet | +46¢ | Tizita-major family |
| Traditional wedding, Tigray | 88 | triplet | +46¢ | Tizita major (B) |
| Tekle Kiflemariam (Wedi Tukul) – Adey | 76 | continuous strum | −40¢ | Ambassel / Tizita minor |
| Simon Mehari – krar music | 118 | duple | +27¢ | **Tizita major on C#** (77% in-scale) |
| Gebretsadik Weldeyohans – Tsbekti eya | 94 | triplet | +31¢ | **Tizita major on F** (81% in-scale) |
| Solomon Yikunoamlak – Koleu Tigray | 76 | triplet, kebero on both beats | +4¢ | **Tizita major on C#** (83% in-scale; best of all 792 five-note sets) |

The cleaner recordings give a firm result: **Tizita major** (F G A C D;
C# D# F G# A#). With the earlier leans, 8 of 9 songs fit the Tizita-major
set best. In Koleu Tigray an A (between G# and A#) recurs at ~6% through the
whole song, which looks like an ornamental or passing note rather than
a different qenet. 6 of 9 songs are tuned 27–46¢ away from A440.

## Beat patterns (onset strength, two beats, each split in three)

| | low band (kebero, bass) | high band (claps, hand drum) |
|---|---|---|
| Gebrehiwet – Guramayle | .97 .56 .60 · 1.00 .51 .56 | 1.00 .50 .24 · 1.00 .53 .30 |
| Timnit Welday – Shane | .97 .82 .56 · 1.00 .82 .48 | 1.00 .50 .51 · .96 .49 .40 |
| Traditional wedding | .81 .06 .02 · 1.00 .02 .35 | 1.00 .03 .19 · .97 .06 .20 |
| **Tigtog ጓይላ** | 1.00 .20 .01 · .68 .12 .01 | .90 .57 .31 · 1.00 .76 .34 |
| **Tigtog ጓይላ መርዓ** | 1.00 .03 .03 · .70 .01 .44 | 1.00 .42 .34 · 1.00 .00 .33 |

(Tigtog's weaker second low beat comes from its bass line, which plays the
root on beat one. The kebero hits themselves are equal.)

## What changed in the studio

- **ጓይላ** slowed from 100 to **80** beats/min, with the measured triplet
  "bounce" (strong, medium, light) and claps on both beats.
- New **ጓይላ መርዓ** (wedding) rhythm at **88**: kebero on each beat, a pickup
  before the bar, and hand-claps on the beats, as in the wedding recording.
- New **key** (መበገሲ ድምጺ) and **fine-tune** (ምስትኽኻል ድምጺ, ±50¢) controls.
  Three of the six songs were tuned about a quarter-tone away from A440, as
  the krar is tuned to the singer.

## The krar sound (ኽራር)

Measured with `tools/analyze_timbre.py` on 95 isolated krar notes from the
Simon Mehari recording, and on Tigtog's own krar rendered offline:

| | Real krar | Tigtog, old synth | Tigtog, string model |
|---|---|---|---|
| Note range | 118–356 Hz | 440–988 Hz | 110–371 Hz |
| Harmonics 1–8, dB vs fundamental | 0, +3.2, −1.4, −5.3, −6.2, −6.7, −10.5, −9.2 | 0, +5.2, −7.8, −10.1, −11.7, −11.5, −15.4, −18.5 | 0, +4.4, −0.9, −8.3, −6.3, −3.2, −10.3, −9.8 (avg of 4 renders) |
| Partial decay (median) | −22 to −25 dB/s | −101 dB/s | −21.5 dB/s |
| Brightness while ringing | stays bright | dulls in 0.35 s | stays bright |

The +3 dB 2nd harmonic with a dip at the 4th is what a string plucked about
a quarter of its length gives. So the krar is now a **Karplus–Strong plucked
string** (`renderKrar` in `public/music.js`): one period of noise, softened at
6× f0 (the plectrum), combed at a pluck point of 0.25 ± 0.05 (varied per
note, like a player), fed through a lightly damped string loop. It plays an
octave lower than before to match the krar's range. The averaged spectrum is
within 1.3 dB of the recording (single renders 1.1–3.8 dB, since each pluck
is randomised).

## The bowed lead (ጭራ-ዋጣ)

Measured with `tools/analyze_ornaments.py` on the sustained, ornamented lead
in the intro of *Koleu Tigray* (0:15–0:58, 44 notes, before the vocal). From
the numbers alone it can't be told whether this is a wata or a keyboard
played in wata style; either way it is a Tigrinya melodic line.

| (25th / median / 75th percentile) | Intro lead | Tigtog, old | Tigtog, calibrated |
|---|---|---|---|
| Pitch range | 117–350 Hz | 490–1093 Hz | 120–362 Hz |
| Vibrato rate | 2.2 / 3.9 / 5.9 Hz | 5.7 Hz, every note | 2.8–3.1 / 3.6–4.2 / 4.9–5.0 Hz |
| Vibrato depth (measured, cents p-p) | 2 / 16 / 39 | 20 / 20 / 25 | 10–13 / 20 / 30–39 |
| Scoop into note | −15 / 0 / +11¢ | −20 / −13 / −10¢ | −4–0 / 0 / +5–10¢ |

Changes: played two octaves lower; vibrato ~4 Hz with rate and depth
randomised per note (many shallow, some deep) instead of a fixed 6 Hz;
the fixed −53¢ scoop replaced by a slight, varied flat start; softer bow
attack; nasal formant follows the pitch. Settings: `WATA` in
`public/music.js`.

## The ከበሮ (correction)

A listener reported that the studio's ጓይላ "sounded like Indian beats, not
Tigrinya". The timing checks above had passed, because they measure *when*
hits happen, not *what each hit sounds like*. Measuring individual drum hits
showed why:

| Low drum hit | Real kebero (wedding / Gebrehiwet) | Old synth | New synth |
|---|---|---|---|
| Pitch slide, first 145 ms (median, same resonance) | −126¢ / +44¢, varies both ways | **+267¢ downward on every hit** (150 → 52 Hz sweep) | varies both ways (±3% per hit) |
| Decay of an isolated hit | ≈ −90 to −190 dB/s | −207 dB/s | −124 dB/s |

A large, identical downward pitch slide on every stroke is characteristic of
tabla bass strokes. Together with a root–fifth bass drone (tanpura-like),
it gave the "Indian" sound. Fixes:

- ከበሮ rebuilt from fixed-pitch drum-head modes (≈92/168/262 Hz big head,
  330/518 Hz small head) plus hand-on-skin noise, varied slightly per hit.
- No bass in traditional ጓይላ (`bass: false`); the bass guitar remains only in
  the modern Guayla.

Listen: [old drums](listening/tigtog_guayla_bahlawi_before_drums.mp3) ·
[new drums](listening/tigtog_guayla_bahlawi_after_drums.mp3) ·
[old with krar](listening/tigtog_guayla_bahlawi_before_full.mp3) ·
[new with krar](listening/tigtog_guayla_bahlawi_after_full.mp3)
(16 s each, Tigtog's own synthesized output).

### Second round (listener: "a little bit OK, needs a lot of improvement")

The listener flagged the drum sound, the rhythm pattern and the claps. A
finer analysis of the traditional wedding recording (each beat split in 6)
showed the missing strokes and the missing tone:

| | Real ከበሮ (wedding) | Round 1 | Round 2 |
|---|---|---|---|
| Pattern (12 steps/bar) | `█ · · · · ▒ │ █ ▒ · · ▒ ·` | `█ · · · · · │ █ · · · ▒ ·` | `█ · · · · ▒ │ █ ▒ · · ▒ ·` |
| Energy 380–2000 Hz vs peak | −10 to −22 dB | 20–40 dB too weak (pure tones) | within ~5 dB |
| Deep body 30–90 Hz | −10 to −14 dB | 11 dB too weak | within ~4 dB |
| Ring at 150–200 ms | −28 dB | −68 dB | −30 dB |

Changes: the drum is now a hand-struck membrane (a short noise strike
exciting ten uneven skin resonances, a deep body resonance and a leather
slap) instead of a few pure tones; the "ta" pickup strokes before beat 2,
after beat 2 and before the bar were added; claps are a crowd of nine hands
landing up to ~15 ms apart. Remaining measured gaps: 130–180 Hz ~7 dB weak,
2–6 kHz ~8 dB bright, pickups a little soft in the low drum.

Listen: [round 2 drums](listening/tigtog_guayla_bahlawi_v2_drums.mp3) ·
[round 2 with krar](listening/tigtog_guayla_bahlawi_v2_full.mp3)

### Third round (listener: "it does not sound Tigray")

The melody generator walked randomly through the scale. Measured on a krar
recording (statistics only, no melody copied), a ኽራር line is dense and
repetitive: ~3 notes per beat, ~60% repeated notes, ~24% neighbour steps,
~11% octave/string jumps, a narrow range, notes at 0, ⅙, ⅓ and ⅔ of the
beat. The generator now builds a one-bar riff with those statistics and
repeats it, the ኽራር adds a light "ta-ka" repeat on the ⅙ position, and
every drum stroke and note gets small human timing/loudness variations.
Rendered clip measured like the real krar: positions 0/⅙/⅓/⅔ (none on ½,
⅚), 54% repeats, 2.4 notes per beat.

Listen: [riff 1](listening/tigtog_guayla_bahlawi_v4_riff1.mp3) ·
[riff 2](listening/tigtog_guayla_bahlawi_v4b_riff2.mp3)

### New rhythm: ጓይላ — classic (from the owner's chosen reference)

Measured on a classic Tigrinya recording the owner picked as "best krar,
kebero and hand claps" (measurements only): ~70 BPM, near A440 (+6¢),
Tizita major. Each beat: DUM, a light stroke right after it, strokes at
half-beat and just before the next beat; claps only on the beats. The lead
picks a running stream (~5 notes per beat on all six positions, 56%
repeated notes, ~1 octave range, few jumps).

Added as `guaylaClassic`, with a running pick, and soft strokes now sound
darker than hard ones (as on a real drum). Drum grid of the render vs the
recording, low ከበሮ per beat: .31/.25/.25 · .51/.34/.16 vs .43/.28/.38 ·
.46/.34/.26; mid drum TA strokes .53/.56 · .57/.55 vs .43/.57 · .52/.56;
claps ~0.06 off the beat vs ~0.1.

Listen: [classic, full](listening/tigtog_guayla_classic_full.mp3) ·
[classic, drums](listening/tigtog_guayla_classic_drums.mp3)

Measurements can rule out wrong sounds but cannot confirm that something
sounds Tigrinya; that needs native listeners. Real ከበሮ and krar recordings
from Tigrinya musicians would be better than any synthesis.

## Limits

- Scale detection on full mixes is weak. Five of six lean to the Tizita-major
  pitch set, but this is a hint, not a transcription.
- Nine songs is a small sample. Running the tool on more ጓይላ (and on
  Amharic music for እስክስታ and ችክችካ) would make the patterns more reliable.
