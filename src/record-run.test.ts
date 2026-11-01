import { describe, expect, it } from "vitest";
import { emptyProfile } from "./profile";
import { recordRun, type FinishedRun } from "./record-run";

const human = Array.from({ length: 60 }, (_, i) => 90 + (i % 7) * 15);

const run = (overrides: Partial<FinishedRun> = {}): FinishedRun => ({
  key: "time:30:english::",
  mode: "time",
  language: "english",
  daily: null,
  wpm: 70,
  rawWpm: 75,
  accuracy: 97,
  chars: 175,
  durationMs: 30000,
  samples: [5, 10],
  series: [60, 70],
  gaps: human,
  words: 35,
  failed: false,
  quoteLength: null,
  ...overrides,
});

describe("recordRun", () => {
  it("counts a normal run everywhere", () => {
    const profile = emptyProfile();
    const outcome = recordRun(profile, run(), "2026-11-01");
    expect(outcome.firstToday).toBe(true);
    expect(profile.tests).toBe(1);
    expect(profile.days["2026-11-01"]?.runs).toBe(1);
    expect(profile.languages).toEqual(["english"]);
    expect(outcome.badges.map((badge) => badge.id)).toContain("first-words");
    expect(outcome.daily).toBeNull();
  });

  it("keeps only the first finished daily and never makes it a record", () => {
    const profile = emptyProfile();
    const first = recordRun(profile, run({ mode: "daily", daily: 3, wpm: 60 }), "2026-11-03");
    const second = recordRun(profile, run({ mode: "daily", daily: 3, wpm: 90 }), "2026-11-03");
    expect(first.daily).toEqual({ number: 3, first: true, firstWpm: 60 });
    expect(second.daily).toEqual({ number: 3, first: false, firstWpm: 60 });
    expect(profile.bests).toEqual({});
  });

  it("leaves zen and scripted runs off the activity", () => {
    const profile = emptyProfile();
    recordRun(profile, run({ mode: "zen" }), "2026-11-01");
    recordRun(profile, run({ gaps: Array(60).fill(50) }), "2026-11-01");
    expect(profile.days).toEqual({});
    expect(profile.tests).toBe(2);
  });

  it("counts finished quotes", () => {
    const profile = emptyProfile();
    recordRun(profile, run({ mode: "quote", quoteLength: "short" }), "2026-11-01");
    recordRun(profile, run({ mode: "quote", quoteLength: "short", failed: true }), "2026-11-01");
    expect(profile.quotes).toBe(1);
  });
});
