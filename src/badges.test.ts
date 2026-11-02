import { describe, expect, it } from "vitest";
import { awardBadges, BADGES, showcase, type RunFacts } from "./badges";
import { emptyProfile } from "./profile";

const run = (overrides: Partial<RunFacts> = {}): RunFacts => ({
  mode: "time", seconds: 60, wpm: 80, accuracy: 97, consistency: 80, words: 80, finished: true, quoteLength: null,
  language: "english", backspaces: 3, saidName: false, firstToday: false, newBest: false, ...overrides,
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

  it("finds the newer secrets", () => {
    const at = new Date(2026, 10, 2, 14);
    const ids = (r: RunFacts | null, when = at, profile = emptyProfile()): string[] => awardBadges(profile, r, when).map((b) => b.id);
    expect(ids(run({ wpm: 42.3, accuracy: 100, seconds: 30 }))).toContain("answer");
    expect(ids(run({ wpm: 96.6, accuracy: 97.4 }))).toContain("mirror");
    expect(ids(run({ wpm: 97, accuracy: 100 }))).not.toContain("mirror");
    expect(ids(run(), new Date(2026, 10, 2, 3, 30))).toContain("night-owl");
    expect(ids(run(), new Date(2026, 10, 2, 15, 14))).toContain("pi");
    expect(ids(run({ mode: "zen", saidName: true }))).toContain("self-aware");
    expect(ids(run({ backspaces: 0, accuracy: 98.5 }))).toContain("no-looking-back");
    expect(ids(run({ backspaces: 1, accuracy: 99 }))).not.toContain("no-looking-back");

    const streak = { ...emptyProfile(), streakDays: 5 };
    expect(ids(run({ firstToday: true }), new Date(2026, 10, 2, 23, 57), streak)).toContain("close-call");
    expect(ids(run({ firstToday: false }), new Date(2026, 10, 2, 23, 57), { ...streak })).not.toContain("close-call");
  });

  it("reads history for the habit secrets", () => {
    const now = new Date(2026, 10, 2, 14);
    const recent = (key: string, wpm: number, minutesAgo: number) => ({ key, wpm, at: now.getTime() - minutesAgo * 60_000 });

    const busy = { ...emptyProfile(), history: Array.from({ length: 10 }, (_, i) => recent("time:30:english", 80, i * 5)) };
    expect(awardBadges(busy, run(), now).map((b) => b.id)).toContain("binge");

    const traveller = { ...emptyProfile(), history: ["english", "german", "spanish"].map((lang, i) => recent(`time:30:${lang}`, 80, i * 30)) };
    expect(awardBadges(traveller, run({ language: "french" }), now).map((b) => b.id)).toContain("world-tour");

    const slump = [90, 88, 92, 91, 89, 93, 90, 94, 91, 70].map((wpm, i) => recent("time:30:english", wpm, 200 - i));
    const comeback = { ...emptyProfile(), history: [...slump, recent("time:30:english", 101, 0)] };
    expect(awardBadges(comeback, run({ newBest: true }), now).map((b) => b.id)).toContain("comeback");
    const steady = { ...emptyProfile(), history: [...slump.slice(0, 9), recent("time:30:english", 95, 1), recent("time:30:english", 101, 0)] };
    expect(awardBadges(steady, run({ newBest: true }), now).map((b) => b.id)).not.toContain("comeback");
  });

  it("gives every secret a hint", () => {
    for (const badge of BADGES.filter((b) => b.secret)) expect(badge.hint, badge.id).toBeTruthy();
  });

  it("ignores zen, custom text and broken runs for skill badges", () => {
    const profile = emptyProfile();
    expect(awardBadges(profile, run({ mode: "zen", wpm: 250 }))).toEqual([]);
    expect(awardBadges(profile, run({ mode: "perfect", words: 100, wpm: 160, finished: false }))).toEqual([]);
  });
});
