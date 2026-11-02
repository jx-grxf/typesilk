import { describe, expect, it } from "vitest";
import { applyRun, emptyProfile, levelOf, levelProgress, nextStreak, pendingFreeze, type RunResult } from "./profile";
import { createWordSource } from "./words";

const run = (wpm: number, overrides: Partial<RunResult> = {}): RunResult => ({
  key: "time:30",
  wpm,
  accuracy: 100,
  chars: 200,
  series: [10, 20],
  countsForRecord: true,
  ...overrides,
});

describe("applyRun", () => {
  it("stores the first run without calling it a beaten record", () => {
    const profile = emptyProfile();
    const reward = applyRun(profile, run(80), "2026-10-30");
    expect(reward.isBest).toBe(false);
    expect(profile.bests["time:30"]?.wpm).toBe(80);
  });

  it("celebrates only a faster run", () => {
    const profile = emptyProfile();
    applyRun(profile, run(80), "2026-10-30");
    expect(applyRun(profile, run(70), "2026-10-30").isBest).toBe(false);
    const reward = applyRun(profile, run(90), "2026-10-30");
    expect(reward).toMatchObject({ isBest: true, previousBest: 80 });
  });

  it("never records a failed run or a tiny one", () => {
    const profile = emptyProfile();
    applyRun(profile, run(999, { countsForRecord: false }), "2026-10-30");
    applyRun(profile, run(999, { chars: 3 }), "2026-10-30");
    expect(profile.bests).toEqual({});
  });

  it("gives the daily bonus once", () => {
    const profile = emptyProfile();
    applyRun(profile, run(100), "2026-10-29");
    const first = applyRun(profile, run(5), "2026-10-30").xpGained;
    const second = applyRun(profile, run(5), "2026-10-30").xpGained;
    expect(first - second).toBe(20);
  });
});

describe("nextStreak", () => {
  const withDay = (lastDay: string, streakDays: number) => ({ ...emptyProfile(), lastDay, streakDays });

  it("handles same day, next day, gaps and month ends", () => {
    expect(nextStreak(emptyProfile(), "2026-10-30")).toBe(1);
    expect(nextStreak(withDay("2026-10-30", 4), "2026-10-30")).toBe(4);
    expect(nextStreak(withDay("2026-10-30", 4), "2026-10-31")).toBe(5);
    expect(nextStreak(withDay("2026-10-31", 4), "2026-11-01")).toBe(5);
    expect(nextStreak(withDay("2026-10-28", 4), "2026-10-30")).toBe(5);
    expect(nextStreak(withDay("2026-10-27", 4), "2026-10-30")).toBe(1);
  });
});

describe("levels", () => {
  it("start at one and progress stays in range", () => {
    expect(levelOf(0)).toBe(1);
    for (const xp of [0, 39, 40, 41, 500, 12345]) {
      const progress = levelProgress(xp);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThan(1);
    }
    expect(levelOf(5000)).toBeGreaterThan(levelOf(500));
  });
});

describe("createWordSource", () => {
  it("never repeats a word within its recent window", () => {
    const words = createWordSource("german")(300);
    for (let i = 1; i < words.length; i++) {
      expect(words.slice(Math.max(0, i - 12), i)).not.toContain(words[i]);
    }
  });

  it("adds numbers and punctuation only on request", () => {
    expect(createWordSource("english")(300).join(" ")).not.toMatch(/[0-9.,]/);
    const rich = createWordSource("english", { punctuation: true, numbers: true })(300).join(" ");
    expect(rich).toMatch(/[0-9]/);
    expect(rich).toMatch(/[.,]/);
    expect(rich).toMatch(/^[A-Z0-9]/);
  });
});

describe("streak freeze", () => {
  const typedOn = (days: string[]) => {
    const profile = emptyProfile();
    const rewards = days.map((day) => applyRun(profile, run(80), day));
    return { profile, rewards };
  };

  it("carries the streak over one missed day", () => {
    const { profile, rewards } = typedOn(["2026-11-02", "2026-11-03", "2026-11-05"]);
    expect(profile.streakDays).toBe(3);
    expect(profile.frozen).toEqual(["2026-11-04"]);
    expect(rewards.at(-1)?.froze).toBe(true);
  });

  it("allows one freeze per week", () => {
    const { profile } = typedOn(["2026-11-02", "2026-11-04", "2026-11-06"]);
    expect(profile.streakDays).toBe(1);
    expect(profile.frozen).toEqual(["2026-11-03"]);
  });

  it("allows a new freeze in the next week", () => {
    const { profile } = typedOn(["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-10"]);
    expect(profile.streakDays).toBe(7);
    expect(profile.frozen).toEqual(["2026-11-03", "2026-11-09"]);
  });

  it("does not cover two missed days", () => {
    const { profile } = typedOn(["2026-11-02", "2026-11-05"]);
    expect(profile.streakDays).toBe(1);
    expect(profile.frozen).toEqual([]);
  });

  it("has nothing to hold when there was no streak", () => {
    expect(pendingFreeze(emptyProfile(), "2026-11-05")).toBeNull();
  });
});

