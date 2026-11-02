import type { Days } from "./activity";
import type { Dailies } from "./daily";
import type { HistoryEntry, KeyStats } from "./training";

const MIN_CHARS_FOR_RECORD = 10;
const HISTORY_LIMIT = 400;

export type Best = { wpm: number; accuracy: number; series: number[] };

export type Profile = {
  xp: number;
  tests: number;
  totalChars: number;
  streakDays: number;
  lastDay: string | null;
  bests: Record<string, Best>;
  keys: KeyStats;
  /** Two-letter pairs inside words, keyed like "th". */
  pairs: KeyStats;
  history: HistoryEntry[];
  /** Activity per local day, only from runs that look like a person typed them. */
  days: Days;
  dailies: Dailies;
  /** Badge id to the day it was earned. */
  badges: Record<string, string>;
  quotes: number;
  /** Languages with a finished run of 30 seconds or more. */
  languages: string[];
  /** Missed days a freeze carried the streak over, at most one per week. */
  frozen: string[];
  /** Races against someone else: finished, won, and the closest win in milliseconds. */
  races: RaceStats;
};

export type RaceStats = { played: number; won: number; closest: number | null };

export type RunResult = {
  key: string;
  wpm: number;
  accuracy: number;
  chars: number;
  series: number[];
  countsForRecord: boolean;
};

export type RunReward = {
  isBest: boolean;
  recorded: boolean;
  previousBest: number | null;
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  /** A freeze covered the day before this one. */
  froze: boolean;
};

export function emptyProfile(): Profile {
  return { xp: 0, tests: 0, totalChars: 0, streakDays: 0, lastDay: null, bests: {}, keys: {}, pairs: {}, history: [], days: {}, dailies: {}, badges: {}, quotes: 0, languages: [], frozen: [], races: { played: 0, won: 0, closest: null } };
}

/** Counts a finished race; `marginMs` is how far ahead a win was, null when there was no one to beat. */
export function recordRace(profile: Profile, won: boolean, marginMs: number | null): void {
  profile.races.played++;
  if (!won) return;
  profile.races.won++;
  if (marginMs !== null && (profile.races.closest === null || marginMs < profile.races.closest)) profile.races.closest = marginMs;
}

export function levelOf(xp: number): number {
  return Math.floor((xp / 40) ** (1 / 1.6)) + 1;
}

function xpForLevel(level: number): number {
  return 40 * (level - 1) ** 1.6;
}

/** Share of the current level already earned, 0 to 1. */
export function levelProgress(xp: number): number {
  const level = levelOf(xp);
  const start = xpForLevel(level);
  return (xp - start) / (xpForLevel(level + 1) - start);
}

export function dayNumber(day: string): number {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86400000;
}

const MAX_FROZEN = 60;

/** Monday of the week a day falls in; day 0, 1 January 1970, was a Thursday. */
export const weekOf = (day: number): number => day - ((day + 3) % 7);

/** The missed yesterday a freeze would cover if you type today, or null when there is none to use. */
export function pendingFreeze(profile: Profile, today: string): string | null {
  if (profile.lastDay === null || profile.streakDays === 0) return null;
  const missed = dayNumber(today) - 1;
  if (missed - dayNumber(profile.lastDay) !== 1) return null;
  if (profile.frozen.some((day) => weekOf(dayNumber(day)) === weekOf(missed))) return null;
  return new Date(missed * 86400000).toISOString().slice(0, 10);
}

export function nextStreak(profile: Profile, today: string): number {
  if (profile.lastDay === null) return 1;
  const gap = dayNumber(today) - dayNumber(profile.lastDay);
  if (gap === 0) return profile.streakDays;
  return gap === 1 || pendingFreeze(profile, today) ? profile.streakDays + 1 : 1;
}

export function localDay(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Updates the profile in place. Records need a finished run; xp is earned either way. */
export function applyRun(profile: Profile, run: RunResult, today: string, now = Date.now()): RunReward {
  const levelBefore = levelOf(profile.xp);
  const previous = profile.bests[run.key];
  const previousBest = previous?.wpm ?? null;
  const isBest =
    run.countsForRecord &&
    run.chars >= MIN_CHARS_FOR_RECORD &&
    (previousBest === null || run.wpm > previousBest);

  if (isBest) {
    profile.bests[run.key] = { wpm: run.wpm, accuracy: run.accuracy, series: run.series };
  }

  const firstRunToday = profile.lastDay !== today;
  const xpGained = Math.round(
    run.chars * (run.accuracy / 100) ** 2 * 0.2 + (isBest ? 25 : 0) + (firstRunToday ? 20 : 0),
  );
  const freeze = pendingFreeze(profile, today);
  profile.streakDays = nextStreak(profile, today);
  if (freeze) profile.frozen = [...profile.frozen, freeze].slice(-MAX_FROZEN);
  profile.lastDay = today;
  profile.xp += xpGained;
  profile.tests++;
  profile.totalChars += run.chars;
  if (run.countsForRecord && run.chars >= MIN_CHARS_FOR_RECORD) {
    profile.history.push({ key: run.key, wpm: run.wpm, at: now });
    if (profile.history.length > HISTORY_LIMIT) profile.history.shift();
  }

  return {
    // the first run in a mode only sets the mark, it isn't a beaten record yet
    isBest: isBest && previousBest !== null,
    recorded: isBest,
    previousBest,
    xpGained,
    levelBefore,
    levelAfter: levelOf(profile.xp),
    froze: freeze !== null,
  };
}
