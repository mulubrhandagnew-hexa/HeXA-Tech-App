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
