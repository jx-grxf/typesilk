import { describe, expect, it } from "vitest";
import { QuietGate } from "./quiet-gate";

describe("QuietGate", () => {
  it("lets keys through until it is closed", () => {
    expect(new QuietGate(600).pass(1000)).toBe(true);
  });

  it("holds keys right after closing", () => {
    const gate = new QuietGate(600);
    gate.close(1000);
    expect(gate.pass(1090)).toBe(false);
  });

  it("stays closed for as long as keys keep coming", () => {
    const gate = new QuietGate(600);
    gate.close(1000);
    for (let now = 1100; now <= 5000; now += 100) expect(gate.pass(now)).toBe(false);
  });

  it("opens after a quiet moment", () => {
    const gate = new QuietGate(600);
    gate.close(1000);
    expect(gate.pass(1200)).toBe(false);
    expect(gate.pass(1800)).toBe(true);
  });
});
