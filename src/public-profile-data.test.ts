import { describe, expect, it } from "vitest";
import { applyRun, emptyProfile } from "./profile";
import { toPublic } from "./public-profile-data";
import { recordKey } from "./training";

describe("toPublic", () => {
  it("leaves out key stats, run times and best-run series", () => {
    const profile = emptyProfile();
    applyRun(profile, { key: "time:30:english::", wpm: 90, accuracy: 97, chars: 300, series: [10, 20, 30], countsForRecord: true }, "2026-11-02", 1_700_000_000_000);
    recordKey(profile.keys, "e", true, 120);
    const shown = toPublic(profile, "jx-grxf", "Johannes");
    expect(Object.keys(shown).sort()).toEqual(["badges", "bests", "days", "displayName", "lastDay", "level", "recent", "streakDays", "tests", "username", "words"]);
    expect(shown.bests["time:30:english::"]).toEqual({ wpm: 90, accuracy: 97 });
    expect(shown.recent).toEqual([90]);
    expect(JSON.stringify(shown)).not.toContain("1700000000000");
  });
});
