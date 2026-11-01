import { describe, expect, it } from "vitest";
import { recordDay } from "./activity";
import { applyRun, emptyProfile, type Profile, type RunResult } from "./profile";
import { mergeProfiles, sanitizeProfile, subtractProfile } from "./profile-merge";
import { recordKey } from "./training";

const run = (wpm: number, overrides: Partial<RunResult> = {}): RunResult => ({
  key: "time:30:english::",
  wpm,
  accuracy: 100,
  chars: 200,
  series: [10, 20],
  countsForRecord: true,
  ...overrides,
});

function device(runs: [string, number, number][]): Profile {
  const profile = emptyProfile();
  for (const [day, wpm, at] of runs) {
    applyRun(profile, run(wpm), day, at);
    recordDay(profile.days, day, { chars: 200, ms: 30000, wpm });
    recordKey(profile.keys, "e", true, 120);
  }
  return profile;
}

describe("mergeProfiles", () => {
  it("adds counters and keeps the faster best", () => {
    const chrome = device([["2026-11-01", 93, 1], ["2026-11-01", 80, 3]]);
    const safari = device([["2026-11-01", 86, 2]]);
    const merged = mergeProfiles([chrome, safari]);
    expect(merged.tests).toBe(3);
    expect(merged.xp).toBe(chrome.xp + safari.xp);
    expect(merged.totalChars).toBe(600);
    expect(merged.bests["time:30:english::"]?.wpm).toBe(93);
    expect(merged.days["2026-11-01"]).toEqual({ words: 120, runs: 3, ms: 90000, best: 93 });
    expect(merged.keys.e?.hits).toBe(3);
    expect(merged.history.map((entry) => entry.wpm)).toEqual([93, 86, 80]);
  });

  it("joins streaks that alternate between devices", () => {
    const a = device([["2026-10-30", 60, 1], ["2026-11-01", 60, 3]]);
    const b = device([["2026-10-31", 60, 2]]);
    expect(a.streakDays).toBe(1);
    expect(mergeProfiles([a, b])).toMatchObject({ streakDays: 3, lastDay: "2026-11-01" });
  });

  it("keeps the earliest day a badge was earned and every language once", () => {
    const a = { ...emptyProfile(), badges: { seven: "2026-10-20" }, languages: ["english"] };
    const b = { ...emptyProfile(), badges: { seven: "2026-10-10" }, languages: ["english", "german"] };
    expect(mergeProfiles([a, b])).toMatchObject({ badges: { seven: "2026-10-10" }, languages: ["english", "german"] });
  });
});

describe("subtractProfile", () => {
  it("gives back exactly the own share after more runs", () => {
    const own = device([["2026-11-01", 70, 1]]);
    const others = mergeProfiles([device([["2026-11-01", 90, 2]]), device([["2026-10-31", 50, 0]])]);
    const view = mergeProfiles([own, others]);
    applyRun(view, run(75), "2026-11-01", 5);
    recordDay(view.days, "2026-11-01", { chars: 200, ms: 30000, wpm: 75 });

    const next = subtractProfile(view, others);
    expect(next.tests).toBe(2);
    expect(next.totalChars).toBe(400);
    expect(next.days["2026-11-01"]?.runs).toBe(2);
    expect(next.days["2026-10-31"]).toBeUndefined();
    expect(next.history.map((entry) => entry.wpm)).toEqual([70, 75]);
    expect(mergeProfiles([next, others]).tests).toBe(view.tests);
  });
});

describe("sanitizeProfile", () => {
  it("drops what doesn't fit and keeps the rest", () => {
    const clean = sanitizeProfile({
      xp: -5,
      tests: "7",
      bests: { "time:30:english::": { wpm: 90, accuracy: 98, series: [1, "x"] }, "<script>": { wpm: 1 } },
      keys: { e: { hits: 3, misses: 1, time: 10, timed: 2 }, ab: { hits: 1 } },
      days: { "2026-11-01": { words: 10, runs: 1, ms: 5, best: 90 }, yesterday: {} },
      badges: { seven: "2026-11-01", "__proto__": "2026-11-01" },
      history: [{ key: "time:30:english::", wpm: 90, at: 4 }, { key: 5, wpm: 1 }],
      languages: ["english", "english", 3],
      lastDay: "soon",
    });
    expect(clean.xp).toBe(0);
    expect(clean.tests).toBe(0);
    expect(Object.keys(clean.bests)).toEqual(["time:30:english::"]);
    expect(clean.bests["time:30:english::"]?.series).toEqual([1, 0]);
    expect(Object.keys(clean.keys)).toEqual(["e"]);
    expect(Object.keys(clean.days)).toEqual(["2026-11-01"]);
    expect(Object.getPrototypeOf(clean.badges)).toBe(Object.prototype);
    expect(clean.history).toEqual([{ key: "time:30:english::", wpm: 90, at: 4 }]);
    expect(clean.languages).toEqual(["english"]);
    expect(clean.lastDay).toBeNull();
  });
});
