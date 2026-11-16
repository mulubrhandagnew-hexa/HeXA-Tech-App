import { describe, it, expect } from "vitest";
// @ts-ignore -- plain JS tool / client modules
import { transcription, noteName } from "../tools/export-voice-dataset.mjs";
// @ts-ignore
import { promptsFor, guideNotes } from "../public/voice-prompts.js";
// @ts-ignore
import { g2p } from "../public/g2p.js";

const sum = (s: string) => s.split(" ").map(Number).reduce((a, b) => a + b, 0);

describe("voice dataset export", () => {
  it("names notes", () => {
    expect(noteName(57)).toBe("A3");
    expect(noteName(61)).toBe("C#4");
  });

  it("puts each syllable's phonemes on its own note, durations adding up", () => {
    const prompt = { id: "ti-line-x", kind: "line", lang: "ti", text: "ትግርኛ ሰላም" };
    const notes = guideNotes(prompt, { root: 50, bpm: 76 }).map((n: { start: number }) => ({ ...n, start: n.start + 2 }));
    const last = notes[notes.length - 1];
    const sample = { text: prompt.text, language: "ti", notes, durationSec: last.start + last.dur + 1 };
    const r = transcription(sample, "x");
    // ት ግ ር ኛ | ሰ ላ ም → t ix | g | r ix | ny a | s ae | l a | m
    const groups: string[][] = [];
    let i = 0;
    const ph = r.ph_seq.split(" ");
    for (const n of r.ph_num.split(" ").map(Number)) { groups.push(ph.slice(i, i + n)); i += n; }
    const sung = groups.filter((g) => g[0] !== "SP");
    expect(sung).toEqual([["t", "ix"], ["g"], ["r", "ix"], ["ny", "a"], ["s", "ae"], ["l", "a"], ["m"]]);
    expect(sung.flat().join(" ")).toBe(g2p(prompt.text, "ti").map((w: { phonemes: string[] }) => w.phonemes.join(" ")).join(" "));
    expect(sum(r.ph_dur)).toBeCloseTo(sample.durationSec, 2);
    expect(sum(r.note_dur)).toBeCloseTo(sample.durationSec, 2);
    expect(r.ph_num.split(" ").length).toBe(r.note_seq.split(" ").length);
  });

  it("lines sit on the Tigray bounce: long slot on the beat, short slot at 2/3", () => {
    const beat = 60 / 80;
    for (const p of promptsFor("ti").filter((x: { kind: string }) => x.kind === "line")) {
      for (const n of guideNotes(p, { root: 50, bpm: 80 })) {
        const phase = Math.round(((n.start / beat) % 1) * 3);
        expect([0, 2]).toContain(phase);
      }
    }
  });

  it("every prompt has one guide note per Fidel syllable", () => {
    for (const lang of ["ti", "am"]) {
      const prompts = promptsFor(lang);
      expect(prompts.filter((p: { kind: string }) => p.kind === "line")).toHaveLength(10);
      for (const p of prompts) {
        const syllables = g2p(p.text, lang).flatMap((w: { syllables: string[] }) => w.syllables);
        expect(guideNotes(p, { root: 50, bpm: 76 })).toHaveLength(syllables.length);
      }
    }
  });
});
