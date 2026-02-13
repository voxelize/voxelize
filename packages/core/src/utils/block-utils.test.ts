import { describe, expect, it } from "vitest";

import {
  BlockRotation,
  BlockRuleLogic,
  PY_ROTATION,
} from "../core/world/block";

import { BlockUtils } from "./block-utils";

describe("BlockUtils.evaluateBlockRule", () => {
  it("uses first-rule semantics for NOT logic", () => {
    const rule = {
      type: "combination" as const,
      logic: BlockRuleLogic.Not,
      rules: [
        {
          type: "simple" as const,
          offset: [0, 0, 0] as [number, number, number],
          id: 2,
        },
        {
          type: "none" as const,
        },
      ],
    };

    const matched = BlockUtils.evaluateBlockRule(rule, [0, 0, 0], {
      getVoxelAt: () => 1,
      getVoxelRotationAt: () => new BlockRotation(),
      getVoxelStageAt: () => 0,
    });

    expect(matched).toBe(true);
  });
});

describe("BlockRotation.rotateTransparency", () => {
  it("does not short-circuit non-zero PY y-rotation", () => {
    const rotation = BlockRotation.encode(PY_ROTATION, 4);
    const input: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      true,
      false,
      false,
      false,
      false,
      false,
    ];

    expect(rotation.rotateTransparency(input)).not.toEqual(input);
  });
});
