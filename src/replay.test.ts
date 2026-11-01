import { describe, expect, it } from "vitest";
import { TypingEngine, wpm } from "./engine";
import { BACKSPACE, CLEAR_WORD, replay, RunRecorder } from "./replay";

const words = ["the", "quick", "fox"];

function typed(text: string, gap = 100): { keys: string[]; gaps: number[] } {
  const keys = [...text];
  return { keys, gaps: keys.map((_, i) => (i === 0 ? 0 : gap)) };
}

describe("replay", () => {
  it("matches the engine on a clean run", () => {
    const result = replay(words, typed("the quick fox"));
    expect(result.finished).toBe(true);
    expect(result.accuracy).toBe(100);
    expect(result.durationMs).toBe(1200);
    expect(result.wpm).toBeCloseTo(wpm(13, 1200));
  });

  it("finishes on a space when the last word is wrong", () => {
    const result = replay(words, typed("the quick fix "));
    expect(result.finished).toBe(true);
    expect(result.accuracy).toBeLessThan(100);
  });

  it("does not finish a run that stops early", () => {
    expect(replay(words, typed("the quick fo")).finished).toBe(false);
  });

  it("rejects keys after the end", () => {
    expect(replay(words, typed("the quick fox!")).finished).toBe(false);
  });

  it("applies backspace and clear word like the app", () => {
    const keys = [..."thx", BACKSPACE, ..."e quikc", CLEAR_WORD, ..."quick fox"];
    const log = { keys, gaps: keys.map(() => 50) };
    const engine = new TypingEngine(words);
    for (const key of keys) {
      if (key === BACKSPACE) engine.backspace();
      else if (key === CLEAR_WORD) engine.backspace(true);
      else if (key === " ") engine.space();
      else engine.insert(key);
    }
    const result = replay(words, log);
    expect(result.finished).toBe(true);
    expect(result.accuracy).toBe(engine.accuracy);
  });

  it("treats an empty log as unfinished", () => {
    expect(replay(words, { keys: [], gaps: [] }).finished).toBe(false);
  });
});

describe("RunRecorder", () => {
  it("records gaps between keys and starts at zero", () => {
    const recorder = new RunRecorder();
    recorder.record("a", 1000);
    recorder.record("b", 1120.4);
    expect(recorder.log).toEqual({ keys: ["a", "b"], gaps: [0, 120] });
    recorder.reset();
    expect(recorder.log.keys).toEqual([]);
  });
});
