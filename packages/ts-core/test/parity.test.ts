import { describe, expect, it } from "vitest";

import {
  AABB,
  BLOCK_RULE_NONE,
  BlockFace,
  BlockRotation,
  BlockRuleEvaluator,
  BlockRuleLogic,
  BlockUtils,
  Light,
  LightColor,
  LightUtils,
  PY_ROTATION,
  Y_ROT_MAP,
  Y_ROT_MAP_EIGHT,
  Y_ROT_MAP_FOUR,
  createBlockConditionalPart,
  createCornerData,
  createUV,
  toSaturatedUint32,
  lightColorFromIndex,
  Voxel,
} from "../src";

describe("BlockUtils", () => {
  it("supports id roundtrip", () => {
    for (const id of [0, 1, 100, 1000, 65535]) {
      const voxel = BlockUtils.insertId(0, id);
      expect(BlockUtils.extractId(voxel)).toBe(id);
    }
  });

  it("supports legacy ID aliases", () => {
    const voxel = BlockUtils.insertID(0, 77);
    expect(BlockUtils.extractID(voxel)).toBe(77);
    expect(BlockUtils.extractId(voxel)).toBe(77);
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
    expect(() => BlockUtils.insertStage(0, 1.5)).toThrowError(RangeError);
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

  it("falls back to PY axis when inserting invalid rotation axis values", () => {
    const inserted = BlockUtils.insertRotation(0, {
      value: 99,
      yRotation: Math.PI / 2,
    });
    const extracted = BlockUtils.extractRotation(inserted);
    expect(extracted.axis).toBe(PY_ROTATION);
  });

  it("keeps packed voxel values in unsigned 32-bit space", () => {
    const packed = BlockUtils.insertId(-1, 1);
    expect(packed).toBe(0xffff0001);
    expect(Voxel.id(packed)).toBe(1);
    expect(Voxel.stage(packed)).toBe(15);
  });

  it("packs defaults when rotation and stage are omitted", () => {
    const packed = BlockUtils.insertAll(9);
    const unpacked = Voxel.unpack(packed);

    expect(unpacked.id).toBe(9);
    expect(unpacked.stage).toBe(0);
    expect(unpacked.rotation.equals(BlockRotation.py(0))).toBe(true);
  });

  it("supports chained voxel field updates", () => {
    const base = Voxel.pack({ id: 1 });
    const rotation = BlockRotation.nx(Math.PI / 2);
    const updated = Voxel.withStage(Voxel.withRotation(Voxel.withId(base, 5), rotation), 12);

    expect(Voxel.unpack(updated)).toEqual({
      id: 5,
      rotation: Voxel.rotation(updated),
      stage: 12,
    });
    expect(Voxel.rotation(updated).equals(rotation)).toBe(true);
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

  it("returns zero when packing empty light channel objects", () => {
    expect(Light.pack({})).toBe(0);
    expect(Light.unpack(0)).toEqual({
      sunlight: 0,
      red: 0,
      green: 0,
      blue: 0,
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

  it("supports channel index to LightColor mapping", () => {
    expect(lightColorFromIndex(0)).toBe(LightColor.Sunlight);
    expect(lightColorFromIndex(1)).toBe(LightColor.Red);
    expect(lightColorFromIndex(2)).toBe(LightColor.Green);
    expect(lightColorFromIndex(3)).toBe(LightColor.Blue);
  });

  it("rejects invalid light channel indices", () => {
    expect(() => lightColorFromIndex(-1)).toThrowError(RangeError);
    expect(() => lightColorFromIndex(4)).toThrowError(RangeError);
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

  it("treats boundary-touching boxes as non-intersecting", () => {
    const a = AABB.create(0, 0, 0, 1, 1, 1);
    const touchX = AABB.create(1, 0, 0, 2, 1, 1);
    const touchY = AABB.create(0, 1, 0, 1, 2, 1);
    const touchZ = AABB.create(0, 0, 1, 1, 1, 2);

    expect(a.intersects(touchX)).toBe(false);
    expect(a.intersects(touchY)).toBe(false);
    expect(a.intersects(touchZ)).toBe(false);
  });

  it("builds bounds via fluent AABB builder", () => {
    const aabb = AABB.new()
      .scaleX(2)
      .scaleY(3)
      .scaleZ(4)
      .offsetX(1)
      .offsetY(2)
      .offsetZ(3)
      .build();

    expect(aabb.minX).toBe(1);
    expect(aabb.minY).toBe(2);
    expect(aabb.minZ).toBe(3);
    expect(aabb.maxX).toBe(3);
    expect(aabb.maxY).toBe(5);
    expect(aabb.maxZ).toBe(7);
  });

  it("uses unit-cube defaults in AABB builder", () => {
    const aabb = AABB.new().build();
    expect([aabb.minX, aabb.minY, aabb.minZ]).toEqual([0, 0, 0]);
    expect([aabb.maxX, aabb.maxY, aabb.maxZ]).toEqual([1, 1, 1]);
  });

  it("supports translate and setPosition while preserving dimensions", () => {
    const aabb = AABB.create(0, 0, 0, 2, 3, 4);
    aabb.translate(1, -1, 2);
    expect([aabb.minX, aabb.minY, aabb.minZ]).toEqual([1, -1, 2]);
    expect([aabb.maxX, aabb.maxY, aabb.maxZ]).toEqual([3, 2, 6]);

    aabb.setPosition(5, 6, 7);
    expect([aabb.minX, aabb.minY, aabb.minZ]).toEqual([5, 6, 7]);
    expect([aabb.width(), aabb.height(), aabb.depth()]).toEqual([2, 3, 4]);
  });

  it("supports union and intersection", () => {
    const a = AABB.create(0, 0, 0, 2, 2, 2);
    const b = AABB.create(1, 1, 1, 3, 4, 5);
    const union = a.union(b);
    const intersection = a.intersection(b);

    expect([union.minX, union.minY, union.minZ, union.maxX, union.maxY, union.maxZ]).toEqual([0, 0, 0, 3, 4, 5]);
    expect([
      intersection.minX,
      intersection.minY,
      intersection.minZ,
      intersection.maxX,
      intersection.maxY,
      intersection.maxZ,
    ]).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it("returns inverted intersection bounds for disjoint boxes", () => {
    const a = AABB.create(0, 0, 0, 1, 1, 1);
    const b = AABB.create(2, 2, 2, 3, 3, 3);
    const intersection = a.intersection(b);

    expect(intersection.minX).toBe(2);
    expect(intersection.minY).toBe(2);
    expect(intersection.minZ).toBe(2);
    expect(intersection.maxX).toBe(1);
    expect(intersection.maxY).toBe(1);
    expect(intersection.maxZ).toBe(1);
    expect(intersection.minX).toBeGreaterThan(intersection.maxX);
    expect(intersection.minY).toBeGreaterThan(intersection.maxY);
    expect(intersection.minZ).toBeGreaterThan(intersection.maxZ);
  });

  it("returns empty AABB for unionAll with no entries", () => {
    const emptyUnion = AABB.unionAll([]);
    expect(emptyUnion).toEqual(AABB.empty());
    expect(emptyUnion.mag()).toBe(0);
  });

  it("computes geometric extents and magnitude", () => {
    const aabb = AABB.create(1, 2, 3, 4, 6, 15);
    expect(aabb.width()).toBe(3);
    expect(aabb.height()).toBe(4);
    expect(aabb.depth()).toBe(12);
    expect(aabb.mag()).toBe(13);
  });

  it("detects touching bounds and supports clone/copy", () => {
    const a = AABB.create(0, 0, 0, 1, 1, 1);
    const b = AABB.create(1, 0, 0, 2, 1, 1);
    expect(a.touches(b)).toBe(true);

    const cloned = a.clone();
    cloned.translate(1, 1, 1);
    expect([a.minX, a.minY, a.minZ]).toEqual([0, 0, 0]);
    expect([cloned.minX, cloned.minY, cloned.minZ]).toEqual([1, 1, 1]);

    const copied = AABB.empty();
    copied.copy(cloned);
    expect([copied.minX, copied.minY, copied.minZ]).toEqual([1, 1, 1]);
    expect([copied.maxX, copied.maxY, copied.maxZ]).toEqual([2, 2, 2]);
  });

  it("uses epsilon tolerance for touching bounds", () => {
    const a = AABB.create(0, 0, 0, 1, 1, 1);
    const b = AABB.create(1 + 5e-5, 0, 0, 2, 1, 1);
    const c = AABB.create(1 + 5e-4, 0, 0, 2, 1, 1);

    expect(a.touches(b)).toBe(true);
    expect(a.touches(c)).toBe(false);
  });
});

describe("BlockRotation", () => {
  it("supports encode and decode", () => {
    const rotation = BlockRotation.encode(PY_ROTATION, 7);
    const [axis, yRotation] = BlockRotation.decode(rotation);
    const decoded = BlockRotation.encode(axis, yRotation);
    expect(decoded.equals(rotation)).toBe(true);
  });

  it("normalizes oversized encoded y-rotation segments", () => {
    const rotation = BlockRotation.encode(PY_ROTATION, 18);
    const [axis, yRotation] = BlockRotation.decode(rotation);
    expect(axis).toBe(PY_ROTATION);
    expect(yRotation).toBe(2);
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

  it("rotates nodes around voxel center for PY y-rotation", () => {
    const rotation = BlockRotation.py(Math.PI / 2);
    const nodeA: [number, number, number] = [1, 0, 0];
    const nodeB: [number, number, number] = [1, 0, 1];

    rotation.rotateNode(nodeA, true, false);
    rotation.rotateNode(nodeB, true, false);

    expect(nodeA[0]).toBeCloseTo(0, 10);
    expect(nodeA[1]).toBeCloseTo(0, 10);
    expect(nodeA[2]).toBeCloseTo(0, 10);
    expect(nodeB[0]).toBeCloseTo(1, 10);
    expect(nodeB[1]).toBeCloseTo(0, 10);
    expect(nodeB[2]).toBeCloseTo(0, 10);
  });

  it("keeps transparency unchanged for zero y rotation on PY axis", () => {
    const rotation = BlockRotation.encode(PY_ROTATION, 0);
    const input: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      true,
      false,
      true,
      false,
      true,
      false,
    ];
    expect(rotation.rotateTransparency(input)).toEqual(input);
  });

  it("returns a boolean tuple for non-PY transparency rotations", () => {
    const rotation = BlockRotation.px(Math.PI / 2);
    const input: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      true,
      true,
      false,
      false,
      true,
      false,
    ];
    const rotated = rotation.rotateTransparency(input);

    expect(rotated.length).toBe(6);
    expect(rotated.every((value) => typeof value === "boolean")).toBe(true);
    expect(rotated).not.toEqual(input);
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

  it("applies non-PY translation offsets only when translate=true", () => {
    const withTranslate: [number, number, number] = [0, 0, 0];
    const withoutTranslate: [number, number, number] = [0, 0, 0];
    const rotation = BlockRotation.px(0);
    rotation.rotateNode(withTranslate, false, true);
    rotation.rotateNode(withoutTranslate, false, false);

    expect(withTranslate).toEqual([0, 1, 0]);
    expect(withoutTranslate).toEqual([0, 0, 0]);
  });

  it("applies axis-specific translation offsets when enabled", () => {
    const cases: Array<{
      createRotation: () => BlockRotation;
      expectedOffset: [number, number, number];
    }> = [
      { createRotation: () => BlockRotation.px(0), expectedOffset: [0, 1, 0] },
      { createRotation: () => BlockRotation.nx(0), expectedOffset: [1, 0, 0] },
      { createRotation: () => BlockRotation.ny(0), expectedOffset: [0, 1, 1] },
      { createRotation: () => BlockRotation.pz(0), expectedOffset: [0, 1, 0] },
      { createRotation: () => BlockRotation.nz(0), expectedOffset: [0, 0, 1] },
    ];

    for (const testCase of cases) {
      const withTranslate: [number, number, number] = [0, 0, 0];
      const withoutTranslate: [number, number, number] = [0, 0, 0];
      const rotation = testCase.createRotation();

      rotation.rotateNode(withTranslate, false, true);
      rotation.rotateNode(withoutTranslate, false, false);

      expect(withTranslate[0]).toBeCloseTo(testCase.expectedOffset[0], 10);
      expect(withTranslate[1]).toBeCloseTo(testCase.expectedOffset[1], 10);
      expect(withTranslate[2]).toBeCloseTo(testCase.expectedOffset[2], 10);
      expect(withoutTranslate[0]).toBeCloseTo(0, 10);
      expect(withoutTranslate[1]).toBeCloseTo(0, 10);
      expect(withoutTranslate[2]).toBeCloseTo(0, 10);
    }
  });

  it("shifts rotated AABBs by axis translation offsets when enabled", () => {
    const source = AABB.create(0, 0, 0, 1, 1, 1);
    const rotation = BlockRotation.px(0);
    const translated = rotation.rotateAABB(source, false, true);
    const untranslated = rotation.rotateAABB(source, false, false);

    expect(translated.minY).toBeCloseTo(untranslated.minY + 1, 10);
    expect(translated.maxY).toBeCloseTo(untranslated.maxY + 1, 10);
    expect(translated.width()).toBeCloseTo(untranslated.width(), 10);
    expect(translated.height()).toBeCloseTo(untranslated.height(), 10);
    expect(translated.depth()).toBeCloseTo(untranslated.depth(), 10);
  });

  it("falls back to PY axis when encoding invalid axis values", () => {
    const rotation = BlockRotation.encode(99, 3);
    expect(rotation.axis).toBe(PY_ROTATION);
  });

  it("produces ordered finite AABB bounds for all encoded rotations", () => {
    const source = AABB.create(0.1, 0.2, 0.3, 0.9, 0.8, 0.7);

    for (const axis of [0, 1, 2, 3, 4, 5]) {
      for (let segment = 0; segment < 16; segment += 1) {
        const rotation = BlockRotation.encode(axis, segment);
        const rotated = rotation.rotateAABB(source, true, true);

        expect(Number.isFinite(rotated.minX)).toBe(true);
        expect(Number.isFinite(rotated.minY)).toBe(true);
        expect(Number.isFinite(rotated.minZ)).toBe(true);
        expect(Number.isFinite(rotated.maxX)).toBe(true);
        expect(Number.isFinite(rotated.maxY)).toBe(true);
        expect(Number.isFinite(rotated.maxZ)).toBe(true);
        expect(rotated.minX).toBeLessThanOrEqual(rotated.maxX);
        expect(rotated.minY).toBeLessThanOrEqual(rotated.maxY);
        expect(rotated.minZ).toBeLessThanOrEqual(rotated.maxZ);
      }
    }
  });

  it("ignores yRotation in rotateAABB when yRotate is false", () => {
    const source = AABB.create(0, 0, 0, 1, 0.5, 0.25);
    const rotationA = BlockRotation.py(0);
    const rotationB = BlockRotation.py(Math.PI / 2);
    const rotatedA = rotationA.rotateAABB(source, false, true);
    const rotatedB = rotationB.rotateAABB(source, false, true);

    expect(rotatedB.minX).toBeCloseTo(rotatedA.minX, 10);
    expect(rotatedB.minY).toBeCloseTo(rotatedA.minY, 10);
    expect(rotatedB.minZ).toBeCloseTo(rotatedA.minZ, 10);
    expect(rotatedB.maxX).toBeCloseTo(rotatedA.maxX, 10);
    expect(rotatedB.maxY).toBeCloseTo(rotatedA.maxY, 10);
    expect(rotatedB.maxZ).toBeCloseTo(rotatedA.maxZ, 10);
  });

  it("keeps non-Y rotateAABB results stable across yRotate toggles", () => {
    const source = AABB.create(0.1, 0.2, 0.3, 0.7, 0.9, 0.8);
    const nonYAxisRotations = [
      BlockRotation.px(Math.PI / 2),
      BlockRotation.nx(Math.PI / 2),
      BlockRotation.pz(Math.PI / 2),
      BlockRotation.nz(Math.PI / 2),
    ];

    for (const rotation of nonYAxisRotations) {
      const withYRotate = rotation.rotateAABB(source, true, true);
      const withoutYRotate = rotation.rotateAABB(source, false, true);

      expect(withYRotate.minX).toBeCloseTo(withoutYRotate.minX, 10);
      expect(withYRotate.minY).toBeCloseTo(withoutYRotate.minY, 10);
      expect(withYRotate.minZ).toBeCloseTo(withoutYRotate.minZ, 10);
      expect(withYRotate.maxX).toBeCloseTo(withoutYRotate.maxX, 10);
      expect(withYRotate.maxY).toBeCloseTo(withoutYRotate.maxY, 10);
      expect(withYRotate.maxZ).toBeCloseTo(withoutYRotate.maxZ, 10);
    }
  });

  it("keeps NY y-rotated xz envelope unchanged when translate=false", () => {
    const source = AABB.create(0, 0, 0, 1, 1, 1);
    const rotation = BlockRotation.ny(Math.PI / 2);
    const translated = rotation.rotateAABB(source, true, true);
    const untranslated = rotation.rotateAABB(source, true, false);

    expect(untranslated.minX).toBeCloseTo(translated.minX, 10);
    expect(untranslated.maxX).toBeCloseTo(translated.maxX, 10);
    expect(untranslated.minZ).toBeCloseTo(translated.minZ, 10);
    expect(untranslated.maxZ).toBeCloseTo(translated.maxZ, 10);
    expect(untranslated.minY).toBeCloseTo(translated.minY - 1, 10);
    expect(untranslated.maxY).toBeCloseTo(translated.maxY - 1, 10);
  });
});

describe("Rotation maps", () => {
  it("exposes expected map sizes", () => {
    expect(Y_ROT_MAP.length).toBe(32);
    expect(Y_ROT_MAP_EIGHT.length).toBe(16);
    expect(Y_ROT_MAP_FOUR.length).toBe(8);
  });

  it("keeps canonical first-segment mappings", () => {
    expect(Y_ROT_MAP[0]).toEqual([0, 0]);
    expect(Y_ROT_MAP[1]).toEqual([-(Math.PI * 2), 0]);
    expect(Y_ROT_MAP_EIGHT[0]).toEqual([0, 0]);
    expect(Y_ROT_MAP_FOUR[0]).toEqual([0, 0]);
  });

  it("uses expected segment indices for reduced maps", () => {
    const eightSegmentIndices = Y_ROT_MAP_EIGHT.map(([, index]) => index);
    const fourSegmentIndices = Y_ROT_MAP_FOUR.map(([, index]) => index);

    expect(
      eightSegmentIndices.every((index) => {
        return index % 2 === 0;
      })
    ).toBe(true);
    expect(
      fourSegmentIndices.every((index) => {
        return index % 4 === 0;
      })
    ).toBe(true);
  });
});

describe("Numeric helpers", () => {
  it("saturates values into unsigned 32-bit range", () => {
    expect(toSaturatedUint32(Number.NaN)).toBe(0);
    expect(toSaturatedUint32(-5)).toBe(0);
    expect(toSaturatedUint32(12.9)).toBe(12);
    expect(toSaturatedUint32(0xffffffff + 1)).toBe(0xffffffff);
  });
});

describe("Type builders", () => {
  it("creates UV ranges with defaults and explicit values", () => {
    expect(createUV()).toEqual({
      startU: 0,
      endU: 0,
      startV: 0,
      endV: 0,
    });
    expect(createUV(1, 2, 3, 4)).toEqual({
      startU: 1,
      endU: 2,
      startV: 3,
      endV: 4,
    });
  });

  it("clones corner vector inputs", () => {
    const pos: [number, number, number] = [1, 2, 3];
    const uv: [number, number] = [0.25, 0.75];
    const corner = createCornerData(pos, uv);
    pos[0] = 9;
    uv[0] = 0;

    expect(corner).toEqual({
      pos: [1, 2, 3],
      uv: [0.25, 0.75],
    });
  });

  it("normalizes and recomputes BlockFace nameLower", () => {
    const face = new BlockFace({ name: "TopFace" });
    expect(face.nameLower).toBe("topface");
    expect(face.getNameLower()).toBe("topface");

    face.name = "NewFace";
    face.computeNameLower();
    expect(face.nameLower).toBe("newface");
    expect(face.getNameLower()).toBe("newface");

    face.nameLower = "";
    expect(face.getNameLower()).toBe("NewFace");
  });

  it("clones block face corner arrays on construction", () => {
    const firstCorner = createCornerData([0, 0, 0], [0, 0]);
    const face = new BlockFace({
      name: "Front",
      corners: [firstCorner, firstCorner, firstCorner, firstCorner],
    });
    firstCorner.pos[0] = 10;
    firstCorner.uv[0] = 1;

    expect(face.corners[0].pos[0]).toBe(0);
    expect(face.corners[0].uv[0]).toBe(0);
  });

  it("builds conditional parts with deterministic defaults", () => {
    const part = createBlockConditionalPart({});
    expect(part.rule).toEqual(BLOCK_RULE_NONE);
    expect(part.faces).toEqual([]);
    expect(part.aabbs).toEqual([]);
    expect(part.isTransparent).toEqual([false, false, false, false, false, false]);
    expect(part.worldSpace).toBe(false);
  });

  it("preserves provided conditional part fields", () => {
    const face = new BlockFace({ name: "CustomFace" });
    const aabb = AABB.create(0, 0, 0, 1, 1, 1);
    const faces = [face];
    const aabbs = [aabb];
    const isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      true,
      false,
      true,
      false,
      true,
      false,
    ];
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: 99,
      },
      faces,
      aabbs,
      isTransparent,
      worldSpace: true,
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [1, 0, 0],
      id: 99,
    });
    expect(part.faces).toEqual(faces);
    expect(part.aabbs).toEqual(aabbs);
    expect(part.isTransparent).toEqual(isTransparent);
    expect(part.worldSpace).toBe(true);

    faces.push(new BlockFace({ name: "Mutated" }));
    aabbs.push(AABB.create(0, 0, 0, 2, 2, 2));
    isTransparent[0] = false;

    expect(part.faces).toHaveLength(1);
    expect(part.aabbs).toHaveLength(1);
    expect(part.isTransparent).toEqual([true, false, true, false, true, false]);
  });

  it("keeps BlockFace constructor option fields", () => {
    const face = new BlockFace({
      name: "Decor",
      independent: true,
      isolated: true,
      textureGroup: "decor",
      dir: [1, 0, 0],
      range: createUV(0, 1, 2, 3),
    });

    expect(face.independent).toBe(true);
    expect(face.isolated).toBe(true);
    expect(face.textureGroup).toBe("decor");
    expect(face.dir).toEqual([1, 0, 0]);
    expect(face.range).toEqual({
      startU: 0,
      endU: 1,
      startV: 2,
      endV: 3,
    });
  });
});

describe("BlockRuleEvaluator", () => {
  it("always matches BLOCK_RULE_NONE", () => {
    const access = {
      getVoxel: () => 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(BlockRuleEvaluator.evaluate(BLOCK_RULE_NONE, [12, -5, 3], access)).toBe(
      true
    );
  });

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

  it("treats empty NOT combinations as true", () => {
    const access = {
      getVoxel: () => 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const rule = {
      type: "combination" as const,
      logic: BlockRuleLogic.Not,
      rules: [],
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(true);
  });

  it("evaluates OR combinations across multiple sub-rules", () => {
    const access = {
      getVoxel: () => 8,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 2,
    };

    const rule = {
      type: "combination" as const,
      logic: BlockRuleLogic.Or,
      rules: [
        {
          type: "simple" as const,
          offset: [0, 0, 0] as [number, number, number],
          id: 4,
        },
        {
          type: "simple" as const,
          offset: [0, 0, 0] as [number, number, number],
          id: 8,
          stage: 2,
        },
      ],
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(true);
  });

  it("fails simple rule evaluation when stage constraint does not match", () => {
    const access = {
      getVoxel: () => 12,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 1,
    };

    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      id: 12,
      stage: 3,
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(false);
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

  it("keeps offsets unrotated when yRotatable is false", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 13,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 1 && y === 0 && z === 0 ? 13 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(Math.PI / 2),
      yRotatable: false,
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

  it("fails rotation rules when decoded segments differ", () => {
    const ruleRotation = BlockRotation.encode(PY_ROTATION, 5);
    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      rotation: ruleRotation,
    };

    const access = {
      getVoxel: () => 1,
      getVoxelRotation: () => BlockRotation.encode(PY_ROTATION, 7),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access);

    expect(matched).toBe(false);
  });

  it("returns false for unsupported combination logic values", () => {
    const access = {
      getVoxel: () => 1,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const invalidLogicRule = {
      type: "combination" as const,
      logic: "xor" as BlockRuleLogic,
      rules: [BLOCK_RULE_NONE],
    };

    expect(BlockRuleEvaluator.evaluate(invalidLogicRule, [0, 0, 0], access)).toBe(
      false
    );
  });
});
