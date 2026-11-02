import { describe, expect, it } from "vitest";
import { shownTheme, themeLevel, themesOpenedBetween, THEMES } from "./settings";

describe("level themes", () => {
  it("keeps the first four open", () => {
    expect(THEMES.filter((theme) => themeLevel(theme) === 1)).toEqual(["noir", "paper", "forest", "klein"]);
  });

  it("falls back to noir until the level is reached", () => {
    expect(shownTheme("plum", 9)).toBe("noir");
    expect(shownTheme("plum", 10)).toBe("plum");
    expect(shownTheme("paper", 1)).toBe("paper");
  });

  it("names what a level up opens", () => {
    expect(themesOpenedBetween(4, 5)).toEqual(["ash"]);
    expect(themesOpenedBetween(9, 16)).toEqual(["plum", "sepia"]);
    expect(themesOpenedBetween(5, 6)).toEqual([]);
  });
});
