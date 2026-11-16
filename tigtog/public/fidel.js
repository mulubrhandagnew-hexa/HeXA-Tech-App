// Latin → Ge'ez (Fidel) phonetic typing for Tigrinya and Amharic.
//
// Type a consonant, then a vowel:   s e l a m  → ሰላም
//   e = 1st order (ሰ)   u = ሱ   i = ሲ   a = ሳ   E or ie = ሴ   (none) = ስ   o = ሶ
//   W = "wa" form: lW / lWa → ሏ;  gWa → ጓ  qWa → ቋ  kWa → ኳ  (gWe ጐ, gWi ጒ, gWE ጔ, gW ጕ)
// Digraphs: sh/x ሽ  ch/c ች  ts/S ጽ  ny/N ኝ  zh/Z ዥ  kh/K ኽ  qh/Q ቕ
// Uppercase: H ሕ  T ጥ  C ጭ  P ጵ   ` = ዕ (ayn)   ' = separator (ን'የ → ንእየ is n'ie)
// Standalone vowels: a አ  A ኣ  u ኡ  i ኢ  E ኤ  e እ  o ኦ
// Punctuation: :: ።   : ፡   , ፣   ; ፤
//
// The core is pure: `applyKey(before, ch, state)` takes the text before the
// cursor and one typed character, and returns the new text before the cursor.

/** Base code point (1st order) of each consonant row, keyed by Latin letter. */
const ROWS = {
  h: 0x1200, l: 0x1208, H: 0x1210, m: 0x1218, r: 0x1228, s: 0x1230, x: 0x1238,
  q: 0x1240, Q: 0x1250, b: 0x1260, v: 0x1268, t: 0x1270, c: 0x1278, n: 0x1290,
  N: 0x1298, k: 0x12a8, K: 0x12b8, w: 0x12c8, "`": 0x12d0, z: 0x12d8, Z: 0x12e0,
  y: 0x12e8, d: 0x12f0, j: 0x1300, g: 0x1308, T: 0x1320, C: 0x1328, P: 0x1330,
  S: 0x1338, f: 0x1348, p: 0x1350,
};

/** Second letter of a digraph, applied to a 6th-order consonant: [from, to]. */
const DIGRAPHS = {
  h: [["s", "x"], ["c", "c"], ["k", "K"], ["z", "Z"], ["q", "Q"]],
  s: [["t", "S"]],
  y: [["n", "N"]],
};

/** Vowel letter → order offset within a row. */
const ORDERS = { e: 0, u: 1, i: 2, a: 3, E: 4, o: 6 };

/** Labialized ("wa") rows of the velars: ጐ ጒ ጓ ጔ ጕ etc. Offsets: e0 i2 a3 E4 (6th)5. */
const LABIAL = { q: 0x1248, Q: 0x1258, k: 0x12b0, K: 0x12c0, g: 0x1310 };
const LABIAL_ORDERS = { e: 0, i: 2, a: 3, E: 4 };

const STANDALONE = { a: "አ", A: "ኣ", u: "ኡ", i: "ኢ", E: "ኤ", e: "እ", o: "ኦ" };
const VOWEL_ROW = 0x12a0;

const PUNCT = { ",": "፣", ";": "፤", ":": "፡" };

// Reverse lookup: code point → [rowLetter, order].
const CODE_INFO = new Map();
for (const [letter, base] of Object.entries(ROWS)) {
  for (let o = 0; o < 8; o++) CODE_INFO.set(base + o, [letter, o]);
}
for (let o = 0; o < 7; o++) CODE_INFO.set(VOWEL_ROW + o, ["'", o]);
const LABIAL_INFO = new Map();
for (const [letter, base] of Object.entries(LABIAL)) {
  for (const o of [0, 2, 3, 4, 5]) LABIAL_INFO.set(base + o, [letter, o]);
}

