import { describe, expect, it } from "vitest";

import { branchHoldsWater, type BranchShape } from "./branch";

const shape = (kind?: BranchShape["kind"]): BranchShape => ({
  key: 1,
  kind,
  texelsPerBlock: 16,
  radiusMask: 0b0111,
  sideFace: "px",
  endFace: "py",
});

describe("branchHoldsWater", () => {
  it("mirrors BranchShape::holds_water: one-voxel wood thinner than a block", () => {
    for (let radius = 1; radius < 8; radius += 1) {
      expect(branchHoldsWater(shape(), radius - 1)).toBe(true);
    }
    expect(branchHoldsWater(shape(), 7)).toBe(false);
    expect(branchHoldsWater(shape("core"), 0)).toBe(false);
    expect(branchHoldsWater(shape("fin"), 0)).toBe(false);
  });
});
