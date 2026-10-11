import { describe, expect, it } from "vitest";

import { depthShade, SURFACE, zoneLine } from "./ocean";

describe("ocean view", () => {
  it("darkens with depth, never fully black", () => {
    expect(depthShade(SURFACE + 5)).toBe(0);
    expect(depthShade(SURFACE)).toBe(0);
    expect(depthShade(70)).toBeGreaterThan(depthShade(100));
    expect(depthShade(20)).toBeCloseTo(0.7);
    expect(depthShade(-50)).toBe(0.7);
  });

  it("warns about the abyss", () => {
    expect(zoneLine("reef", "The Reef")).toBe("The Reef");
    expect(zoneLine("abyss", "The Abyss")).toContain("helm");
  });
});
