import { describe, expect, it } from "vitest";

import {
  AABB,
  BLOCK_RULE_NONE,
  BlockRotation,
  BlockRuleEvaluator,
  BlockRuleLogic,
  BlockUtils,
  Light,
  LightUtils,
  PY_ROTATION,
  Y_ROT_MAP,
  Y_ROT_MAP_EIGHT,
  Y_ROT_MAP_FOUR,
  Voxel,
} from "../src";

describe("BlockUtils", () => {
  it("supports id roundtrip", () => {
    for (const id of [0, 1, 100, 1000, 65535]) {
      const voxel = BlockUtils.insertId(0, id);
      expect(BlockUtils.extractId(voxel)).toBe(id);
    }
  });

  it("masks overflowing ids like u16", () => {
    const voxel = BlockUtils.insertId(0, 65537);
    expect(BlockUtils.extractId(voxel)).toBe(1);
  });

  it("supports stage roundtrip", () => {
    for (let stage = 0; stage <= 15; stage += 1) {
      const voxel = BlockUtils.insertStage(0, stage);
      expect(BlockUtils.extractStage(voxel)).toBe(stage);
    }
  });

  it("rejects invalid stages", () => {
    expect(() => BlockUtils.insertStage(0, 16)).toThrowError(RangeError);
    expect(() => BlockUtils.insertStage(0, -1)).toThrowError(RangeError);
  });

  it("supports rotation roundtrip", () => {
    const rotation = BlockRotation.ny(Math.PI / 3);
    const voxel = BlockUtils.insertRotation(0, rotation);
    const extracted = BlockUtils.extractRotation(voxel);
    expect(extracted.equals(rotation)).toBe(true);
  });

  it("accepts rotation-like objects for insertion", () => {
    const inserted = BlockUtils.insertRotation(0, {
      value: PY_ROTATION,
      yRotation: Math.PI / 2,
    });
    const extracted = BlockUtils.extractRotation(inserted);
    const [, yRotationSegment] = BlockRotation.decode(extracted);
    expect(yRotationSegment).toBe(4);
  });
});

describe("LightUtils", () => {
  it("supports sunlight roundtrip", () => {
    for (let level = 0; level <= 15; level += 1) {
      const light = LightUtils.insertSunlight(0, level);
      expect(LightUtils.extractSunlight(light)).toBe(level);
    }
  });

  it("supports channel roundtrip", () => {
    for (let level = 0; level <= 15; level += 1) {
      expect(LightUtils.extractRedLight(LightUtils.insertRedLight(0, level))).toBe(
        level
      );
      expect(
        LightUtils.extractGreenLight(LightUtils.insertGreenLight(0, level))
      ).toBe(level);
      expect(LightUtils.extractBlueLight(LightUtils.insertBlueLight(0, level))).toBe(
        level
      );
    }
  });

  it("packs and unpacks all channels", () => {
    const packed = Light.pack({
      sunlight: 12,
      red: 8,
      green: 4,
      blue: 2,
    });
    expect(Light.unpack(packed)).toEqual({
      sunlight: 12,
      red: 8,
      green: 4,
      blue: 2,
    });
  });

  it("masks overflowing and negative channel levels to 4 bits", () => {
    const masked = Light.pack({
      sunlight: 20,
      red: -1,
      green: 31,
      blue: -17,
    });
    expect(Light.unpack(masked)).toEqual({
      sunlight: 4,
      red: 15,
      green: 15,
      blue: 15,
    });
  });

  it("preserves untouched channels when updating one channel", () => {
    const base = Light.pack({
      sunlight: 9,
      red: 7,
      green: 5,
      blue: 3,
    });
    const updated = Light.withGreen(base, 14);
    expect(Light.unpack(updated)).toEqual({
      sunlight: 9,
      red: 7,
      green: 14,
      blue: 3,
    });
  });
});

