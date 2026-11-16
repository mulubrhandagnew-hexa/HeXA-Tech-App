# Reference analysis: Tigrinya songs

To make the studio's ጓይላ sound like real Tigrinya music, six reference
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

## Limits

- Scale detection on full mixes is weak. Five of six lean to the Tizita-major
  pitch set, but this is a hint, not a transcription.
- Six songs is a small sample. Running the tool on more ጓይላ (and on
  Amharic music for እስክስታ and ችክችካ) would make the patterns more reliable.
