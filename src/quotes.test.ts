import { describe, expect, it } from "vitest";
import { customWords, pickQuote, QUOTES, quoteLength } from "./quotes";
import { LANGUAGES, type Language } from "./words";

describe("quotes", () => {
  it("has quotes for every language, without characters that need special input", () => {
    for (const language of Object.keys(LANGUAGES) as Language[]) {
      expect(QUOTES[language].length).toBeGreaterThan(10);
      for (const quote of QUOTES[language]) {
        expect(quote.text).not.toMatch(/[‘’“”–—…]|\s{2}/);
      }
    }
  });

  it("does not repeat the previous quote", () => {
    const previous = QUOTES.english[0]!;
    for (let i = 0; i < 30; i++) expect(pickQuote("english", "all", previous)).not.toBe(previous);
  });

  it("respects the length filter", () => {
    for (let i = 0; i < 20; i++) expect(quoteLength(pickQuote("german", "short", null))).toBe("short");
  });
});

describe("customWords", () => {
  it("normalises typographic marks and whitespace", () => {
    expect(customWords("It’s  “fine” — ok…\n", false)).toEqual(["It's", '"fine"', "-", "ok..."]);
  });

  it("shuffles without losing words", () => {
    const words = customWords("a b c d e f", true, () => 0.3);
    expect([...words].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
