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

  it("rotates simple rule offsets when y-rotatable", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 7,
    };

    const matched = BlockUtils.evaluateBlockRule(
      rule,
      [0, 0, 0],
      {
        getVoxelAt: (x: number, y: number, z: number) =>
          x === 0 && y === 0 && z === 1 ? 7 : 0,
        getVoxelRotationAt: () => new BlockRotation(),
        getVoxelStageAt: () => 0,
      },
      {
        rotation: new BlockRotation(PY_ROTATION, Math.PI / 2),
        yRotatable: true,
        worldSpace: false,
      }
    );

    expect(matched).toBe(true);
  });

  it("does not rotate offsets for world-space rules", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 5,
    };

    const matched = BlockUtils.evaluateBlockRule(
      rule,
      [0, 0, 0],
      {
        getVoxelAt: (x: number, y: number, z: number) =>
          x === 1 && y === 0 && z === 0 ? 5 : 0,
        getVoxelRotationAt: () => new BlockRotation(),
        getVoxelStageAt: () => 0,
      },
      {
        rotation: new BlockRotation(PY_ROTATION, Math.PI / 2),
        yRotatable: true,
        worldSpace: true,
      }
    );

    expect(matched).toBe(true);
  });

  it("matches rotation rules by decoded segment equality", () => {
    const ruleRotation = BlockRotation.encode(PY_ROTATION, 5);
    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      rotation: ruleRotation,
    };

    const matched = BlockUtils.evaluateBlockRule(
      rule,
      [0, 0, 0],
      {
        getVoxelAt: () => 1,
        getVoxelRotationAt: () =>
          new BlockRotation(PY_ROTATION, ruleRotation.yRotation + 1e-10),
        getVoxelStageAt: () => 0,
      }
    );

    expect(matched).toBe(true);
  });
});

describe("BlockUtils encoding parity", () => {
  it("masks overflowing voxel ids", () => {
    const voxel = BlockUtils.insertID(0, 65537);
    expect(BlockUtils.extractID(voxel)).toBe(1);
  });

  it("rejects invalid stage values", () => {
    expect(() => BlockUtils.insertStage(0, 16)).toThrowError(RangeError);
    expect(() => BlockUtils.insertStage(0, -1)).toThrowError(RangeError);
  });

  it("supports rotation roundtrip", () => {
    const rotation = BlockRotation.PZ(Math.PI / 2);
    const voxel = BlockUtils.insertRotation(0, rotation);
    const extracted = BlockUtils.extractRotation(voxel);
    expect(extracted.equals(rotation)).toBe(true);
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

  it("normalizes negative y-rotation segments on decode", () => {
    const rotation = new BlockRotation(PY_ROTATION, -(Math.PI * 2.0) / 16.0);
    const [, yRotation] = BlockRotation.decode(rotation);
    expect(yRotation).toBe(15);
  });

  it("supports axis alias for value", () => {
    const rotation = new BlockRotation();
    expect(rotation.axis).toBe(rotation.value);
    rotation.axis = 4;
    expect(rotation.value).toBe(4);
  });

  it("supports semantic equality by decoded segment", () => {
    const base = new BlockRotation(PY_ROTATION, Math.PI / 2);
    const equivalent = BlockRotation.encode(PY_ROTATION, 4);
    expect(base.equals(equivalent)).toBe(true);
  });

  it("supports uppercase constructor aliases", () => {
    expect(BlockRotation.PX(0).value).toBe(2);
    expect(BlockRotation.NX(0).value).toBe(3);
    expect(BlockRotation.PY(0).value).toBe(0);
    expect(BlockRotation.NY(0).value).toBe(1);
    expect(BlockRotation.PZ(0).value).toBe(4);
    expect(BlockRotation.NZ(0).value).toBe(5);
  });
});
