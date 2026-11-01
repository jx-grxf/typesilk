import { describe, expect, it } from "vitest";
import { keyprint } from "./avatar";

describe("keyprint", () => {
  const names = ["jx-grxf", "good_name", "a", "", "fast-typer", "山田太郎", "bot_two"];

  it("gives the same grid for the same name", () => {
    expect(keyprint("jx-grxf")).toEqual(keyprint("jx-grxf"));
  });

  it("tells most names apart", () => {
    const grids = new Set(Array.from({ length: 200 }, (_, i) => JSON.stringify(keyprint(`user${i}`))));
    expect(grids.size).toBeGreaterThan(190);
  });

  it.each(names)("is a mirrored 5 by 5 grid with enough keys for %j", (name) => {
    const grid = keyprint(name);
    expect(grid).toHaveLength(5);
    for (const row of grid) expect(row).toEqual([...row].reverse());
    expect(grid.flat().filter(Boolean).length).toBeGreaterThanOrEqual(7);
  });
});
