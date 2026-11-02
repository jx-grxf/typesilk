import { describe, expect, it } from "vitest";
import { BACKSPACE } from "./replay";
import { reachedWords } from "./run-replay";

describe("reachedWords", () => {
  it("keeps the words the run got to", () => {
    const log = { keys: [..."the", " ", "o", "x", BACKSPACE, "f"], gaps: [0, 90, 90, 90, 90, 90, 90, 90] };
    expect(reachedWords(["the", "of", "and", "to"], log)).toEqual(["the", "of"]);
  });

  it("stops at the end of the text", () => {
    const log = { keys: [..."to", " ", ..."be"], gaps: [0, 90, 90, 90, 90] };
    expect(reachedWords(["to", "be"], log)).toEqual(["to", "be"]);
  });
});
