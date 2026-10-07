import { describe, expect, it } from "vitest";
import { crackPixels, crackStage } from "./crack";

describe("mining cracks", () => {
  it("deepen in ten stages with progress", () => {
    expect(crackStage(0)).toBe(0);
    expect(crackStage(0.35)).toBe(3);
    expect(crackStage(1)).toBe(9);
    expect(crackStage(7)).toBe(9);
  });
  it("keep earlier cracks and add more", () => {
    const early = crackPixels(2);
    const late = crackPixels(8);
    expect(late.size).toBeGreaterThan(early.size);
    for (const p of early) expect(late.has(p)).toBe(true);
    expect(crackPixels(4)).toEqual(crackPixels(4));
  });
});
