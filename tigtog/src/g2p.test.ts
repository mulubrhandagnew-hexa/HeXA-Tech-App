import { describe, it, expect } from "vitest";
// @ts-ignore -- client module without type declarations
import { phonemeString, g2p, phonemeInventory, syllable } from "../public/g2p.js";

const ti = (s: string) => phonemeString(s, "ti");
const am = (s: string) => phonemeString(s, "am");

describe("Fidel → phonemes", () => {
  it("handles the seven orders", () => {
    expect(ti("ለ ሉ ሊ ላ ሌ ል ሎ")).toBe("l ae | l u | l i | l a | l e | l ix | l o"); // ል alone = lɨ
    expect(ti("ሏ")).toBe("l w a");
  });

  it("inserts ɨ word-initially and in three-consonant clusters", () => {
    expect(ti("ትግርኛ")).toBe("t ix g r ix ny a"); // tɨgrɨɲa
    expect(ti("ብዙሕ")).toBe("b ix z u hh");
    expect(ti("እምብልታ")).toBe("gs ix m b ix l t a"); // ʔɨmbɨlta
    expect(ti("ሰላም")).toBe("s ae l a m");
    expect(ti("ሰላምታ")).toBe("s ae l a m t a");
  });

  it("keeps Tigrinya pharyngeals and velar fricatives", () => {
    expect(ti("ሓደ")).toBe("hh a d ae");
    expect(ti("ዓመት")).toBe("ain a m ae t");
    expect(ti("ኽራር")).toBe("kh ix r a r");
    expect(ti("ቕኒት")).toBe("qh ix n i t");
  });

  it("applies Amharic mergers and laryngeal 'a'", () => {
    expect(am("ሀገር")).toBe("h a g ae r");
    expect(am("ሐበሻ")).toBe("h a b ae sh a");
    expect(am("ዐይን")).toBe("gs a y n"); // ʔajn
    expect(am("አማርኛ")).toBe("gs a m a r ix ny a");
    expect(ti("አማርኛ")).toBe("gs ae m a r ix ny a"); // Tigrinya keeps ä
  });

  it("handles labialised velars and ejectives", () => {
    expect(ti("ጓይላ")).toBe("g w a y l a");
    expect(ti("ቋንቋ")).toBe("q w a n q w a");
    expect(am("ጠጅ")).toBe("tt ae j");
    expect(am("ጨው")).toBe("cc ae w");
    expect(am("ፀሐይ")).toBe("ts ae h a y");
  });

  it("splits words on spaces and Ethiopic punctuation", () => {
    const w = g2p("ሰላም፡ ከመይ ኣለኹም።", "ti");
    expect(w.map((x: { word: string }) => x.word)).toEqual(["ሰላም", "ከመይ", "ኣለኹም"]);
    expect(w[2].syllables).toEqual(["ኣ", "ለ", "ኹ", "ም"]);
  });

  it("ignores non-Fidel characters and reports inventories", () => {
    expect(ti("2026 #ጓይላ!")).toBe("g w a y l a");
    expect(syllable("x")).toBeNull();
    const inv = phonemeInventory("ti");
    expect(inv).toContain("ain");
    expect(inv).toContain("qh");
    expect(phonemeInventory("am")).not.toContain("ain");
  });
});
