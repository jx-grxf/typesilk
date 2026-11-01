import { describe, expect, it } from "vitest";
import english from "../public/words/english.txt?raw";
import { dailyNumber, dailyWords, DAILY_WORDS } from "./daily";
import { registerWords } from "./words";

registerWords("english", english.split("\n").filter(Boolean));

describe("daily", () => {
  it("counts days from the first daily in local time", () => {
    expect(dailyNumber(new Date(2026, 10, 1, 0, 5))).toBe(1);
    expect(dailyNumber(new Date(2026, 10, 1, 23, 55))).toBe(1);
    expect(dailyNumber(new Date(2026, 11, 1, 9))).toBe(31);
  });

  it("gives everyone the same words for the same daily, and new ones the next day", () => {
    const today = dailyWords(5, "english");
    expect(today).toHaveLength(DAILY_WORDS);
    expect(dailyWords(5, "english")).toEqual(today);
    expect(dailyWords(6, "english")).not.toEqual(today);
    expect(dailyWords(5, "german")).not.toEqual(today);
  });
});
