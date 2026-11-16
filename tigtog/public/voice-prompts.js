// Recording prompts for Tigtog's voice dataset, with guide melodies.
//
// Two kinds:
//  - "sweep": one Fidel row sung as ሀ ሁ ሂ ሃ ሄ ህ ሆ, one syllable per beat,
//    up the Tizita-major scale (the qenet of 8 of 9 reference songs). This
//    covers every consonant × vowel and gives clean, well-separated labels.
//  - "line": short everyday phrases sung on the traditional Tigray Guayla
//    bounce (long–short in each beat), over the traditional ከበሮ and claps.
//  - Traditional songs from memory are recorded separately (kind "song").
// The lines were written for this app and should be reviewed by native
// speakers; more can be added here at any time.
import { SCALES } from "./music.js";

const TI_ROWS = "ሀለሐመረሰሸቀቐበተቸነኘአከኸወዐዘዠየደጀገጠጨጰጸፈፐ";
const AM_ROWS = "ሀለመረሰሸቀበቨተቸነኘአከወዘዠየደጀገጠጨጰጸፈፐ";

const LINES = {
  ti: [
    "ሰላም ከመይ ኣለኹም",
    "እንቋዕ ብደሓን መጻእኩም",
    "ሓደ ክልተ ሰለስተ ኣርባዕተ ሓሙሽተ",
    "ሽዱሽተ ሸውዓተ ሸሞንተ ትሽዓተ ዓሰርተ",
    "ጓይላ ንጻወት ኩልና ብሓባር",
    "ቡን ተፈሊሑ ንዑ ንስተ",
    "ኣደይ ኣደይ ፍቕርቲ ኣደይ",
    "ሎሚ ጽቡቕ መዓልቲ እዩ",
    "ኣብ ኣስመራ ኣብ መቐለ ኣብ ኣዲስ",
    "ኽራር ዋጣ ከበሮ ሸምበቆ",
  ],
  am: [
    "ሰላም እንዴት ናችሁ",
    "እንኳን ደህና መጣችሁ",
    "አንድ ሁለት ሦስት አራት አምስት",
    "ስድስት ሰባት ስምንት ዘጠኝ አስር",
    "ቡና ፈላ ኑ እንጠጣ",
    "እናቴ እናቴ ውድ እናቴ",
    "ዛሬ ጥሩ ቀን ነው",
    "ፍቅር ያሸንፋል",
    "አዲስ አበባ ጎንደር መቀሌ ባሕር ዳር",
    "ክራር ማሲንቆ ከበሮ ዋሽንት",
  ],
};

const rowSweep = (ch) => {
  const base = ch.codePointAt(0);
  return Array.from({ length: 7 }, (_, i) => String.fromCodePoint(base + i)).join(" ");
};

/** All prompts for a language, in recording order (sweeps interleaved with lines). */
export function promptsFor(lang) {
  const rows = [...(lang === "am" ? AM_ROWS : TI_ROWS)];
  const sweeps = rows.map((ch, i) => ({ id: `${lang}-sweep-${i}`, kind: "sweep", lang, text: rowSweep(ch) }));
  const lines = LINES[lang].map((text, i) => ({ id: `${lang}-line-${i}`, kind: "line", lang, text }));
  const out = [];
  for (let i = 0; i < Math.max(sweeps.length, lines.length); i++) {
    if (sweeps[i]) out.push(sweeps[i]);
    if (i % 3 === 2 && lines[Math.floor(i / 3)]) out.push(lines[Math.floor(i / 3)]);
  }
  for (const l of lines) if (!out.includes(l)) out.push(l);
  return out;
}

/** Deterministic small PRNG so a prompt always gets the same melody. */
function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}

/**
 * Guide melody for a prompt: one note per Fidel syllable.
 * @param {object} prompt from promptsFor
 * @param {{root: number, bpm: number}} opts root = MIDI note of the scale's root
 * @returns {{syllable: string, midi: number, start: number, dur: number}[]}
 *   start/dur in seconds from the first note.
 */
export function guideNotes(prompt, { root, bpm }) {
  const scale = SCALES.tizitaMajor;
  const midiOf = (row) => root + 12 * Math.floor(row / 5) + scale[row % 5];
  const beat = 60 / bpm;
  const notes = [];
  if (prompt.kind === "sweep") {
    prompt.text.split(" ").forEach((syl, i) => {
      notes.push({ syllable: syl, midi: midiOf(i), start: i * beat, dur: beat * 0.9 });
    });
    return notes;
  }
  // Lines follow the Tigray Guayla bounce measured in the reference songs:
  // each beat (dotted quarter) has a long slot (2/3 beat) then a short slot
  // (1/3 beat). Syllables fill slots in order; a word break skips one slot.
  const rand = seeded(prompt.id);
  const slots = [[0, 2 / 3], [2 / 3, 1 / 3]];
  let slot = 0;
  let row = 2;
  const words = prompt.text.split(/\s+/);
  words.forEach((word, wi) => {
    const sylls = [...word].filter((c) => /\p{Script=Ethiopic}/u.test(c));
    sylls.forEach((syl, si) => {
      const last = wi === words.length - 1 && si === sylls.length - 1;
      const step = Math.floor(rand() * 3) - 1;
      row = Math.max(0, Math.min(6, row + step));
      if (last) row = 0; // end the phrase on the root
      const [pos, len] = slots[slot % 2];
      const start = (Math.floor(slot / 2) + pos) * beat;
      // The final syllable rings to the end of the next beat.
      const dur = last ? (len + (slot % 2 === 0 ? 1 / 3 : 0) + 1) * beat : len * beat;
      notes.push({ syllable: syl, midi: midiOf(row), start, dur: dur * 0.92 });
      slot++;
    });
    slot++; // breath between words
  });
  return notes;
}
