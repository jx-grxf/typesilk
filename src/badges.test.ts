import { describe, expect, it } from "vitest";
import { awardBadges, BADGES, showcase, type RunFacts } from "./badges";
import { emptyProfile } from "./profile";

const run = (overrides: Partial<RunFacts> = {}): RunFacts => ({
  mode: "time", seconds: 60, wpm: 80, accuracy: 97, consistency: 80, words: 80, finished: true, quoteLength: null, ...overrides,
});

describe("badges", () => {
  it("has unique ids and every rarity", () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    expect(new Set(BADGES.map((b) => b.rarity))).toEqual(new Set(["common", "rare", "epic", "legendary"]));
  });

  it("awards a badge once and reports it rarest first", () => {
    const profile = { ...emptyProfile(), tests: 1 };
    const first = awardBadges(profile, run({ wpm: 152, accuracy: 96 }), new Date(2026, 10, 1, 14));
    expect(first.map((b) => b.id)).toEqual(["one-fifty", "hundred", "first-words", "sixty"]);
    expect(awardBadges(profile, run({ wpm: 152 }), new Date(2026, 10, 1, 15))).toEqual([]);
    expect(showcase(profile).map((b) => b.id)).toEqual(["one-fifty", "hundred", "first-words"]);
  });

  it("finds the secret ones", () => {
    const profile = emptyProfile();
    const ids = (r: RunFacts, at = new Date(2026, 10, 1, 14)): string[] => awardBadges(profile, r, at).map((b) => b.id);
    expect(ids(run({ wpm: 121.2, accuracy: 100, seconds: 30 }))).toContain("palindrome");
    expect(ids(run({ wpm: 99.6, accuracy: 100, seconds: 30 }))).toContain("exactly");
    expect(ids(run(), new Date(2026, 10, 2, 0, 3))).toContain("midnight");
  });

  it("ignores zen, custom text and broken runs for skill badges", () => {
    const profile = emptyProfile();
    expect(awardBadges(profile, run({ mode: "zen", wpm: 250 }))).toEqual([]);
    expect(awardBadges(profile, run({ mode: "perfect", words: 100, wpm: 160, finished: false }))).toEqual([]);
  });
});
