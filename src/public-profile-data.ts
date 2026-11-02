import type { DayStat } from "./activity";
import { levelOf, type Profile } from "./profile";

/** What a public profile shows: totals, records and badges, never key stats, history times or devices. */
export type PublicProfile = {
  username: string;
  displayName: string | null;
  level: number;
  tests: number;
  words: number;
  streakDays: number;
  lastDay: string | null;
  badges: Record<string, string>;
  bests: Record<string, { wpm: number; accuracy: number }>;
  days: Record<string, DayStat>;
  /** Words per minute of the latest runs, oldest first. */
  recent: number[];
};

const RECENT = 60;

export function toPublic(profile: Profile, username: string, displayName: string | null): PublicProfile {
  const bests: PublicProfile["bests"] = {};
  for (const [key, best] of Object.entries(profile.bests)) bests[key] = { wpm: best.wpm, accuracy: best.accuracy };
  return {
    username,
    displayName,
    level: levelOf(profile.xp),
    tests: profile.tests,
    words: Math.round(profile.totalChars / 5),
    streakDays: profile.streakDays,
    lastDay: profile.lastDay,
    badges: profile.badges,
    bests,
    days: profile.days,
    recent: profile.history.slice(-RECENT).map((entry) => entry.wpm),
  };
}
