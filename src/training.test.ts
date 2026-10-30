import { describe, expect, it } from "vitest";
import { recordKey, trend, weakKeys, type KeyStats } from "./training";
import { createTrainingSource } from "./words";

function hammer(stats: KeyStats, key: string, hits: number, misses: number, gap = 100): void {
  for (let i = 0; i < hits; i++) recordKey(stats, key, true, gap);
  for (let i = 0; i < misses; i++) recordKey(stats, key, false, null);
}

describe("weakKeys", () => {
  it("needs enough samples", () => {
    const stats: KeyStats = {};
    hammer(stats, "q", 1, 5);
    expect(weakKeys(stats)).toEqual([]);
  });

  it("ranks error-prone letters first and skips flawless average ones", () => {
    const stats: KeyStats = {};
    hammer(stats, "a", 50, 0);
    hammer(stats, "b", 50, 0);
    hammer(stats, "q", 20, 10);
    hammer(stats, "z", 20, 2);
    expect(weakKeys(stats)).toEqual(["q", "z"]);
  });

  it("flags slow letters even without errors", () => {
    const stats: KeyStats = {};
    hammer(stats, "a", 50, 0, 100);
    hammer(stats, "b", 50, 0, 100);
    hammer(stats, "ü", 50, 0, 400);
    expect(weakKeys(stats)[0]).toBe("ü");
  });

  it("merges case and ignores anything that isn't a letter", () => {
    const stats: KeyStats = {};
    recordKey(stats, "Ä", true, 100);
    recordKey(stats, "ä", false, null);
    recordKey(stats, ",", false, null);
    recordKey(stats, "7", false, null);
    expect(Object.keys(stats)).toEqual(["ä"]);
    expect(stats["ä"]).toMatchObject({ hits: 1, misses: 1 });
  });
});

describe("trend", () => {
  it("waits for enough runs and compares only the same setup", () => {
    const runs = (key: string, list: number[]) => list.map((wpm) => ({ key, wpm }));
    expect(trend(runs("a", [1, 2, 3]), "a")).toBeNull();
    const history = [...runs("a", [50, 50, 50, 50, 50]), ...runs("b", [999]), ...runs("a", [60, 60, 60, 60, 60])];
    expect(trend(history, "a")).toBe(10);
  });
});

describe("createTrainingSource", () => {
  it("serves mostly words with the weak letters", () => {
    const words = createTrainingSource("german", ["ü", "ß"])(200);
    const share = words.filter((word) => /[üß]/i.test(word)).length / words.length;
    expect(share).toBeGreaterThan(0.5);
  });

  it("falls back to normal words without weak letters", () => {
    expect(createTrainingSource("english", [])(50)).toHaveLength(50);
    expect(createTrainingSource("english", ["ж"])(50)).toHaveLength(50);
  });
});
