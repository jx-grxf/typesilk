import { describe, expect, it } from "vitest";
import english from "../public/words/english.txt?raw";
import german from "../public/words/german.txt?raw";
import { availableSizes, createWordSource, effectiveSize, registerWords, wordList } from "./words";

registerWords("english", english.split("\n").filter(Boolean));
registerWords("german", german.split("\n").filter(Boolean));

describe("word lists", () => {
  it("offers more sizes for English and German than for Spanish and French", () => {
    expect(availableSizes("english")).toEqual(["200", "1k", "5k", "10k", "20k"]);
    expect(availableSizes("german")).toEqual(["200", "1k", "5k", "10k"]);
    expect(availableSizes("spanish")).toEqual(["200", "1k"]);
    expect(effectiveSize("french", "20k")).toBe("1k");
  });

  it("returns lists of the asked size without duplicates", () => {
    expect(wordList("english", "20k")).toHaveLength(20000);
    expect(wordList("german", "5k")).toHaveLength(5000);
    for (const language of ["spanish", "french"] as const) {
      const list = wordList(language, "1k");
      expect(list.length).toBeGreaterThan(850);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("keeps only plain words", () => {
    expect(wordList("english", "20k").every((word) => /^[A-Za-z]+('[a-z]+)?$/.test(word))).toBe(true);
    expect(wordList("german", "10k").every((word) => /^[A-ZÄÖÜa-zäöüß][a-zäöüß]+$/.test(word))).toBe(true);
  });

  it("draws from the long list when asked", () => {
    const common = new Set(wordList("english", "200"));
    const words = createWordSource("english", { punctuation: false, numbers: false, size: "10k" })(400);
    expect(words.some((word) => !common.has(word))).toBe(true);
  });
});
