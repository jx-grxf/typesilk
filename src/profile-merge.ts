import type { DayStat, Days } from "./activity";
import type { DailyResult, Dailies } from "./daily";
import { dayNumber, emptyProfile, type Best, type Profile } from "./profile";
import type { HistoryEntry, KeyStat, KeyStats } from "./training";

// Every device keeps its own share of the profile and the account shows the sum of all shares.
// Sums only ever grow, so a share can be taken back out of a merged profile exactly.

const HISTORY_LIMIT = 400;
const MAX_BESTS = 300;
const MAX_SERIES = 600;
const MAX_KEYS = 200;
const MAX_PAIRS = 800;
const MAX_DAYS = 1100;
const MAX_DAILIES = 4000;
const MAX_BADGES = 100;
const MAX_LANGUAGES = 8;
const MAX_STREAK = 4000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RECORD_KEY = /^[a-z0-9:]{1,64}$/;
const DAILY_KEY = /^\d{1,6}:[a-z]{1,16}$/;
const BADGE_ID = /^[a-z0-9-]{1,40}$/;
const LANGUAGE = /^[a-z]{1,16}$/;
const LETTER = /^\p{L}$/u;
const PAIR = /^\p{L}{2}$/u;

const historyId = (entry: HistoryEntry): string => `${entry.key}|${entry.wpm}|${entry.at ?? ""}`;

function sumKeys(target: KeyStats, source: KeyStats, sign: 1 | -1): void {
  for (const [key, stat] of Object.entries(source)) {
    const into = (target[key] ??= { hits: 0, misses: 0, time: 0, timed: 0 });
    into.hits = Math.max(0, into.hits + sign * stat.hits);
    into.misses = Math.max(0, into.misses + sign * stat.misses);
    into.time = Math.max(0, into.time + sign * stat.time);
    into.timed = Math.max(0, into.timed + sign * stat.timed);
    if (into.hits + into.misses === 0) delete target[key];
  }
}

function sumDays(target: Days, source: Days, sign: 1 | -1): void {
  for (const [day, stat] of Object.entries(source)) {
    const into = (target[day] ??= { words: 0, runs: 0, ms: 0, best: 0 });
    into.words = Math.max(0, into.words + sign * stat.words);
    into.runs = Math.max(0, into.runs + sign * stat.runs);
    into.ms = Math.max(0, into.ms + sign * stat.ms);
    if (sign === 1) into.best = Math.max(into.best, stat.best);
    if (into.runs === 0) delete target[day];
  }
}

/** Days typed in a row up to the latest day any share has seen. */
function mergedStreak(profiles: Profile[], days: Days, lastDay: string): number {
  const active = new Set(Object.keys(days).map(dayNumber));
  for (const profile of profiles) {
    if (!profile.lastDay) continue;
    const end = dayNumber(profile.lastDay);
    for (let i = 0; i < Math.min(profile.streakDays, MAX_STREAK); i++) active.add(end - i);
  }
  let streak = 0;
  for (let day = dayNumber(lastDay); active.has(day); day--) streak++;
  return streak;
}

export function mergeProfiles(profiles: Profile[]): Profile {
  const merged = emptyProfile();
  const history: HistoryEntry[] = [];
  for (const profile of profiles) {
    merged.xp += profile.xp;
    merged.tests += profile.tests;
    merged.totalChars += profile.totalChars;
    merged.quotes += profile.quotes;
    for (const [key, best] of Object.entries(profile.bests)) {
      if (!merged.bests[key] || best.wpm > merged.bests[key].wpm) merged.bests[key] = best;
    }
    sumKeys(merged.keys, profile.keys, 1);
    sumKeys(merged.pairs, profile.pairs, 1);
    sumDays(merged.days, profile.days, 1);
    for (const [key, result] of Object.entries(profile.dailies)) merged.dailies[key] ??= result;
    for (const [id, day] of Object.entries(profile.badges)) {
      const known = merged.badges[id];
      if (!known || day < known) merged.badges[id] = day;
    }
    for (const language of profile.languages) {
      if (!merged.languages.includes(language)) merged.languages.push(language);
    }
    if (profile.lastDay && (!merged.lastDay || profile.lastDay > merged.lastDay)) merged.lastDay = profile.lastDay;
    history.push(...profile.history);
  }
  // runs from before sync have no time; the stable sort keeps them in their device's order
  merged.history = history.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-HISTORY_LIMIT);
  merged.streakDays = merged.lastDay ? mergedStreak(profiles, merged.days, merged.lastDay) : 0;
  return merged;
}

