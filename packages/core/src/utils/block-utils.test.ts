import { describe, expect, it } from "vitest";

import { Block, BlockRotation, BlockRuleLogic } from "../core/world/block";

import { BlockUtils } from "./block-utils";

const makeBlock = (
  isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean],
): Block =>
  ({
    id: 1,
    name: "Probe",
    isTransparent,
  }) as Block;

describe("BlockUtils.getBlockRotatedTransparency", () => {
  it("passes transparency through for an unrotated block", () => {
    const block = makeBlock([true, false, true, false, true, false]);
    const result = BlockUtils.getBlockRotatedTransparency(
      block,
      new BlockRotation(),
    );
    expect(result).toEqual([true, false, true, false, true, false]);
  });

  it("returns a six-face array without throwing for every rotation", () => {
    const block = makeBlock([true, false, false, false, false, false]);
    for (let rotationValue = 0; rotationValue < 6; rotationValue++) {
      const result = BlockUtils.getBlockRotatedTransparency(
        block,
        BlockRotation.encode(rotationValue),
      );
      expect(result).toHaveLength(6);
      result.forEach((face) => expect(typeof face).toBe("boolean"));
    }
  });

  it("treats a null block as fully opaque instead of throwing", () => {
    expect(() =>
      BlockUtils.getBlockRotatedTransparency(null, new BlockRotation()),
    ).not.toThrow();
    expect(
      BlockUtils.getBlockRotatedTransparency(null, new BlockRotation()),
    ).toEqual([false, false, false, false, false, false]);
  });

  it("treats an undefined block as fully opaque instead of throwing", () => {
    expect(
      BlockUtils.getBlockRotatedTransparency(undefined, new BlockRotation()),
    ).toEqual([false, false, false, false, false, false]);
  });
});

describe("BlockUtils.getBlockTorchLightLevelAt", () => {
  // A wire-like emitter: a dark part, then one glowing part per stage, each
  // guarded on the voxel's own stage and on a neighbour, as Town's copper
  // wire is built.
  const neighbourRule = {
    type: "simple" as const,
    offset: [1, 0, 0] as [number, number, number],
    id: 7,
    rotation: null,
    stage: null,
  };
  const stageRule = (stage: number) => ({
    type: "simple" as const,
    offset: [0, 0, 0] as [number, number, number],
    id: null,
    rotation: null,
    stage,
  });
  const parts = [
    { rule: stageRule(0), faces: [], aabbs: [], isTransparent: [] },
    ...Array.from({ length: 15 }, (_, index) => ({
      rule: {
        type: "combination" as const,
        logic: BlockRuleLogic.And,
        rules: [stageRule(index + 1), neighbourRule],
      },
      faces: [],
      aabbs: [],
      isTransparent: [],
      redLightLevel: index + 1,
    })),
  ];
  const wire = {
    dynamicPatterns: [{ parts }],
    redLightLevel: 0,
  } as unknown as Block;

  const space = (stage: number, neighbour: number) => {
    const reads = { count: 0 };
    return {
      reads,
      functions: {
        getVoxelAt: (x: number) => {
          reads.count += 1;
          return x === 1 ? neighbour : 0;
        },
        getVoxelRotationAt: () => new BlockRotation(),
        getVoxelStageAt: () => {
          reads.count += 1;
          return stage;
        },
      },
    };
  };

  it("answers each stage's level, reading only that stage's part", () => {
    for (let stage = 1; stage <= 15; stage += 1) {
      const { reads, functions } = space(stage, 7);
      expect(
        BlockUtils.getBlockTorchLightLevelAt(wire, "RED", [0, 0, 0], functions),
      ).toBe(stage);
      // The stage once up front, then the matching part's two reads.
      expect(reads.count).toBe(3);
    }
  });

  it("falls back to the block's own level when no part can match", () => {
    const dark = space(0, 7);
    expect(
      BlockUtils.getBlockTorchLightLevelAt(wire, "RED", [0, 0, 0], dark.functions),
    ).toBe(0);
    expect(dark.reads.count).toBe(1);

    const unjoined = space(9, 0);
    expect(
      BlockUtils.getBlockTorchLightLevelAt(
        wire,
        "RED",
        [0, 0, 0],
        unjoined.functions,
      ),
    ).toBe(0);
  });

  it("guards only on the voxel's own stage, alone or under an and", () => {
    expect(BlockUtils.selfStageGuard(stageRule(4))).toBe(4);
    expect(BlockUtils.selfStageGuard(parts[5].rule)).toBe(5);
    expect(BlockUtils.selfStageGuard(neighbourRule)).toBeUndefined();
    expect(
      BlockUtils.selfStageGuard({
        type: "combination",
        logic: BlockRuleLogic.Or,
        rules: [stageRule(2), neighbourRule],
      }),
    ).toBeUndefined();
    expect(
      BlockUtils.selfStageGuard({
        type: "simple",
        offset: [0, 1, 0],
        id: null,
        rotation: null,
        stage: 3,
      }),
    ).toBeUndefined();
  });
});
