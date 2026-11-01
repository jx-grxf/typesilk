export type DayStat = { words: number; runs: number; ms: number; best: number };
export type Days = Record<string, DayStat>;
export type RunActivity = { chars: number; ms: number; wpm: number };

const MAX_RAW_WPM = 320;
const MIN_KEYS_FOR_RHYTHM = 40;
// people never hold a rhythm this even; scripts and autotypers do
const MIN_GAP_SPREAD_MS = 7;

/** Runs a script could have typed don't count. The server will apply the same rules to public profiles. */
export function plausible(gaps: number[], rawWpm: number): boolean {
  if (rawWpm > MAX_RAW_WPM) return false;
  const timed = gaps.filter((gap) => gap > 0 && gap < 1500);
  if (timed.length < MIN_KEYS_FOR_RHYTHM) return true;
  const mean = timed.reduce((a, b) => a + b, 0) / timed.length;
  const spread = Math.sqrt(timed.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / timed.length);
  return spread >= MIN_GAP_SPREAD_MS;
}

export function recordDay(days: Days, day: string, run: RunActivity): void {
  const stat = (days[day] ??= { words: 0, runs: 0, ms: 0, best: 0 });
  stat.words += Math.round(run.chars / 5);
  stat.runs++;
  stat.ms += run.ms;
  stat.best = Math.max(stat.best, Math.round(run.wpm));
}

const pad = (n: number): string => String(n).padStart(2, "0");
export const dayKey = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export type Cell = { date: Date; key: string; stat: DayStat | null; level: number };

/** 53 weeks of cells ending today, weeks starting on Monday, with a 0–4 shade from the year's own spread. */
export function yearGrid(days: Days, today = new Date()): Cell[][] {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - 52 * 7 - ((end.getDay() + 6) % 7));
  const values = Object.entries(days)
    .filter(([key]) => key >= dayKey(start) && key <= dayKey(end))
    .map(([, stat]) => stat.words)
    .filter((words) => words > 0)
    .sort((a, b) => a - b);
  const quantile = (q: number): number => values[Math.floor(q * (values.length - 1))] ?? 0;
  const steps = [quantile(0.25), quantile(0.5), quantile(0.75)];
  const weeks: Cell[][] = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    if ((date.getDay() + 6) % 7 === 0 || weeks.length === 0) weeks.push([]);
    const key = dayKey(date);
    const stat = days[key] ?? null;
    const words = stat?.words ?? 0;
    const level = words === 0 ? 0 : 1 + steps.filter((step) => words > step).length;
    weeks[weeks.length - 1]!.push({ date: new Date(date), key, stat, level });
  }
  return weeks;
}

export function summary(days: Days, today = new Date()): { words: number; active: number; longest: number } {
  const cells = yearGrid(days, today).flat();
  let longest = 0;
  let run = 0;
  for (const cell of cells) {
    run = cell.stat ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return {
    words: cells.reduce((sum, cell) => sum + (cell.stat?.words ?? 0), 0),
    active: cells.filter((cell) => cell.stat).length,
    longest,
  };
}