/** What is left of `total` once the shares merged into `part` are taken out: this device's own share. */
export function subtractProfile(total: Profile, part: Profile): Profile {
  const own = structuredClone(total);
  own.xp = Math.max(0, total.xp - part.xp);
  own.tests = Math.max(0, total.tests - part.tests);
  own.totalChars = Math.max(0, total.totalChars - part.totalChars);
  own.quotes = Math.max(0, total.quotes - part.quotes);
  sumKeys(own.keys, part.keys, -1);
  sumKeys(own.pairs, part.pairs, -1);
  sumDays(own.days, part.days, -1);
  for (const [key, best] of Object.entries(part.bests)) {
    if (own.bests[key]?.wpm === best.wpm) delete own.bests[key];
  }
  for (const key of Object.keys(part.dailies)) delete own.dailies[key];
  for (const [id, day] of Object.entries(part.badges)) {
    if (own.badges[id] === day) delete own.badges[id];
  }
  const taken = new Map<string, number>();
  for (const entry of part.history) taken.set(historyId(entry), (taken.get(historyId(entry)) ?? 0) + 1);
  own.history = total.history.filter((entry) => {
    const left = taken.get(historyId(entry)) ?? 0;
    if (left === 0) return true;
    taken.set(historyId(entry), left - 1);
    return false;
  });
  return own;
}

const count = (value: unknown, max = 1e12): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : 0;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Keeps entries whose key passes, newest keys last when there are too many. */
function entries(value: unknown, key: RegExp, max: number): [string, Record<string, unknown>][] {
  return Object.entries(record(value))
    .filter(([name]) => key.test(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-max)
    .map(([name, item]) => [name, record(item)]);
}

function cleanBest(item: Record<string, unknown>): Best {
  const series = Array.isArray(item.series) ? item.series.slice(0, MAX_SERIES).map((n) => count(n, 1000)) : [];
  return { wpm: count(item.wpm, 1000), accuracy: count(item.accuracy, 100), series };
}

function cleanKey(item: Record<string, unknown>): KeyStat {
  return { hits: count(item.hits), misses: count(item.misses), time: count(item.time), timed: count(item.timed) };
}

function cleanDay(item: Record<string, unknown>): DayStat {
  return { words: count(item.words), runs: count(item.runs), ms: count(item.ms), best: count(item.best, 1000) };
}

function cleanDaily(item: Record<string, unknown>): DailyResult {
  return { wpm: count(item.wpm, 1000), accuracy: count(item.accuracy, 100) };
}

/** Accepts a profile from the network or from storage; anything that doesn't fit is dropped, not trusted. */
export function sanitizeProfile(value: unknown): Profile {
  const raw = record(value);
  const profile = emptyProfile();
  profile.xp = count(raw.xp);
  profile.tests = count(raw.tests);
  profile.totalChars = count(raw.totalChars);
  profile.quotes = count(raw.quotes);
  profile.streakDays = Math.floor(count(raw.streakDays, MAX_STREAK));
  profile.lastDay = typeof raw.lastDay === "string" && DAY.test(raw.lastDay) ? raw.lastDay : null;
  for (const [key, item] of entries(raw.bests, RECORD_KEY, MAX_BESTS)) profile.bests[key] = cleanBest(item);
  for (const [key, item] of entries(raw.keys, LETTER, MAX_KEYS)) profile.keys[key] = cleanKey(item);
  for (const [key, item] of entries(raw.pairs, PAIR, MAX_PAIRS)) profile.pairs[key] = cleanKey(item);
  for (const [day, item] of entries(raw.days, DAY, MAX_DAYS)) profile.days[day] = cleanDay(item);
  const dailies: Dailies = {};
  for (const [key, item] of entries(raw.dailies, DAILY_KEY, MAX_DAILIES)) dailies[key] = cleanDaily(item);
  profile.dailies = dailies;
  for (const [id, day] of Object.entries(record(raw.badges)).slice(0, MAX_BADGES)) {
    if (BADGE_ID.test(id) && typeof day === "string" && DAY.test(day)) profile.badges[id] = day;
  }
  if (Array.isArray(raw.languages)) {
    profile.languages = [...new Set(raw.languages.filter((l): l is string => typeof l === "string" && LANGUAGE.test(l)))].slice(0, MAX_LANGUAGES);
  }
  if (Array.isArray(raw.history)) {
    profile.history = raw.history.slice(-HISTORY_LIMIT).map(record)
      .filter((entry) => typeof entry.key === "string" && RECORD_KEY.test(entry.key))
      .map((entry) => {
        const clean: HistoryEntry = { key: entry.key as string, wpm: count(entry.wpm, 1000) };
        if (typeof entry.at === "number" && Number.isFinite(entry.at)) clean.at = entry.at;
        return clean;
      });
  }
  return profile;
}
