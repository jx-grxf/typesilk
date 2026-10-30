export type KeyStat = { hits: number; misses: number; time: number; timed: number };
export type KeyStats = Record<string, KeyStat>;

const MIN_SAMPLES = 12;
const MAX_GAP_MS = 1500;
const LETTER = /^\p{L}$/u;

export function recordKey(stats: KeyStats, expected: string, correct: boolean, gapMs: number | null): void {
  const key = expected.toLowerCase();
  if (!LETTER.test(key)) return;
  const stat = (stats[key] ??= { hits: 0, misses: 0, time: 0, timed: 0 });
  if (correct) stat.hits++;
  else stat.misses++;
  if (correct && gapMs !== null && gapMs < MAX_GAP_MS) {
    stat.time += gapMs;
    stat.timed++;
  }
}

/** Letters ranked by how much they hold you back. Errors weigh more than hesitation. */
export function weakKeys(stats: KeyStats, count = 4): string[] {
  const entries = Object.entries(stats).filter(([, s]) => s.hits + s.misses >= MIN_SAMPLES);
  if (entries.length === 0) return [];
  const timed = entries.filter(([, s]) => s.timed > 0);
  const averageGap = timed.reduce((sum, [, s]) => sum + s.time / s.timed, 0) / Math.max(timed.length, 1);
  return entries
    .map(([key, s]) => {
      const missRate = s.misses / (s.hits + s.misses);
      const slowness = s.timed > 0 ? s.time / s.timed / averageGap - 1 : 0;
      return { key, score: missRate * 4 + Math.max(slowness, 0) };
    })
    .filter((entry) => entry.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((entry) => entry.key);
}

export type HistoryEntry = { key: string; wpm: number };

/** Average of the last few runs against the few before; null until there's enough to compare. */
export function trend(history: HistoryEntry[], key: string, size = 5): number | null {
  const runs = history.filter((entry) => entry.key === key).map((entry) => entry.wpm);
  if (runs.length < size * 2) return null;
  const average = (list: number[]): number => list.reduce((a, b) => a + b, 0) / list.length;
  return average(runs.slice(-size)) - average(runs.slice(-size * 2, -size));
}
