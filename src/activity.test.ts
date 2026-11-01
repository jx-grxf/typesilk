import { describe, expect, it } from "vitest";
import { dayKey, plausible, recordDay, summary, yearGrid, type Days } from "./activity";

describe("plausible", () => {
  it("accepts a human rhythm and rejects an even, scripted one", () => {
    const human = Array.from({ length: 120 }, (_, i) => 110 + ((i * 37) % 60));
    const script = Array.from({ length: 120 }, () => 60);
    expect(plausible(human, 110)).toBe(true);
    expect(plausible(script, 200)).toBe(false);
  });

  it("rejects speeds no person reaches", () => {
    expect(plausible([], 400)).toBe(false);
  });
});

describe("activity", () => {
  it("adds runs up per day", () => {
    const days: Days = {};
    recordDay(days, "2026-11-01", { chars: 500, ms: 60000, wpm: 100 });
    recordDay(days, "2026-11-01", { chars: 250, ms: 30000, wpm: 120 });
    expect(days["2026-11-01"]).toEqual({ words: 150, runs: 2, ms: 90000, best: 120 });
  });

  it("lays out 53 or 54 weeks that start on Monday and end today", () => {
    const today = new Date(2026, 10, 1);
    const weeks = yearGrid({}, today);
    expect(weeks.length).toBeGreaterThanOrEqual(53);
    expect(weeks[0]![0]!.date.getDay()).toBe(1);
    expect(weeks.at(-1)!.at(-1)!.key).toBe(dayKey(today));
  });

  it("shades days by the year's own spread and counts streaks", () => {
    const today = new Date(2026, 10, 1);
    const days: Days = {
      "2026-10-29": { words: 10, runs: 1, ms: 1, best: 1 },
      "2026-10-30": { words: 100, runs: 1, ms: 1, best: 1 },
      "2026-10-31": { words: 400, runs: 1, ms: 1, best: 1 },
      "2026-11-01": { words: 1000, runs: 1, ms: 1, best: 1 },
    };
    const cells = yearGrid(days, today).flat();
    expect(cells.find((c) => c.key === "2026-10-29")!.level).toBe(1);
    expect(cells.find((c) => c.key === "2026-11-01")!.level).toBe(4);
    expect(summary(days, today)).toEqual({ words: 1510, active: 4, longest: 4 });
  });
});