const fromRow = (letter, order) =>
  String.fromCodePoint((letter === "'" ? VOWEL_ROW : ROWS[letter]) + order);

/** Is `ch` a Latin key that this keymap handles? */
export function isFidelKey(ch) {
  return ch in ROWS || ch in ORDERS || ch in STANDALONE || ch in PUNCT || ch === "'" || ch === "W";
}

/**
 * Apply one typed character.
 * @param {string} before text before the cursor
 * @param {string} ch the typed character
 * @param {{sep?: boolean}} [state] pass the returned state into the next call
 * @returns {{text: string, state: {sep: boolean}}}
 */
export function applyKey(before, ch, state = {}) {
  const lastCp = before.codePointAt(before.length - 1);
  const head = before.slice(0, -1);
  const info = state.sep ? undefined : CODE_INFO.get(lastCp ?? -1);
  const labial = state.sep ? undefined : LABIAL_INFO.get(lastCp ?? -1);
  const done = (text, extra = {}) => ({ text, state: { sep: false, ...extra } });

  if (ch === "'") return { text: before, state: { sep: true } };

  // "W" after a consonant → labialized form: gW → ጕ (then gWa → ጓ), lW → ሏ.
  if (ch === "W" && info && info[1] === 5 && info[0] !== "'") {
    const [letter] = info;
    if (letter in LABIAL) return done(head + String.fromCodePoint(LABIAL[letter] + 5));
    return done(head + fromRow(letter, 7), { wa: true });
  }
  // Vowel after a labialized velar: ጕ + a → ጓ, ጕ + e → ጐ, ...
  if (labial && labial[1] === 5 && ch in LABIAL_ORDERS) {
    return done(head + String.fromCodePoint(LABIAL[labial[0]] + LABIAL_ORDERS[ch]));
  }
  // "lWa": the a is already part of ሏ.
  if (ch === "a" && state.wa) return done(before);

  if (ch in PUNCT) {
    if (ch === ":" && before.endsWith("፡")) return done(head + "።");
    return done(before + PUNCT[ch]);
  }

  // Vowel after a consonant (6th order) → change its order.
  if (ch in ORDERS && info) {
    const [letter, order] = info;
    if (order === 5 && letter !== "'") return done(head + fromRow(letter, ORDERS[ch]));
    // "ie" → 5th order (ሊ + e → ሌ, ኢ + e → ኤ)
    if (order === 2 && ch === "e") return done(head + fromRow(letter, 4));
  }

  // Digraph: second letter after a 6th-order consonant.
  if (ch in DIGRAPHS && info && info[1] === 5) {
    for (const [from, to] of DIGRAPHS[ch]) {
      if (info[0] === from) return done(head + fromRow(to, 5));
    }
  }

  if (ch in ROWS) return done(before + fromRow(ch, 5));
  if (ch in STANDALONE) return done(before + STANDALONE[ch]);
  return done(before + ch);
}

/** Convert a whole Latin string to Fidel (non-mapped characters pass through). */
export function transliterate(latin) {
  let text = "";
  let state = {};
  for (const ch of latin) {
    ({ text, state } = applyKey(text, ch, state));
  }
  return text;
}

/**
 * Turn on phonetic Fidel typing for an <input> or <textarea>.
 * Returns a function that reports/sets whether it is enabled.
 */
export function attachFidelInput(field, isEnabled) {
  let state = {};
  field.addEventListener("beforeinput", (e) => {
    if (!isEnabled()) return;
    if (e.inputType !== "insertText" || !e.data || e.data.length !== 1 || !isFidelKey(e.data)) {
      state = {};
      return;
    }
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const before = field.value.slice(0, start);
    const after = field.value.slice(end);
    const r = applyKey(before, e.data, state);
    state = r.state;
    e.preventDefault();
    field.value = r.text + after;
    field.setSelectionRange(r.text.length, r.text.length);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  field.addEventListener("blur", () => (state = {}));
}
