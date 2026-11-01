import { MIN_RATE_MS, TypingEngine, wpm } from "./engine";

export const BACKSPACE = "\b";
export const CLEAR_WORD = "\b\b";

/** One entry per key, with the milliseconds since the key before it. The first gap is 0. */
export type RunLog = { keys: string[]; gaps: number[] };

export type ReplayResult = {
  /** The log reached the end of the text on its last key, the way a real run ends. */
  finished: boolean;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  durationMs: number;
};

/** Feeds a log through the same engine the app types into. The server trusts only this. */
export function replay(words: string[], log: RunLog): ReplayResult {
  const engine = new TypingEngine(words);
  let durationMs = 0;
  let done = false;
  let keysAfterEnd = false;
  for (let i = 0; i < log.keys.length; i++) {
    if (done) {
      keysAfterEnd = true;
      break;
    }
    const key = log.keys[i]!;
    durationMs += log.gaps[i] ?? 0;
    if (key === " ") {
      if (engine.space().kind === "commit" && engine.wordIndex >= engine.words.length) done = true;
    } else if (key === BACKSPACE) {
      engine.backspace();
    } else if (key === CLEAR_WORD) {
      engine.backspace(true);
    } else if (engine.insert(key).kind === "char" && engine.lastWordDone) {
      done = true;
    }
  }
  const rateMs = Math.max(durationMs, MIN_RATE_MS);
  return {
    finished: done && !keysAfterEnd,
    wpm: wpm(engine.correctChars, rateMs),
    rawWpm: wpm(engine.totalKeys, rateMs),
    accuracy: engine.accuracy,
    durationMs,
  };
}

/** Records what the app's key handlers pass to the engine. */
export class RunRecorder {
  private keys: string[] = [];
  private gaps: number[] = [];
  private lastAt = 0;

  reset(): void {
    this.keys = [];
    this.gaps = [];
    this.lastAt = 0;
  }

  record(key: string, now: number): void {
    this.gaps.push(this.keys.length === 0 ? 0 : Math.round(now - this.lastAt));
    this.keys.push(key);
    this.lastAt = now;
  }

  get log(): RunLog {
    return { keys: this.keys, gaps: this.gaps };
  }
}
