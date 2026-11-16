#!/usr/bin/env node
/**
 * Export Tigtog's consented voice recordings as a singing-voice training set
 * (DiffSinger / openvpi style).
 *
 *   node tools/export-voice-dataset.mjs \
 *     --db data/tigtog.json --voice data/voice --out dataset [--lang ti|am]
 *
 * Writes, per language:
 *   <out>/<lang>/wavs/<name>.wav          44.1 kHz mono 16-bit (needs ffmpeg)
 *   <out>/<lang>/transcriptions.csv       name,ph_seq,ph_dur,ph_num,note_seq,note_dur
 *   <out>/<lang>/metadata.jsonl           text, phonemes, notes, singer, consent
 *   <out>/<lang>/dictionary.txt           Fidel syllable <TAB> phonemes
 *   <out>/<lang>/phonemes.txt             phoneme inventory
 *
 * Only samples whose singer has a current consent are exported. Singers are
 * identified by an anonymous hash, never by username.
 *
 * Phoneme durations are a first pass: inside each guide note, consonants get
 * ~70 ms and the vowel the rest. Before training, refine them with forced
 * alignment (e.g. SOFA or Montreal Forced Aligner) on the audio, and check
 * the CSV columns against the DiffSinger version you train with.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { g2p, phonemeInventory, syllable } from "../public/g2p.js";

const VOICE_CONSENT_VERSION = 1;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const r3 = (x) => Math.round(x * 1000) / 1000;

function args() {
  const a = Object.fromEntries(
    process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
  );
  return {
    db: resolve(a.db ?? "data/tigtog.json"),
    voice: resolve(a.voice ?? "data/voice"),
    out: resolve(a.out ?? "dataset"),
    lang: a.lang,
  };
}

/**
 * Build one transcription row from a sample: silences (SP) around and
 * between notes, each note's phonemes splitting its duration.
 */
export function transcription(sample, name) {
  const words = g2p(sample.text, sample.language);
  const sylPhonemes = [];
  // Re-split word phonemes per syllable so each guide note gets its own.
  for (const w of words) {
    let rest = [...w.phonemes];
    w.syllables.forEach((ch, k) => {
      const s = syllable(ch, sample.language);
      const isLast = k === w.syllables.length - 1;
      // consonants of this syllable, then its vowel if the word gave it one
      const take = s.cons.length + (rest[s.cons.length] && /^(ae|u|i|a|e|ix|o)$/.test(rest[s.cons.length]) ? 1 : 0);
      sylPhonemes.push(isLast ? rest : rest.slice(0, take));
      rest = isLast ? [] : rest.slice(take);
    });
  }
  const ph = [];
  const phDur = [];
  const phNum = [];
  const notes = [];
  const noteDur = [];
  let t = 0;
  const rest = (d) => {
    if (d <= 0.005) return;
    ph.push("SP"); phDur.push(r3(d)); phNum.push(1); notes.push("rest"); noteDur.push(r3(d));
  };
  sample.notes.forEach((n, i) => {
    rest(n.start - t);
    const p = sylPhonemes[i] ?? [];
    const cons = p.filter((x) => !/^(ae|u|i|a|e|ix|o)$/.test(x));
    const consDur = Math.min(0.07 * cons.length, n.dur * 0.4);
    const vowelDur = n.dur - consDur;
    const hasVowel = p.length > cons.length;
    for (const x of p) {
      ph.push(x);
      const isVowel = /^(ae|u|i|a|e|ix|o)$/.test(x);
      phDur.push(r3(isVowel ? vowelDur : hasVowel ? consDur / cons.length : n.dur / cons.length));
    }
    phNum.push(p.length);
    notes.push(noteName(n.midi));
    noteDur.push(r3(n.dur));
    t = n.start + n.dur;
  });
  rest(sample.durationSec - t);
  return {
    name,
    ph_seq: ph.join(" "),
    ph_dur: phDur.join(" "),
    ph_num: phNum.join(" "),
    note_seq: notes.join(" "),
    note_dur: noteDur.join(" "),
  };
}

function dictionary(lang) {
  const lines = [];
  for (let cp = 0x1200; cp <= 0x1357; cp++) {
    const ch = String.fromCodePoint(cp);
    if (!syllable(ch, lang)) continue;
    lines.push(`${ch}\t${g2p(ch, lang)[0].phonemes.join(" ")}`);
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const { db, voice, out, lang } = args();
  const state = JSON.parse(await readFile(db, "utf8"));
  const consented = new Map(
    (state.voiceConsents ?? []).filter((c) => c.version === VOICE_CONSENT_VERSION).map((c) => [c.userId, c]),
  );
  const audio = new Map((state.voiceAudio ?? []).map((a) => [a.id, a]));
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
  if (!hasFfmpeg) console.warn("ffmpeg not found: writing labels only, no WAVs");

  const summary = {};
  for (const L of lang ? [lang] : ["ti", "am"]) {
    const dir = join(out, L);
    await mkdir(join(dir, "wavs"), { recursive: true });
    const rows = [];
    const meta = [];
    let seconds = 0;
    const singers = new Set();
    for (const s of state.voiceSamples ?? []) {
      if (s.language !== L || !consented.has(s.userId)) continue;
      const a = audio.get(s.audioId);
      if (!a || !existsSync(join(voice, a.fileName))) continue;
      const singer = "spk_" + createHash("sha256").update(s.userId).digest("hex").slice(0, 10);
      const name = `${singer}_${s.promptId}_${s.id.slice(0, 8)}`;
      if (hasFfmpeg) {
        const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", join(voice, a.fileName),
          "-ac", "1", "-ar", "44100", "-sample_fmt", "s16", join(dir, "wavs", `${name}.wav`)]);
        if (r.status !== 0) { console.warn(`skip ${name}: ${r.stderr}`); continue; }
      }
      rows.push(transcription(s, name));
      meta.push({ name, singer, language: L, kind: s.kind, text: s.text, phonemes: s.phonemes,
        notes: s.notes, bpm: s.bpm, cents: s.cents, durationSec: s.durationSec, consentVersion: s.consentVersion });
      seconds += s.durationSec;
      singers.add(singer);
    }
    const header = "name,ph_seq,ph_dur,ph_num,note_seq,note_dur";
    await writeFile(join(dir, "transcriptions.csv"),
      [header, ...rows.map((r) => [r.name, r.ph_seq, r.ph_dur, r.ph_num, r.note_seq, r.note_dur].join(","))].join("\n") + "\n");
    await writeFile(join(dir, "metadata.jsonl"), meta.map((m) => JSON.stringify(m)).join("\n") + (meta.length ? "\n" : ""));
    await writeFile(join(dir, "dictionary.txt"), dictionary(L));
    await writeFile(join(dir, "phonemes.txt"), ["SP", "AP", ...phonemeInventory(L)].join("\n") + "\n");
    summary[L] = { samples: rows.length, minutes: Math.round((seconds / 60) * 10) / 10, singers: singers.size };
  }
  console.log(JSON.stringify(summary));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
