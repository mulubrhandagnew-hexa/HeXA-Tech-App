# Reference analysis: Tigrinya songs

To make the studio's ጓይላ sound like real Tigrinya music, eight reference
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

The two cleaner recordings give a firm result: **Tizita major** (F G A C D;
C# D# F G# A#). With the earlier leans, 7 of 8 songs fit the Tizita-major
set best. 6 of 8 are tuned 27–46¢ away from A440.

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

## Limits

- Scale detection on full mixes is weak. Five of six lean to the Tizita-major
  pitch set, but this is a hint, not a transcription.
- Eight songs is a small sample. Running the tool on more ጓይላ (and on
  Amharic music for እስክስታ and ችክችካ) would make the patterns more reliable.
