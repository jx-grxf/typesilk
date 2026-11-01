import { describe, expect, it } from "vitest";
import { closestRoute } from "./closest-route";

const wrongLetters = (path: string) =>
  closestRoute(path)
    .letters.filter((letter) => letter.wrong)
    .map((letter) => letter.char)
    .join("");

describe("closestRoute", () => {
  it("suggests the page behind a swapped letter", () => {
    expect(closestRoute("/abuot").route).toBe("/about");
    expect(wrongLetters("/abuot")).toHaveLength(2);
  });

  it("marks only the extra letter", () => {
    expect(closestRoute("/abouut").route).toBe("/about");
    expect(wrongLetters("/abouut")).toBe("u");
  });

  it("finds a page with a letter missing, with nothing to mark", () => {
    expect(closestRoute("/abut").route).toBe("/about");
    expect(wrongLetters("/abut")).toBe("");
  });

  it("treats a different case as the same page but keeps what was typed", () => {
    const match = closestRoute("/About");
    expect(match.route).toBe("/about");
    expect(match.letters.map((letter) => letter.char).join("")).toBe("/About");
    expect(match.letters.some((letter) => letter.wrong)).toBe(false);
  });

  it("gives up on a path that is not close to anything", () => {
    const match = closestRoute("/wp-login.php");
    expect(match.route).toBeNull();
    expect(match.letters.every((letter) => letter.wrong)).toBe(true);
  });

  it("does not suggest a two-letter page for any short path", () => {
    expect(closestRoute("/xy").route).toBeNull();
  });
});
