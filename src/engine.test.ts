import { describe, expect, it } from "vitest";
import { consistency, MAX_EXTRA, rollingWpm, TypingEngine, wpm } from "./engine";
import { Spring, springEasing } from "./spring";

function type(engine: TypingEngine, text: string): void {
  for (const ch of text) {
    if (ch === " ") engine.space();
    else engine.insert(ch);
  }
}

describe("TypingEngine", () => {
  it("counts correct letters and the spaces of perfect words", () => {
    const engine = new TypingEngine(["hi", "you"]);
    type(engine, "hi yo");
    expect(engine.correctChars).toBe(5);
    expect(engine.accuracy).toBe(100);
  });

  it("does not count the space of a flawed word", () => {
    const engine = new TypingEngine(["hi", "you"]);
    type(engine, "ho ");
    expect(engine.correctChars).toBe(1);
    expect(engine.totalKeys).toBe(3);
    expect(engine.correctKeys).toBe(1);
    expect(engine.streak).toBe(0);
  });

  it("ignores space on an empty word", () => {
    const engine = new TypingEngine(["hi"]);
    expect(engine.space().kind).toBe("ignored");
    expect(engine.wordIndex).toBe(0);
  });

  it("caps extra letters", () => {
    const engine = new TypingEngine(["a"]);
    engine.insert("a");
    for (let i = 0; i < MAX_EXTRA; i++) {
      expect(engine.insert("x")).toMatchObject({ kind: "char", extra: true });
    }
    expect(engine.insert("x").kind).toBe("ignored");
  });

  it("goes back only into flawed words and restores the count", () => {
    const engine = new TypingEngine(["ab", "cd", "ef"]);
    type(engine, "ab cx ");
    expect(engine.correctChars).toBe(4);
    expect(engine.backspace()).toEqual({ kind: "back", wordIndex: 1 });
    expect(engine.input).toBe("cx");
    expect(engine.correctChars).toBe(4);
    engine.backspace();
    engine.backspace();
    expect(engine.backspace()).toEqual({ kind: "ignored" });
    expect(engine.wordIndex).toBe(1);
    expect(engine.correctChars).toBe(3);
  });

  it("clears a whole word", () => {
    const engine = new TypingEngine(["hello"]);
    type(engine, "hel");
    expect(engine.backspace(true)).toEqual({ kind: "clear", wordIndex: 0, previous: "hel" });
    expect(engine.correctChars).toBe(0);
  });

  it("detects the finished last word and handles umlauts", () => {
    const engine = new TypingEngine(["für", "Tür"]);
    type(engine, "für Tü");
    expect(engine.lastWordDone).toBe(false);
    engine.insert("r");
    expect(engine.lastWordDone).toBe(true);
  });

  it("does not type past the end", () => {
    const engine = new TypingEngine(["a"]);
    type(engine, "a ");
    expect(engine.insert("b").kind).toBe("ignored");
    expect(engine.space().kind).toBe("ignored");
  });
});

describe("stats", () => {
  it("computes wpm", () => {
    expect(wpm(50, 60000)).toBe(10);
    expect(wpm(10, 0)).toBe(0);
  });

  it("averages speed over the window", () => {
    expect(rollingWpm([5, 10, 15, 15])).toEqual([60, 60, 60, 40]);
  });

  it("scores consistency", () => {
    expect(consistency([60, 60, 60])).toBe(100);
    expect(consistency([0, 0])).toBe(0);
    expect(consistency([10, 100])).toBeLessThan(40);
  });
});

describe("spring", () => {
  it("reaches its target and keeps velocity across retargets", () => {
    const spring = new Spring(0, 1100, 60);
    spring.target = 100;
    spring.step(0.03);
    const velocity = spring.v;
    expect(velocity).toBeGreaterThan(0);
    spring.target = 200;
    expect(spring.v).toBe(velocity);
    for (let i = 0; i < 60; i++) spring.step(1 / 60);
    expect(spring.settled).toBe(true);
    expect(spring.x).toBeCloseTo(200, 1);
  });

  it("bakes a valid linear() easing that ends at 1", () => {
    const { easing, duration } = springEasing(300, 20);
    expect(easing.startsWith("linear(0,")).toBe(true);
    expect(easing.endsWith(",1)")).toBe(true);
    expect(duration).toBeGreaterThan(100);
  });
});

describe("free mode", () => {
  it("takes whatever is typed as the text and counts it all", () => {
    const engine = new TypingEngine([], true);
    type(engine, "anything goes ");
    expect(engine.words).toEqual(["anything", "goes", ""]);
    expect(engine.correctChars).toBe(14);
    expect(engine.accuracy).toBe(100);
  });

  it("shrinks the word on backspace", () => {
    const engine = new TypingEngine([], true);
    type(engine, "abc");
    expect(engine.backspace()).toMatchObject({ kind: "delete", charIndex: 2, extra: true });
    expect(engine.word).toBe("ab");
    engine.backspace(true);
    expect(engine.word).toBe("");
  });
});
