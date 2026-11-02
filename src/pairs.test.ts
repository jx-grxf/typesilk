import { describe, expect, it } from "vitest";
import { emptyProfile } from "./profile";
import { mergeProfiles, sanitizeProfile } from "./profile-merge";
import { recordPair, weakPairs, type KeyStats } from "./training";
import { createTrainingSource } from "./words";

const typed = (stats: KeyStats, pair: string, gap: number, times = 10, misses = 0): void => {
  for (let i = 0; i < times; i++) recordPair(stats, pair[0]!, pair[1]!, true, gap);
  for (let i = 0; i < misses; i++) recordPair(stats, pair[0]!, pair[1]!, false, null);
};

describe("letter pairs", () => {
  it("finds the slow and the wrong ones", () => {
    const stats: KeyStats = {};
    typed(stats, "th", 110);
    typed(stats, "he", 100);
    typed(stats, "an", 105);
    typed(stats, "ie", 260);
    typed(stats, "ck", 120, 10, 4);
    expect(weakPairs(stats, 2)).toEqual(["ck", "ie"]);
  });

  it("ignores pairs with anything but letters", () => {
    const stats: KeyStats = {};
    recordPair(stats, "'", "s", true, 100);
    recordPair(stats, "a", "1", true, 100);
    recordPair(stats, "T", "h", true, 100);
    expect(Object.keys(stats)).toEqual(["th"]);
  });

  it("waits for enough samples", () => {
    const stats: KeyStats = {};
    typed(stats, "th", 400, 3);
    expect(weakPairs(stats)).toEqual([]);
  });

  it("syncs and sanitizes pairs", () => {
    const a = { ...emptyProfile(), pairs: { th: { hits: 3, misses: 1, time: 300, timed: 3 } } };
    const b = { ...emptyProfile(), pairs: { th: { hits: 2, misses: 0, time: 200, timed: 2 } } };
    expect(mergeProfiles([a, b]).pairs.th).toEqual({ hits: 5, misses: 1, time: 500, timed: 5 });
    expect(Object.keys(sanitizeProfile({ pairs: { th: {}, "<b": {}, abc: {} } }).pairs)).toEqual(["th"]);
  });

  it("trains words that contain a weak pair", () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const words = createTrainingSource("english", ["th"], random)(40);
    expect(words.filter((word) => word.includes("th")).length).toBeGreaterThan(20);
  });
});
