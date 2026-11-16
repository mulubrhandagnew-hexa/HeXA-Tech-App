import { describe, it, expect } from "vitest";
// The browser keymap is plain JS shared with the web client.
// @ts-ignore -- no type declarations for the client module
import { transliterate, applyKey } from "../public/fidel.js";

const t = transliterate as (s: string) => string;

describe("Fidel phonetic typing", () => {
  it("writes common Amharic and Tigrinya words", () => {
    expect(t("selam")).toBe("ሰላም");
    expect(t("ityoPya")).toBe("ኢትዮጵያ");
    expect(t("Ertra")).toBe("ኤርትራ");
    expect(t("amarNa")).toBe("አማርኛ");
    expect(t("tgrNa")).toBe("ትግርኛ");
    expect(t("muziqa")).toBe("ሙዚቃ");
    expect(t("Tizita")).toBe("ጢዚታ");
    expect(t("heger")).toBe("ሀገር");
    expect(t("kebero")).toBe("ከበሮ");
  });

  it("handles every vowel order", () => {
    expect(t("le lu li la lE l lo lW")).toBe("ለ ሉ ሊ ላ ሌ ል ሎ ሏ");
    expect(t("lie")).toBe("ሌ");
  });

  it("handles labialized (wa) forms, including the velar rows", () => {
    expect(t("gWayla")).toBe("ጓይላ");
    expect(t("lWa")).toBe("ሏ");
    expect(t("qWa kWa QWa KWa")).toBe("ቋ ኳ ቛ ዃ");
    expect(t("gWe gWi gWE gW")).toBe("ጐ ጒ ጔ ጕ");
    expect(t("swa")).toBe("ስዋ"); // plain w stays a separate letter
  });

  it("writes the Tigrinya music words", () => {
    expect(t("gWayla")).toBe("ጓይላ");
    expect(t("Krar")).toBe("ኽራር");
    expect(t("Qnit")).toBe("ቕኒት");
    expect(t("s`s`it")).toBe("ስዕስዒት");
    expect(t("shembeqo")).toBe("ሸምበቆ");
    expect(t("emblta")).toBe("እምብልታ");
    expect(t("embilta")).toBe("እምቢልታ"); // Amharic spelling
    expect(t("Cra-waTa")).toBe("ጭራ-ዋጣ");
  });

  it("handles digraphs", () => {
    expect(t("sha")).toBe("ሻ");
    expect(t("cha")).toBe("ቻ");
    expect(t("tsa")).toBe("ጻ");
    expect(t("nya")).toBe("ኛ");
    expect(t("kha")).toBe("ኻ");
    expect(t("qha")).toBe("ቓ");
    expect(t("zha")).toBe("ዣ");
  });

  it("handles standalone vowels, ayn and the separator", () => {
    expect(t("a")).toBe("አ");
    expect(t("Ab")).toBe("ኣብ"); // Tigrinya ኣብ
    expect(t("`amet")).toBe("ዓመት");
    expect(t("s'a")).toBe("ስአ");
    expect(t("s'h")).toBe("ስህ");
  });

  it("maps Ethiopic punctuation", () => {
    expect(t("selam::")).toBe("ሰላም።");
    expect(t("a, b; c:")).toBe("አ፣ ብ፤ ች፡");
  });

  it("passes through unmapped characters", () => {
    expect(t("2026 #buna!")).toBe("2026 #ቡና!");
  });

  it("is incremental", () => {
    let r = applyKey("", "s");
    expect(r.text).toBe("ስ");
    r = applyKey(r.text, "e", r.state);
    expect(r.text).toBe("ሰ");
  });
});

describe("krar string model", () => {
  it("renders finite, normalised audio at every studio pitch and sample rate", async () => {
    // @ts-ignore -- client module without type declarations
    const { renderKrar } = await import("../public/music.js");
    for (const sr of [44100, 48000]) {
      for (let midi = 40; midi <= 72; midi++) {
        const f = 440 * Math.pow(2, (midi - 69) / 12);
        const out: Float32Array = renderKrar(f, sr);
        let peak = 0;
        let nonFinite = 0;
        for (let i = 0; i < out.length; i++) {
          const v = out[i]!;
          if (!Number.isFinite(v)) nonFinite++;
          else if (Math.abs(v) > peak) peak = Math.abs(v);
        }
        expect(nonFinite, `non-finite samples at midi ${midi}, ${sr} Hz`).toBe(0);
        expect(peak).toBeCloseTo(1, 5);
        // Still ringing after a second, but decaying: relative to the note's
        // own start. Calibrated decay is ~-22 dB/s in the krar's range and
        // faster for high notes (worst measured -34 dB at 523 Hz), so require
        // it to be quieter than the start yet less than 40 dB down.
        const rms = (a: number, b: number) =>
          Math.sqrt(out.subarray(a * sr, b * sr).reduce((s, v) => s + v * v, 0) / ((b - a) * sr));
        const dropDb = 20 * Math.log10(rms(1, 1.1) / rms(0.02, 0.12));
        expect(dropDb, `midi ${midi} at ${sr} Hz`).toBeLessThan(0);
        expect(dropDb, `midi ${midi} at ${sr} Hz`).toBeGreaterThan(-40);
      }
    }
  });
});
