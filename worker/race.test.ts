import { describe, expect, it } from "vitest";
import { isRaceSetup, maxChars, RACE_CODE, raceWords } from "../src/race-protocol";
import { newRaceCode } from "./race";

describe("race rooms", () => {
  it("hands out codes people can read out", () => {
    for (let i = 0; i < 200; i++) expect(newRaceCode()).toMatch(RACE_CODE);
  });

  it("draws the same words on both sides from the seed", () => {
    const setup = { language: "german", words: 50 } as const;
    expect(raceWords(123, setup)).toEqual(raceWords(123, setup));
    expect(raceWords(123, setup)).toHaveLength(50);
    expect(raceWords(124, setup)).not.toEqual(raceWords(123, setup));
  });

  it("bounds progress by letters and spaces", () => {
    expect(maxChars(["to", "be"])).toBe(6);
  });

  it.each([
    [{ language: "english", words: 25 }, true],
    [{ language: "klingon", words: 25 }, false],
    [{ language: "english", words: 26 }, false],
    [{ language: "__proto__", words: 25 }, false],
    [null, false],
  ])("checks the setup %j", (setup, ok) => {
    expect(isRaceSetup(setup)).toBe(ok);
  });
});
