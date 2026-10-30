import type { HistoryEntry, KeyStats } from "./training";

const KEY = "typesilk.profile";
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
  history: HistoryEntry[];
};

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
};

export function emptyProfile(): Profile {
  return { xp: 0, tests: 0, totalChars: 0, streakDays: 0, lastDay: null, bests: {}, keys: {}, history: [] };
}

export function loadProfile(): Profile {
  try {
    return { ...emptyProfile(), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile: Profile): void {
  localStorage.setItem(KEY, JSON.stringify(profile));
}

export function clearProfile(): void {
  localStorage.removeItem(KEY);
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

function dayNumber(day: string): number {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date) / 86400000;
}

export function nextStreak(profile: Profile, today: string): number {
  if (profile.lastDay === null) return 1;
  const gap = dayNumber(today) - dayNumber(profile.lastDay);
  if (gap === 0) return profile.streakDays;
  return gap === 1 ? profile.streakDays + 1 : 1;
}

export function localDay(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Updates the profile in place. Records need a finished run; xp is earned either way. */
export function applyRun(profile: Profile, run: RunResult, today: string): RunReward {
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
  profile.streakDays = nextStreak(profile, today);
  profile.lastDay = today;
  profile.xp += xpGained;
  profile.tests++;
  profile.totalChars += run.chars;
  if (run.countsForRecord && run.chars >= MIN_CHARS_FOR_RECORD) {
    profile.history.push({ key: run.key, wpm: run.wpm });
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
  };
}