describe("AABB", () => {
  it("supports unionAll", () => {
    const union = AABB.unionAll([
      AABB.create(0, 0, 0, 1, 1, 1),
      AABB.create(0.5, 0.5, 0.5, 2, 2, 2),
    ]);
    expect(union.minX).toBe(0);
    expect(union.minY).toBe(0);
    expect(union.minZ).toBe(0);
    expect(union.maxX).toBe(2);
    expect(union.maxY).toBe(2);
    expect(union.maxZ).toBe(2);
  });

  it("detects intersections", () => {
    const a = AABB.create(0, 0, 0, 1, 1, 1);
    const b = AABB.create(0.5, 0.5, 0.5, 1.5, 1.5, 1.5);
    const c = AABB.create(2, 2, 2, 3, 3, 3);
    expect(a.intersects(b)).toBe(true);
    expect(a.intersects(c)).toBe(false);
  });
});

describe("BlockRotation", () => {
  it("supports encode and decode", () => {
    const rotation = BlockRotation.encode(PY_ROTATION, 7);
    const [axis, yRotation] = BlockRotation.decode(rotation);
    const decoded = BlockRotation.encode(axis, yRotation);
    expect(decoded.equals(rotation)).toBe(true);
  });

  it("supports equality by decoded segment", () => {
    const base = BlockRotation.PY(Math.PI / 2);
    const equivalent = BlockRotation.encode(PY_ROTATION, 4);
    expect(base.equals(equivalent)).toBe(true);
  });

  it("normalizes negative y-rotation segments", () => {
    const rotation = BlockRotation.py(-(Math.PI * 2.0) / 16.0);
    const [, yRotation] = BlockRotation.decode(rotation);
    expect(yRotation).toBe(15);
  });

  it("rotates transparency for non-zero y rotation on PY axis", () => {
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

  it("supports value and axis aliases", () => {
    const rotation = new BlockRotation();
    expect(rotation.value).toBe(rotation.axis);
    rotation.axis = 4;
    expect(rotation.value).toBe(4);
    rotation.value = 2;
    expect(rotation.axis).toBe(2);
  });

  it("supports uppercase constructor aliases", () => {
    expect(BlockRotation.PX(0).axis).toBe(2);
    expect(BlockRotation.NX(0).axis).toBe(3);
    expect(BlockRotation.PY(0).axis).toBe(0);
    expect(BlockRotation.NY(0).axis).toBe(1);
    expect(BlockRotation.PZ(0).axis).toBe(4);
    expect(BlockRotation.NZ(0).axis).toBe(5);
  });
});

describe("Rotation maps", () => {
  it("exposes expected map sizes", () => {
    expect(Y_ROT_MAP.length).toBe(32);
    expect(Y_ROT_MAP_EIGHT.length).toBe(16);
    expect(Y_ROT_MAP_FOUR.length).toBe(8);
  });
});

describe("BlockRuleEvaluator", () => {
  it("evaluates simple rules", () => {
    const data = {
      voxel: Voxel.pack({ id: 12, rotation: BlockRotation.py(0), stage: 3 }),
    };
    const access = {
      getVoxel: () => Voxel.id(data.voxel),
      getVoxelRotation: () => Voxel.rotation(data.voxel),
      getVoxelStage: () => Voxel.stage(data.voxel),
    };
    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      id: 12,
      stage: 3,
    };
    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(true);
  });

  it("uses first sub-rule semantics for NOT logic", () => {
    const access = {
      getVoxel: () => 1,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const rule = {
      type: "combination" as const,
      logic: BlockRuleLogic.Not,
      rules: [
        {
          type: "simple" as const,
          offset: [0, 0, 0] as [number, number, number],
          id: 2,
        },
        BLOCK_RULE_NONE,
      ],
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(true);
  });

  it("rotates offsets for y-rotatable rules", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 9,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 1 ? 9 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(Math.PI / 2),
      yRotatable: true,
      worldSpace: false,
    });

    expect(matched).toBe(true);
  });

  it("does not rotate offsets for world-space rules", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 11,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 1 && y === 0 && z === 0 ? 11 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(Math.PI / 2),
      yRotatable: true,
      worldSpace: true,
    });

    expect(matched).toBe(true);
  });

  it("matches rotation rules by decoded segment equality", () => {
    const ruleRotation = BlockRotation.encode(PY_ROTATION, 5);
    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      rotation: ruleRotation,
    };

    const access = {
      getVoxel: () => 1,
      getVoxelRotation: () =>
        BlockRotation.py(ruleRotation.yRotation + 1e-10),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access);

    expect(matched).toBe(true);
  });
});
