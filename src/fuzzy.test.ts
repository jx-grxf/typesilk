import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("rejects text that does not contain the query in order", () => {
    expect(fuzzyScore("xyz", "theme paper")).toBeNull();
    expect(fuzzyScore("rpae", "paper")).toBeNull();
  });

  it("prefers matches at word starts and in a row", () => {
    const starts = fuzzyScore("tp", "theme paper")!;
    const inside = fuzzyScore("tp", "settings help")!;
    expect(starts).toBeGreaterThan(inside);
  });
});

describe("fuzzyFilter", () => {
  const items = ["theme noir", "theme paper", "language german", "layout classic"];

  it("keeps the original order for an empty query", () => {
    expect(fuzzyFilter(items, " ", (x) => x)).toEqual(items);
  });

  it("ranks the closest match first", () => {
    expect(fuzzyFilter(items, "pap", (x) => x)[0]).toBe("theme paper");
    expect(fuzzyFilter(items, "lc", (x) => x)[0]).toBe("layout classic");
  });
});
