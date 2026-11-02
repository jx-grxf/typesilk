import { plausible, recordDay } from "./activity";
import { awardBadges, type Badge } from "./badges";
import { dailyKey } from "./daily";
import { consistency } from "./engine";
import { applyRun, localDay, type Profile, type RunReward } from "./profile";
import type { Mode } from "./settings";
import type { Language } from "./words";

export type FinishedRun = {
  key: string;
  mode: Mode;
  language: Language;
  daily: number | null;
  wpm: number;
  /** Every key pressed, right or wrong; scripts give themselves away here first. */
  rawWpm: number;
  accuracy: number;
  chars: number;
  durationMs: number;
  /** Correct characters at each whole second, for the ghost of a new best. */
  samples: number[];
  series: number[];
  gaps: number[];
  words: number;
  failed: boolean;
  quoteLength: string | null;
  backspaces: number;
  /** The site's own name typed as a word somewhere in the run. */
  saidName: boolean;
};

export type RunOutcome = {
  reward: RunReward;
  badges: Badge[];
  firstToday: boolean;
  daily: { number: number; first: boolean; firstWpm: number | null } | null;
};

/** Everything a finished run changes on the profile: records, xp, activity, dailies and badges. */
export function recordRun(profile: Profile, run: FinishedRun, today = localDay()): RunOutcome {
  const firstToday = profile.lastDay !== today;
  const entry = run.daily === null ? null : dailyKey(run.daily, run.language);
  const firstDaily = entry !== null && !profile.dailies[entry] && !run.failed;
  if (entry !== null && firstDaily) profile.dailies[entry] = { wpm: run.wpm, accuracy: run.accuracy };

  const reward = applyRun(
    profile,
    {
      key: run.key,
      wpm: run.wpm,
      accuracy: run.accuracy,
      chars: run.chars,
      series: run.samples,
      countsForRecord: !run.failed && run.durationMs >= 5000 && run.mode !== "zen" && run.mode !== "custom" && run.mode !== "daily",
    },
    today,
  );
  const human = plausible(run.gaps, run.rawWpm);
  // zen has no target text, so anything typed there would count
  if (run.mode !== "zen" && human) recordDay(profile.days, today, { chars: run.chars, ms: run.durationMs, wpm: run.wpm });

  const finished = !run.failed && run.mode !== "zen" && run.mode !== "custom";
  if (finished && run.mode === "quote") profile.quotes++;
  if (finished && run.durationMs >= 30000 && !profile.languages.includes(run.language)) profile.languages.push(run.language);

  const badges = awardBadges(profile, human
    ? {
      mode: run.mode,
      seconds: run.durationMs / 1000,
      wpm: run.wpm,
      accuracy: run.accuracy,
      consistency: consistency(run.series),
      words: run.words,
      finished: !run.failed,
      quoteLength: run.quoteLength,
      language: run.language,
      backspaces: run.backspaces,
      saidName: run.saidName,
      firstToday,
      newBest: reward.isBest,
    }
    : null);

  return {
    reward,
    badges,
    firstToday,
    daily: run.daily === null ? null : { number: run.daily, first: firstDaily, firstWpm: profile.dailies[entry!]?.wpm ?? null },
  };
}
