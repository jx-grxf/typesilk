import { describe, expect, it } from "vitest";
import { keyHeat } from "./heatmap";
import { recordKey, type KeyStats } from "./training";

function hits(stats: KeyStats, key: string, ok: number, bad: number): void {
  for (let i = 0; i < ok; i++) recordKey(stats, key, true, 120);
  for (let i = 0; i < bad; i++) recordKey(stats, key, false, null);
}

describe("keyHeat", () => {
  it("scales heat to the worst key and leaves sparse keys cold", () => {
    const stats: KeyStats = {};
    hits(stats, "a", 18, 2);
    hits(stats, "s", 15, 5);
    hits(stats, "q", 1, 1);
    const flat = keyHeat(stats, "english").flat();
    expect(flat.find((k) => k.key === "s")!.heat).toBe(1);
    expect(flat.find((k) => k.key === "a")!.heat).toBeCloseTo(0.4);
    expect(flat.find((k) => k.key === "q")!.heat).toBe(0);
  });

  it("folds accented letters into their base key on layouts without them", () => {
    const stats: KeyStats = {};
    hits(stats, "é", 4, 2);
    hits(stats, "e", 4, 0);
    const e = keyHeat(stats, "spanish").flat().find((k) => k.key === "e")!;
    expect(e.samples).toBe(10);
  });

  it("keeps umlauts as their own keys on the German layout", () => {
    const stats: KeyStats = {};
    hits(stats, "ü", 10, 0);
    const keys = keyHeat(stats, "german").flat();
    expect(keys.find((k) => k.key === "ü")!.samples).toBe(10);
    expect(keys.find((k) => k.key === "u")!.samples).toBe(0);
  });
});
