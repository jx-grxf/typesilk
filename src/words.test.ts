import { describe, expect, it } from "vitest";
import { createWordSource, LANGUAGES, wordList, type Language } from "./words";

describe("word lists", () => {
  it("has a long list per language that keeps every word of the short one", () => {
    for (const language of Object.keys(LANGUAGES) as Language[]) {
      const short = wordList(language, "200");
      const long = wordList(language, "1k");
      expect(long.length).toBeGreaterThan(850);
      expect(new Set(long).size).toBe(long.length);
      for (const word of short) expect(long).toContain(word);
    }
  });

  it("draws from the long list when asked", () => {
    const short = new Set(wordList("english", "200"));
    const words = createWordSource("english", { punctuation: false, numbers: false, size: "1k" })(400);
    expect(words.some((word) => !short.has(word))).toBe(true);
  });
});
