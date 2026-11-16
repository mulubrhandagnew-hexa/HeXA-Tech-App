// Fidel (Ge'ez script) → phonemes for Tigrinya and Amharic.
//
// Used to label singing recordings for training Tigtog's own voice model
// (DiffSinger-style phoneme dictionaries). Pure, no dependencies.
//
// Phoneme set (ASCII, one token each):
//   vowels      ae (1st order ä/ə)  u  i  a  e  ix (6th order ɨ)  o
//   consonants  h l m r s sh b v t ch n ny k w z zh y d j g f p
//               hh (ħ ሐ)  ain (ʕ ዐ)  gs (ʔ glottal stop)  kh (x ኸ)
//               q (qʼ ቀ)  qh (Tigrinya ቐ)  tt (tʼ ጠ)  cc (tʃʼ ጨ)  pp (pʼ ጰ)  ts (tsʼ ጸ)
//   labialised consonants are written as consonant + "w" (ጓ → g w a).
//
// Language differences handled:
//   - Amharic merges ሐ/ኀ/ኸ → h, ዐ → gs, ቐ → q; Tigrinya keeps hh, ain, kh, qh.
//   - Amharic pronounces the 1st order of ሀ ሐ ኀ አ ዐ as "a" (ሀገር = hager).
// The 6th order is written the same whether it has a vowel (ɨ) or not; we
// insert ɨ (ix) by rule: word-initially before another consonant, inside
// clusters of three, and always on the glottal/ayn rows (እ, ዕ).
// Gemination (doubled consonants) is not written in Fidel, so it can't be
// recovered from text in general; the common -ኛ suffix (always doubled) is
// handled as a special case. Forced alignment on the recordings refines this.

const VOWELS = ["ae", "u", "i", "a", "e", "ix", "o"];

/** Row base → [Tigrinya consonant, Amharic consonant, labialised row?] */
const ROWS = [
  [0x1200, "h", "h"], [0x1208, "l", "l"], [0x1210, "hh", "h"], [0x1218, "m", "m"],
  [0x1220, "s", "s"], [0x1228, "r", "r"], [0x1230, "s", "s"], [0x1238, "sh", "sh"],
  [0x1240, "q", "q"], [0x1248, "q", "q", true], [0x1250, "qh", "q"], [0x1258, "qh", "q", true],
  [0x1260, "b", "b"], [0x1268, "v", "v"], [0x1270, "t", "t"], [0x1278, "ch", "ch"],
  [0x1280, "hh", "h"], [0x1288, "hh", "h", true], [0x1290, "n", "n"], [0x1298, "ny", "ny"],
  [0x12a0, "gs", "gs"], [0x12a8, "k", "k"], [0x12b0, "k", "k", true], [0x12b8, "kh", "h"],
  [0x12c0, "kh", "h", true], [0x12c8, "w", "w"], [0x12d0, "ain", "gs"], [0x12d8, "z", "z"],
  [0x12e0, "zh", "zh"], [0x12e8, "y", "y"], [0x12f0, "d", "d"], [0x1300, "j", "j"],
  [0x1308, "g", "g"], [0x1310, "g", "g", true], [0x1320, "tt", "tt"], [0x1328, "cc", "cc"],
  [0x1330, "pp", "pp"], [0x1338, "ts", "ts"], [0x1340, "ts", "ts"], [0x1348, "f", "f"],
  [0x1350, "p", "p"],
];

/** Rows whose 1st order Amharic pronounces as "a". */
const AM_LARYNGEAL = new Set([0x1200, 0x1210, 0x1280, 0x12a0, 0x12d0]);
/** Rows that always carry a vowel in the 6th order (እ = ʔɨ, ዕ = ʕɨ). */
const VOWEL_CARRIERS = new Set([0x12a0, 0x12d0]);

/** Labialised rows use offsets 0,2,3,4,5 for ae,i,a,e,ix. */
const LABIAL_VOWEL = { 0: "ae", 2: "i", 3: "a", 4: "e", 5: "ix" };

const PUNCT = /[\s፡።፣፤፥፦፧፨,.;:!?¡¿"'“”‘’()\-–—]+/u;

/** Decompose one Fidel syllable. Returns null for non-Fidel characters. */
export function syllable(ch, lang = "ti") {
  const cp = ch.codePointAt(0);
  for (const [base, ti, am, labial] of ROWS) {
    if (cp < base || cp >= base + 8) continue;
    const off = cp - base;
    const cons = lang === "am" ? am : ti;
    if (labial) {
      const v = LABIAL_VOWEL[off];
      if (!v) return null;
      return { cons: [cons, "w"], vowel: v === "ix" ? null : v, sixth: v === "ix", base };
    }
    if (off === 7) return { cons: [cons, "w"], vowel: "a", sixth: false, base };
    let vowel = VOWELS[off];
    if (lang === "am" && off === 0 && AM_LARYNGEAL.has(base)) vowel = "a";
    if (off === 5) return { cons: [cons], vowel: VOWEL_CARRIERS.has(base) ? "ix" : null, sixth: true, base };
    return { cons: [cons], vowel, sixth: false, base };
  }
  return null;
}

/** Phonemes of one word (array of syllable objects → flat phoneme list). */
function wordPhonemes(sylls) {
  const segs = sylls.map((s) => ({ ...s, vowel: s.vowel }));
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.vowel) continue;
    const next = segs[i + 1];
    const prev = segs[i - 1];
    // A lone 6th-order syllable is said/sung with ɨ (ህ = hɨ, as in the ሀ ሁ ሂ chant).
    if (segs.length === 1) s.vowel = "ix";
    // Word-initial consonant before another syllable: ɨ (ብዙ = bɨzu).
    else if (i === 0 && next) s.vowel = "ix";
    // Middle of a three-consonant cluster: ɨ (ትግርኛ = tɨ.g.rɨ.ɲa).
    else if (prev && !prev.vowel && next) s.vowel = "ix";
    // Before the -ኛ suffix, whose ɲ is always doubled: አማርኛ = amarɨɲɲa.
    else if (next && next.cons[0] === "ny" && next.vowel === "a" && i === segs.length - 2) s.vowel = "ix";
  }
  return segs.flatMap((s) => (s.vowel ? [...s.cons, s.vowel] : s.cons));
}

/**
 * Convert text to phonemes, word by word.
 * @returns {{word: string, syllables: string[], phonemes: string[]}[]}
 */
export function g2p(text, lang = "ti") {
  const words = [];
  for (const raw of text.split(PUNCT)) {
    if (!raw) continue;
    const sylls = [];
    const chars = [];
    for (const ch of raw) {
      const s = syllable(ch, lang);
      if (s) { sylls.push(s); chars.push(ch); }
    }
    if (sylls.length) words.push({ word: raw, syllables: chars, phonemes: wordPhonemes(sylls) });
  }
  return words;
}

/** All phonemes used for a language (for the model's dictionary). */
export function phonemeInventory(lang = "ti") {
  const set = new Set(VOWELS.concat(["w"]));
  for (const [, ti, am] of ROWS) set.add(lang === "am" ? am : ti);
  return [...set].sort();
}

/** Space-separated phonemes, words separated by " | ". */
export function phonemeString(text, lang = "ti") {
  return g2p(text, lang).map((w) => w.phonemes.join(" ")).join(" | ");
}
