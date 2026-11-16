# Tigtog's own Tigrinya & Amharic singing voice

Goal: a singing-voice model that sings ትግርኛ and አማርኛ lyrics on a melody,
trained only on recordings that singers explicitly agreed to give Tigtog.

## Priority: traditional Tigrinya songs and Tigray beats

Training focuses on **traditional Tigrinya singing over traditional Tigray
rhythms**. Much modern pop, both Amharic and "modernised" Tigrinya (Western
or reggae beats), is built on borrowed beats, so it is not what Tigtog should
learn from. In the reference analysis, the traditional Tigray wedding
recording had a clearly different beat (sparse ከበሮ on each beat, a pickup,
hand-claps) from modernised songs (busy bass-guitar low end).

What follows from this in the app:

- The voice page opens in **ትግርኛ** and in **traditional song** mode.
- **Traditional songs from memory** (kind `song`): the singer hears the
  traditional ጓይላ ከበሮ and claps (default 88 BPM, adjustable), sings a
  traditional song they know, types its words in Fidel, and confirms it is a
  traditional folk song or their own (not another artist's song). The melody
  comes from the singer — that is what makes it authentic — so notes are
  extracted later by pitch tracking.
- **Guided prompts** now play the traditional ከበሮ under the guide, and lines
  are sung on the measured Tigray bounce (long–short in each beat), not on
  straight Western eighth notes.
- Amharic recording stays available but is secondary.
- The studio's default beat is **ጓይላ ባህላዊ**; the modern Guayla is labelled
  as such.

Good sources of singers: elders and village singers who know wedding songs,
ጓይላ, harvest and work songs; traditional krar/wata players who also sing.

No commercial music API sings these languages today (see the comparison
in the project conversation), and the reference songs used to tune the studio
are **not** training data: they belong to their artists.

## 1. Data: what the app now collects

The **"Teach Tigtog to sing"** page (`#/voice`, in the ＋ menu):

- **Consent first.** Three explicit checkboxes (18+, own voice, agree to use
  for training). Consent is versioned (`VOICE_CONSENT_VERSION`); changing the
  wording means bumping the version and asking again.
- **Private storage.** Audio goes to `TIGTOG_VOICE_DIR` (default `data/voice`),
  which is never served over HTTP. The server refuses to start if it is
  configured inside the public media folder.
- **Withdraw any time.** A singer can delete single recordings, or withdraw,
  which deletes all of their audio and labels.
- **Guided prompts with exact labels.** Each prompt plays a count-in and a
  guide melody (ጭራ-ዋጣ voice) in the singer's range. Because the app plays the
  guide, every recording is saved with:
  - the text and its **phonemes** (`public/g2p.js`, Fidel → phonemes, with
    Tigrinya/Amharic differences and ɨ insertion),
  - every **note's pitch and start/end time** relative to the audio.
- **Prompts** (`public/voice-prompts.js`):
  - ሀ ሁ ሂ ሃ ሄ ህ ሆ rows for every consonant (31 Tigrinya, 28 Amharic),
    sung up the ትዝታ scale, one syllable per beat at 76 BPM;
  - 10 everyday lines per language, one syllable per eighth note.
  The lines must be reviewed by native speakers; add more freely.
- Raw microphone audio (no echo cancellation, noise suppression or auto gain).
  Singers should use headphones so the guide isn't recorded.

## 2. Export (songs)

Traditional songs are exported to `<lang>/songs/` with lyrics, phonemes,
tempo, rhythm and the first downbeat's time. Before training, extract their
melody (pitch tracking → notes on the known beat grid) and align phonemes;
the beat timing makes this much easier than with uncontrolled recordings.

## 2b. Export (guided prompts)

```bash
node tools/export-voice-dataset.mjs --db data/tigtog.json --voice data/voice --out dataset
```

Per language: `wavs/` (44.1 kHz mono), `transcriptions.csv`
(`name,ph_seq,ph_dur,ph_num,note_seq,note_dur`), `metadata.jsonl`,
`dictionary.txt` (every Fidel syllable → phonemes) and `phonemes.txt`.
Only singers with current consent are exported, under anonymous IDs.

Phoneme durations inside each note are a first pass (consonants ~70 ms).
Refine them with forced alignment on the audio (e.g. SOFA or the Montreal
Forced Aligner) before training, and check the CSV columns against the
DiffSinger version you use.

## 3. Model

**DiffSinger (openvpi fork), Apache-2.0**: a widely used open-source
singing-voice synthesiser whose phoneme system is configured per language,
so ትግርኛ and አማርኛ dictionaries can be added. Train it from scratch or
fine-tune on our data; either way the trained weights are ours. Pretrained
checkpoints from others may carry their own licences — check before using.
(Alternative: NNSVS, designed to be language-independent.)

## 4. How much data

Estimates, to be confirmed by experiment:

| Stage | Per voice | Notes |
|---|---|---|
| Proof of concept | ~30–60 min | Recognisable, rough. Good to test the pipeline. |
| Usable | ~2–3 h | Public single-singer singing datasets used for these models are typically a few hours (e.g. Opencpop, ~5 h). |
| Good | 4–6 h+ | Plus multiple singers for a multi-speaker model. |

All prompts once ≈ 6–8 minutes of singing per singer per language, so the
prompt list will need to grow (more lines, real song lyrics written for Tigtog)
and each singer will record across several sessions.

## 5. Compute

This environment has no GPU. Training needs a rented GPU (e.g. one 24 GB card);
expect on the order of a day or more per model, i.e. tens of dollars, not
thousands. Inference (singing a song) can run on a smaller GPU server.

## 6. Evaluation

- Native ትግርኛ and አማርኛ speakers rate intelligibility and naturalness
  (blind, mixed with real recordings).
- Check the hard sounds: ejectives (ቀ ጠ ጨ ጰ ጸ), pharyngeals (ሐ ዐ),
  ኸ/ቐ in Tigrinya, labialised ጓ ቋ ኳ, and ɨ placement.

## 7. Before collecting from the public

- Have the consent text reviewed by a lawyer for the countries singers live in.
- Decide whether contributors are credited or paid.
- Keep the data off the public repo and back it up securely.
