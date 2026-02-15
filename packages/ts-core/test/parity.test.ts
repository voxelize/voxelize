import { describe, expect, it } from "vitest";

import {
  AABB,
  BLOCK_RULE_NONE,
  type AABBInit,
  type BlockConditionalPartInput,
  type BlockDynamicPatternInput,
  type BlockFaceInit,
  type BlockRuleEvaluationRotationInput,
  type BlockRotationInput,
  type BlockRule,
  type BlockRuleInput,
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
  createAABB,
  createBlockConditionalPart,
  createBlockDynamicPattern,
  createBlockFace,
  createBlockRotation,
  createBlockRule,
  createFaceTransparency,
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
    expect(() => BlockUtils.insertStage(0, Number.NaN)).toThrowError(RangeError);
    expect(() => BlockUtils.insertStage(0, Number.POSITIVE_INFINITY)).toThrowError(
      RangeError
    );
    expect(() => BlockUtils.insertStage(0, Number.NEGATIVE_INFINITY)).toThrowError(
      RangeError
    );
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

  it("normalizes non-finite y-rotation values during insertion", () => {
    for (const yRotation of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const inserted = BlockUtils.insertRotation(0, {
        value: PY_ROTATION,
        yRotation,
      });
      const extracted = BlockUtils.extractRotation(inserted);
      const [axis, yRotationSegment] = BlockRotation.decode(extracted);

      expect(axis).toBe(PY_ROTATION);
      expect(yRotationSegment).toBe(0);
    }
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

  it("masks packed voxel ids to 16 bits", () => {
    const packed = Voxel.pack({ id: 0x12345, stage: 15 });

    expect(Voxel.id(packed)).toBe(0x2345);
    expect(Voxel.stage(packed)).toBe(15);
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

  it("ignores upper bits when unpacking light channels", () => {
    const light = 0xfff0abcd;
    expect(Light.unpack(light)).toEqual({
      sunlight: 0xa,
      red: 0xb,
      green: 0xc,
      blue: 0xd,
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

  it("keeps channel updates unsigned for signed input words", () => {
    const withSunlight = Light.withSunlight(-1, 0);
    const withRed = Light.withRed(-1, 0);
    const withGreen = Light.withGreen(-1, 0);
    const withBlue = Light.withBlue(-1, 0);

    expect(withSunlight).toBe(withSunlight >>> 0);
    expect(withRed).toBe(withRed >>> 0);
    expect(withGreen).toBe(withGreen >>> 0);
    expect(withBlue).toBe(withBlue >>> 0);
    expect(Light.unpack(withSunlight).sunlight).toBe(0);
    expect(Light.unpack(withRed).red).toBe(0);
    expect(Light.unpack(withGreen).green).toBe(0);
    expect(Light.unpack(withBlue).blue).toBe(0);
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

  it("does not mutate source boxes when computing unionAll", () => {
    const first = AABB.create(0, 0, 0, 1, 1, 1);
    const second = AABB.create(0.5, 0.5, 0.5, 2, 2, 2);
    const union = AABB.unionAll([first, second]);

    union.minX = -10;
    union.maxX = 10;

    expect([first.minX, first.maxX]).toEqual([0, 1]);
    expect([second.minX, second.maxX]).toEqual([0.5, 2]);
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

  it("normalizes negative encoded y-rotation segments", () => {
    const rotation = BlockRotation.encode(PY_ROTATION, -1);
    const [axis, yRotation] = BlockRotation.decode(rotation);
    expect(axis).toBe(PY_ROTATION);
    expect(yRotation).toBe(15);
  });

  it("supports equality by decoded segment", () => {
    const base = BlockRotation.PY(Math.PI / 2);
    const equivalent = BlockRotation.encode(PY_ROTATION, 4);
    expect(base.equals(equivalent)).toBe(true);
  });

  it("treats full-turn y-rotation offsets as equal", () => {
    const base = BlockRotation.py(Math.PI / 2);
    const equivalent = BlockRotation.py(Math.PI / 2 + Math.PI * 2);
    expect(base.equals(equivalent)).toBe(true);
  });

  it("normalizes negative y-rotation segments", () => {
    const rotation = BlockRotation.py(-(Math.PI * 2.0) / 16.0);
    const [, yRotation] = BlockRotation.decode(rotation);
    expect(yRotation).toBe(15);
  });

  it("falls back to PY axis when decoding invalid axis values", () => {
    const [axis, yRotation] = BlockRotation.decode(new BlockRotation(99, Math.PI / 2));
    expect(axis).toBe(PY_ROTATION);
    expect(yRotation).toBe(4);
  });

  it("decodes large y-rotation angles via modulo-normalized segments", () => {
    const largeAngle = 6728604188452.013;
    const [axis, yRotation] = BlockRotation.decode(
      new BlockRotation(PY_ROTATION, largeAngle)
    );
    const normalizedAngle =
      ((largeAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const expectedSegment = Math.round((normalizedAngle * 16) / (Math.PI * 2)) % 16;

    expect(axis).toBe(PY_ROTATION);
    expect(yRotation).toBe(expectedSegment);
    expect(yRotation).toBe(15);
  });

  it("decodes large negative y-rotation angles via modulo-normalized segments", () => {
    const largeNegativeAngle = -7087903122387371;
    const [axis, yRotation] = BlockRotation.decode(
      new BlockRotation(PY_ROTATION, largeNegativeAngle)
    );
    const normalizedAngle =
      ((largeNegativeAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const expectedSegment = Math.round((normalizedAngle * 16) / (Math.PI * 2)) % 16;

    expect(axis).toBe(PY_ROTATION);
    expect(yRotation).toBe(expectedSegment);
    expect(yRotation).toBe(11);
    expect(BlockRotation.py(largeNegativeAngle).equals(BlockRotation.encode(PY_ROTATION, 11))).toBe(
      true
    );
  });

  it("normalizes non-finite y-rotation values in decode and transforms", () => {
    const input: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      true,
      false,
      true,
      false,
      true,
      false,
    ];
    const baseNode: [number, number, number] = [0.25, 0.5, 0.75];
    const nonFiniteAngles = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];

    for (const angle of nonFiniteAngles) {
      const [axis, yRotation] = BlockRotation.decode(new BlockRotation(PY_ROTATION, angle));
      expect(axis).toBe(PY_ROTATION);
      expect(yRotation).toBe(0);

      const node: [number, number, number] = [...baseNode];
      BlockRotation.py(angle).rotateNode(node, true, false);

      expect(node[0]).toBeCloseTo(baseNode[0], 10);
      expect(node[1]).toBeCloseTo(baseNode[1], 10);
      expect(node[2]).toBeCloseTo(baseNode[2], 10);
      expect(BlockRotation.py(angle).rotateTransparency(input)).toEqual(input);
      expect(BlockRotation.py(angle).equals(BlockRotation.py(0))).toBe(true);
    }

    const source = AABB.create(0, 0, 0, 1, 1, 1);
    const pxBaseline = BlockRotation.px(0).rotateAABB(source, true, true);
    const pxWithNaN = BlockRotation.px(Number.NaN).rotateAABB(source, true, true);
    expect(pxWithNaN.minX).toBeCloseTo(pxBaseline.minX, 10);
    expect(pxWithNaN.minY).toBeCloseTo(pxBaseline.minY, 10);
    expect(pxWithNaN.minZ).toBeCloseTo(pxBaseline.minZ, 10);
    expect(pxWithNaN.maxX).toBeCloseTo(pxBaseline.maxX, 10);
    expect(pxWithNaN.maxY).toBeCloseTo(pxBaseline.maxY, 10);
    expect(pxWithNaN.maxZ).toBeCloseTo(pxBaseline.maxZ, 10);
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

  it("keeps transparency unchanged for full-turn y rotations on PY axis", () => {
    const input: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      true,
      false,
      true,
      false,
      true,
      false,
    ];
    expect(BlockRotation.py(Math.PI * 2).rotateTransparency(input)).toEqual(input);
    expect(BlockRotation.py(-Math.PI * 2).rotateTransparency(input)).toEqual(input);
  });

  it("keeps node positions unchanged for full-turn PY y rotations", () => {
    const nodeA: [number, number, number] = [0.25, 0.5, 0.75];
    const nodeB: [number, number, number] = [0.25, 0.5, 0.75];

    BlockRotation.py(Math.PI * 2).rotateNode(nodeA, true, false);
    BlockRotation.py(-Math.PI * 2).rotateNode(nodeB, true, false);

    expect(nodeA[0]).toBeCloseTo(0.25, 10);
    expect(nodeA[1]).toBeCloseTo(0.5, 10);
    expect(nodeA[2]).toBeCloseTo(0.75, 10);
    expect(nodeB[0]).toBeCloseTo(0.25, 10);
    expect(nodeB[1]).toBeCloseTo(0.5, 10);
    expect(nodeB[2]).toBeCloseTo(0.75, 10);
  });

  it("keeps AABB bounds unchanged for full-turn PY y rotations", () => {
    const source = AABB.create(0.1, 0.2, 0.3, 0.9, 0.8, 0.7);
    const positive = BlockRotation.py(Math.PI * 2).rotateAABB(source, true, true);
    const negative = BlockRotation.py(-Math.PI * 2).rotateAABB(source, true, true);

    expect(positive.minX).toBeCloseTo(source.minX, 10);
    expect(positive.minY).toBeCloseTo(source.minY, 10);
    expect(positive.minZ).toBeCloseTo(source.minZ, 10);
    expect(positive.maxX).toBeCloseTo(source.maxX, 10);
    expect(positive.maxY).toBeCloseTo(source.maxY, 10);
    expect(positive.maxZ).toBeCloseTo(source.maxZ, 10);
    expect(negative.minX).toBeCloseTo(source.minX, 10);
    expect(negative.minY).toBeCloseTo(source.minY, 10);
    expect(negative.minZ).toBeCloseTo(source.minZ, 10);
    expect(negative.maxX).toBeCloseTo(source.maxX, 10);
    expect(negative.maxY).toBeCloseTo(source.maxY, 10);
    expect(negative.maxZ).toBeCloseTo(source.maxZ, 10);
  });

  it("treats near-full-turn y rotations within epsilon as identity", () => {
    const input: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      true,
      false,
      true,
      false,
      true,
      false,
    ];
    const node: [number, number, number] = [0.25, 0.5, 0.75];
    const source = AABB.create(0.1, 0.2, 0.3, 0.9, 0.8, 0.7);
    const epsilonTurn = Math.PI * 2 + 1e-13;
    const rotation = BlockRotation.py(epsilonTurn);

    rotation.rotateNode(node, true, false);
    const rotatedAabb = rotation.rotateAABB(source, true, true);

    expect(node[0]).toBeCloseTo(0.25, 10);
    expect(node[1]).toBeCloseTo(0.5, 10);
    expect(node[2]).toBeCloseTo(0.75, 10);
    expect(rotation.rotateTransparency(input)).toEqual(input);
    expect(rotatedAabb.minX).toBeCloseTo(source.minX, 10);
    expect(rotatedAabb.minY).toBeCloseTo(source.minY, 10);
    expect(rotatedAabb.minZ).toBeCloseTo(source.minZ, 10);
    expect(rotatedAabb.maxX).toBeCloseTo(source.maxX, 10);
    expect(rotatedAabb.maxY).toBeCloseTo(source.maxY, 10);
    expect(rotatedAabb.maxZ).toBeCloseTo(source.maxZ, 10);
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
    expect(toSaturatedUint32(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toSaturatedUint32(Number.NEGATIVE_INFINITY)).toBe(0);
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
    expect(part.rule).not.toBe(BLOCK_RULE_NONE);
    expect(part.faces).toEqual([]);
    expect(part.aabbs).toEqual([]);
    expect(part.isTransparent).toEqual([false, false, false, false, false, false]);
    expect(part.worldSpace).toBe(false);
  });

  it("builds conditional parts with deterministic defaults when no input is provided", () => {
    const part = createBlockConditionalPart();
    expect(part.rule).toEqual(BLOCK_RULE_NONE);
    expect(part.rule).not.toBe(BLOCK_RULE_NONE);
    expect(part.faces).toEqual([]);
    expect(part.aabbs).toEqual([]);
    expect(part.isTransparent).toEqual([false, false, false, false, false, false]);
    expect(part.worldSpace).toBe(false);
  });

  it("builds conditional parts with deterministic defaults for non-object inputs", () => {
    const partFromNull = createBlockConditionalPart(null);
    const partFromNumber = createBlockConditionalPart(42 as never);
    const partFromDate = createBlockConditionalPart(new Date() as never);
    const partWithThrowingGetter = Object.create(null) as {
      readonly rule: BlockRuleInput;
    };
    Object.defineProperty(partWithThrowingGetter, "rule", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("rule trap");
      },
    });
    const partFromThrowingGetter = createBlockConditionalPart(
      partWithThrowingGetter as never
    );
    const partFromThrowingProxy = createBlockConditionalPart(
      new Proxy(
        {},
        {
          getPrototypeOf: () => {
            throw new Error("prototype trap");
          },
        }
      ) as never
    );

    expect(partFromNull).toEqual({
      rule: BLOCK_RULE_NONE,
      faces: [],
      aabbs: [],
      isTransparent: [false, false, false, false, false, false],
      worldSpace: false,
    });
    expect(partFromNull.rule).not.toBe(BLOCK_RULE_NONE);
    expect(partFromNumber).toEqual({
      rule: BLOCK_RULE_NONE,
      faces: [],
      aabbs: [],
      isTransparent: [false, false, false, false, false, false],
      worldSpace: false,
    });
    expect(partFromNumber.rule).not.toBe(BLOCK_RULE_NONE);
    expect(partFromDate).toEqual({
      rule: BLOCK_RULE_NONE,
      faces: [],
      aabbs: [],
      isTransparent: [false, false, false, false, false, false],
      worldSpace: false,
    });
    expect(partFromDate.rule).not.toBe(BLOCK_RULE_NONE);
    expect(partFromThrowingGetter).toEqual({
      rule: BLOCK_RULE_NONE,
      faces: [],
      aabbs: [],
      isTransparent: [false, false, false, false, false, false],
      worldSpace: false,
    });
    expect(partFromThrowingGetter.rule).not.toBe(BLOCK_RULE_NONE);
    expect(partFromThrowingProxy).toEqual({
      rule: BLOCK_RULE_NONE,
      faces: [],
      aabbs: [],
      isTransparent: [false, false, false, false, false, false],
      worldSpace: false,
    });
    expect(partFromThrowingProxy.rule).not.toBe(BLOCK_RULE_NONE);
  });

  it("accepts null-prototype conditional part inputs", () => {
    const nullPrototypePart = Object.create(null) as BlockConditionalPartInput;
    const nullPrototypeAabb = Object.create(null) as {
      [Key in keyof AABBInit]: number;
    };
    nullPrototypeAabb.minX = 0;
    nullPrototypeAabb.minY = 0;
    nullPrototypeAabb.minZ = 0;
    nullPrototypeAabb.maxX = 1;
    nullPrototypeAabb.maxY = 1;
    nullPrototypeAabb.maxZ = 1;
    nullPrototypePart.rule = {
      type: "simple",
      offset: [1, 0, 0],
      id: 33,
    };
    nullPrototypePart.aabbs = [nullPrototypeAabb];
    nullPrototypePart.worldSpace = true;
    const part = createBlockConditionalPart(nullPrototypePart);

    expect(part).toEqual({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: 33,
      },
      faces: [],
      aabbs: [AABB.create(0, 0, 0, 1, 1, 1)],
      isTransparent: [false, false, false, false, false, false],
      worldSpace: true,
    });
  });

  it("accepts frozen conditional part input objects", () => {
    const frozenPart = Object.freeze({
      rule: {
        type: "simple" as const,
        offset: [1, 0, 0] as const,
        id: 33,
      },
      worldSpace: true,
    });
    const part = createBlockConditionalPart(frozenPart);

    expect(part).toEqual({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: 33,
      },
      faces: [],
      aabbs: [],
      isTransparent: [false, false, false, false, false, false],
      worldSpace: true,
    });
  });

  it("sanitizes malformed transparency entries to boolean defaults", () => {
    const malformedTransparency = [
      true,
      "yes",
      false,
      1,
      true,
      null,
    ] as never;
    const part = createBlockConditionalPart({
      isTransparent: malformedTransparency,
    });

    expect(part.isTransparent).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
  });

  it("creates sanitized transparency tuples with createFaceTransparency", () => {
    const sourceTransparency: [boolean, boolean, boolean, boolean, boolean, boolean] = [
      true,
      false,
      true,
      false,
      true,
      false,
    ];
    const createdTransparency = createFaceTransparency(sourceTransparency);
    const nullTransparency = createFaceTransparency(null);
    const undefinedTransparency = createFaceTransparency(undefined);
    const shortTransparency = createFaceTransparency([true]);
    const longTransparency = createFaceTransparency([
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);

    expect(createdTransparency).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(createdTransparency).not.toBe(sourceTransparency);
    expect(nullTransparency).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(undefinedTransparency).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(shortTransparency).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(longTransparency).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);

    sourceTransparency[0] = false;
    expect(createdTransparency[0]).toBe(true);
  });

  it("supports frozen transparency arrays in createFaceTransparency", () => {
    const frozenTransparency = Object.freeze([true, false, true, false, true, false] as const);
    const createdTransparency = createFaceTransparency(frozenTransparency);

    expect(createdTransparency).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(createdTransparency).not.toBe(frozenTransparency);
  });

  it("sanitizes transparency arrays with throwing index accessors", () => {
    const throwingTransparency = [true, false, true, false, true, false] as (
      boolean | undefined
    )[];
    Object.defineProperty(throwingTransparency, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("index trap");
      },
    });

    expect(createFaceTransparency(throwingTransparency as never)).toEqual([
      false,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it("clones transparency helper outputs in conditional parts", () => {
    const transparency = createFaceTransparency([true, false, false, false, false, false]);
    const part = createBlockConditionalPart({
      isTransparent: transparency,
    });

    transparency[0] = false;
    expect(part.isTransparent).toEqual([true, false, false, false, false, false]);
  });

  it("sanitizes null and non-array transparency inputs to defaults", () => {
    const nullTransparencyPart = createBlockConditionalPart({
      isTransparent: null,
    });
    const scalarTransparencyPart = createBlockConditionalPart({
      isTransparent: 1 as never,
    });
    const shortTransparencyPart = createBlockConditionalPart({
      isTransparent: [true],
    });

    expect(nullTransparencyPart.isTransparent).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(scalarTransparencyPart.isTransparent).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(shortTransparencyPart.isTransparent).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("sanitizes malformed worldSpace values to false", () => {
    const malformedWorldSpacePart = createBlockConditionalPart({
      worldSpace: "yes" as never,
    });
    const nullWorldSpacePart = createBlockConditionalPart({
      worldSpace: null,
    });
    const validWorldSpacePart = createBlockConditionalPart({
      worldSpace: true,
    });

    expect(malformedWorldSpacePart.worldSpace).toBe(false);
    expect(nullWorldSpacePart.worldSpace).toBe(false);
    expect(validWorldSpacePart.worldSpace).toBe(true);
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
    expect(part.faces[0]).not.toBe(face);
    expect(part.aabbs[0]).not.toBe(aabb);
    expect(part.isTransparent).toEqual(isTransparent);
    expect(part.worldSpace).toBe(true);

    faces.push(new BlockFace({ name: "Mutated" }));
    aabbs.push(AABB.create(0, 0, 0, 2, 2, 2));
    face.name = "MutatedFace";
    aabb.maxX = 9;
    isTransparent[0] = false;

    expect(part.faces).toHaveLength(1);
    expect(part.faces[0].name).toBe("CustomFace");
    expect(part.aabbs).toHaveLength(1);
    expect(part.aabbs[0].maxX).toBe(1);
    expect(part.isTransparent).toEqual([true, false, true, false, true, false]);
  });

  it("accepts BlockFaceInit inputs and clones nested face fields", () => {
    const corner = createCornerData([0, 0, 0], [0.25, 0.75]);
    const faceInit: BlockFaceInit = {
      name: "InitFace",
      independent: true,
      isolated: true,
      textureGroup: "decor",
      dir: [1, 0, 0],
      corners: [corner, corner, corner, corner],
      range: createUV(1, 2, 3, 4),
    };
    const part = createBlockConditionalPart({
      faces: [faceInit],
    });

    expect(part.faces).toHaveLength(1);
    expect(part.faces[0]).toBeInstanceOf(BlockFace);
    expect(part.faces[0].name).toBe("InitFace");
    expect(part.faces[0].independent).toBe(true);
    expect(part.faces[0].isolated).toBe(true);
    expect(part.faces[0].textureGroup).toBe("decor");
    expect(part.faces[0].dir).toEqual([1, 0, 0]);
    expect(part.faces[0].corners[0].uv).toEqual([0.25, 0.75]);
    expect(part.faces[0].range).toEqual({
      startU: 1,
      endU: 2,
      startV: 3,
      endV: 4,
    });

    faceInit.name = "MutatedFace";
    if (faceInit.dir !== undefined) {
      faceInit.dir[0] = 9;
    }
    if (faceInit.corners !== undefined) {
      faceInit.corners[0].pos[0] = 9;
    }
    if (faceInit.range !== undefined) {
      faceInit.range.startU = 9;
    }

    expect(part.faces[0].name).toBe("InitFace");
    expect(part.faces[0].dir).toEqual([1, 0, 0]);
    expect(part.faces[0].corners[0].pos[0]).toBe(0);
    expect(part.faces[0].range.startU).toBe(1);
  });

  it("accepts readonly conditional part arrays and transparency tuples", () => {
    const sourceFace = new BlockFace({ name: "ReadonlyFace" });
    const sourceAabb = AABB.create(0, 0, 0, 1, 1, 1);
    const readonlyFaces = [sourceFace] as const;
    const readonlyAabbs = [sourceAabb] as const;
    const readonlyTransparency = [
      true,
      false,
      true,
      false,
      true,
      false,
    ] as const;
    const part = createBlockConditionalPart({
      faces: readonlyFaces,
      aabbs: readonlyAabbs,
      isTransparent: readonlyTransparency,
      worldSpace: true,
    });

    expect(part.faces).toHaveLength(1);
    expect(part.aabbs).toHaveLength(1);
    expect(part.isTransparent).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(part.faces[0]).not.toBe(sourceFace);
    expect(part.aabbs[0]).not.toBe(sourceAabb);

    sourceFace.name = "MutatedReadonlyFace";
    sourceAabb.maxX = 9;
    expect(part.faces[0].name).toBe("ReadonlyFace");
    expect(part.aabbs[0].maxX).toBe(1);
  });

  it("skips invalid face and aabb entries during conditional part cloning", () => {
    const validFaceInit: BlockFaceInit = {
      name: "ValidFace",
      dir: [1, 0, 0],
    };
    const malformedFaceInstance = new BlockFace({ name: "MalformedFace" });
    (malformedFaceInstance as { name: string | number }).name = 42;
    const validAabb = AABB.create(0, 0, 0, 1, 1, 1);
    const part = createBlockConditionalPart({
      faces: [
        undefined,
        null,
        { name: 42 } as never,
        malformedFaceInstance,
        validFaceInit,
      ],
      aabbs: [undefined, null, { clone: "not-a-function" } as never, validAabb],
    });

    expect(part.faces).toHaveLength(1);
    expect(part.faces[0].name).toBe("ValidFace");
    expect(part.aabbs).toHaveLength(1);
    expect(part.aabbs[0]).toEqual(validAabb);
    expect(part.aabbs[0]).not.toBe(validAabb);
  });

  it("salvages iterator-trapped face and aabb entries during conditional part cloning", () => {
    const faces = [{ name: "IteratorFace" } as BlockFaceInit];
    Object.defineProperty(faces, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const aabbs = [AABB.create(0, 0, 0, 1, 1, 1)];
    Object.defineProperty(aabbs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    const part = createBlockConditionalPart({
      faces,
      aabbs,
    });

    expect(part.faces).toEqual([new BlockFace({ name: "IteratorFace" })]);
    expect(part.aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
  });

  it("sanitizes irrecoverable face and aabb iterators during conditional part cloning", () => {
    const trappedFaces = new Proxy([{ name: "IteratorFace" }], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const trappedAabbs = new Proxy([AABB.create(0, 0, 0, 1, 1, 1)], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const part = createBlockConditionalPart({
      faces: trappedFaces as never,
      aabbs: trappedAabbs as never,
    });

    expect(part.faces).toEqual([]);
    expect(part.aabbs).toEqual([]);
  });

  it("salvages key-based face and aabb entries when length access traps", () => {
    const sparseFaces = [] as Array<BlockFaceInit | undefined>;
    sparseFaces[5_000] = { name: "SparseFace" };
    const sparseAabbs = [] as Array<AABB | undefined>;
    sparseAabbs[5_000] = AABB.create(0, 0, 0, 1, 1, 1);
    const trappedFaces = new Proxy(sparseFaces, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const trappedAabbs = new Proxy(sparseAabbs, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const part = createBlockConditionalPart({
      faces: trappedFaces as never,
      aabbs: trappedAabbs as never,
    });

    expect(part.faces).toEqual([new BlockFace({ name: "SparseFace" })]);
    expect(part.aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
  });

  it("supplements noisy prefix face/aabb entries with key fallback recovery", () => {
    const noisyFaces: Array<BlockFaceInit | number> = [];
    noisyFaces[0] = 1;
    noisyFaces[5_000] = { name: "SparseFace" };
    const noisyAabbs: Array<AABB | number> = [];
    noisyAabbs[0] = 1;
    noisyAabbs[5_000] = AABB.create(0, 0, 0, 1, 1, 1);
    Object.defineProperty(noisyFaces, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    Object.defineProperty(noisyAabbs, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    const part = createBlockConditionalPart({
      faces: noisyFaces as never,
      aabbs: noisyAabbs as never,
    });

    expect(part.faces).toEqual([new BlockFace({ name: "SparseFace" })]);
    expect(part.aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
  });

  it("merges readable prefix and key-fallback face entries", () => {
    let prefixReadCount = 0;
    const sparseFaces: BlockFaceInit[] = [];
    sparseFaces[0] = { name: "PrefixFace" };
    sparseFaces[5_000] = { name: "KeyFace" };
    const trappedFaces = new Proxy(sparseFaces, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          prefixReadCount += 1;
          if (prefixReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const part = createBlockConditionalPart({
      faces: trappedFaces as never,
    });

    expect(part.faces).toEqual([
      new BlockFace({ name: "PrefixFace" }),
      new BlockFace({ name: "KeyFace" }),
    ]);
  });

  it("recovers key-based face entries when bounded direct reads throw", () => {
    const sparseFaces: BlockFaceInit[] = [];
    sparseFaces[5_000] = { name: "SparseFace" };
    const trappedFaces = new Proxy(sparseFaces, {
      getOwnPropertyDescriptor(target, property) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          const numericIndex = Number(propertyKey);
          if (numericIndex >= 0 && numericIndex < 1_024) {
            throw new Error("descriptor trap");
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          if (propertyKey === "5000") {
            return target[5_000];
          }
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const part = createBlockConditionalPart({
      faces: trappedFaces as never,
    });

    expect(part.faces).toEqual([new BlockFace({ name: "SparseFace" })]);
  });

  it("skips throwing key-fallback reads while salvaging face entries", () => {
    const sparseFaces: BlockFaceInit[] = [];
    sparseFaces[0] = { name: "BadFace" };
    sparseFaces[5_000] = { name: "GoodFace" };
    const trappedFaces = new Proxy(sparseFaces, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        if (propertyKey === "0") {
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const part = createBlockConditionalPart({
      faces: trappedFaces as never,
    });

    expect(part.faces).toEqual([new BlockFace({ name: "GoodFace" })]);
  });

  it("skips throwing key-fallback reads while salvaging aabb entries", () => {
    const sparseAabbs: AABB[] = [];
    sparseAabbs[0] = AABB.create(0, 0, 0, 1, 1, 1);
    sparseAabbs[5_000] = AABB.create(1, 1, 1, 2, 2, 2);
    const trappedAabbs = new Proxy(sparseAabbs, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        if (propertyKey === "0") {
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const part = createBlockConditionalPart({
      aabbs: trappedAabbs as never,
    });

    expect(part.aabbs).toEqual([AABB.create(1, 1, 1, 2, 2, 2)]);
  });

  it("caps bounded face-entry fallback scans when iterator access traps", () => {
    let boundedReadCount = 0;
    const oversizedFaces = new Proxy([] as Array<BlockFaceInit | undefined>, {
      getOwnPropertyDescriptor(target, property) {
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          throw new Error("descriptor trap");
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          boundedReadCount += 1;
          if (property === "0") {
            return { name: "BoundedFace" };
          }
          return undefined;
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const part = createBlockConditionalPart({
      faces: oversizedFaces as never,
    });

    expect(part.faces).toEqual([new BlockFace({ name: "BoundedFace" })]);
    expect(boundedReadCount).toBe(1024);
  });

  it("skips helper key enumeration when bounded face fallback is full", () => {
    let ownKeysCount = 0;
    const denseFaces: BlockFaceInit[] = [];
    for (let index = 0; index < 1_024; index += 1) {
      denseFaces[index] = {
        name: `DenseFace-${index}`,
      };
    }
    denseFaces[5_000] = {
      name: "SparseFace",
    };
    const trappedFaces = new Proxy(denseFaces, {
      ownKeys(target) {
        ownKeysCount += 1;
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const part = createBlockConditionalPart({
      faces: trappedFaces as never,
    });

    expect(part.faces).toHaveLength(1024);
    expect(part.faces[0].name).toBe("DenseFace-0");
    expect(part.faces[1023].name).toBe("DenseFace-1023");
    expect(
      part.faces.some((face) => {
        return face.name === "SparseFace";
      })
    ).toBe(false);
    expect(ownKeysCount).toBe(0);
  });

  it("ignores inherited numeric prototype face/aabb entries in fallback scans", () => {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { name: "InheritedFace" },
    });
    Object.defineProperty(Array.prototype, "1", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: AABB.create(0, 0, 0, 1, 1, 1),
    });

    try {
      const trappedFaces = new Proxy([] as Array<BlockFaceInit>, {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const trappedAabbs = new Proxy([] as Array<AABB>, {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 2;
          }
          return Reflect.get(target, property, receiver);
        },
      });

      const part = createBlockConditionalPart({
        faces: trappedFaces as never,
        aabbs: trappedAabbs as never,
      });

      expect(part.faces).toEqual([]);
      expect(part.aabbs).toEqual([]);
    } finally {
      delete (Array.prototype as Record<string, BlockFaceInit>)["0"];
      delete (Array.prototype as Record<string, AABB>)["1"];
    }
  });

  it("accepts null-prototype face init objects during conditional part cloning", () => {
    const nullPrototypeFace = Object.create(null) as {
      name: string;
      dir: [number, number, number];
    };
    nullPrototypeFace.name = "NullPrototypeFace";
    nullPrototypeFace.dir = [0, 1, 0];

    const part = createBlockConditionalPart({
      faces: [nullPrototypeFace],
    });

    expect(part.faces).toHaveLength(1);
    expect(part.faces[0]).toEqual(
      new BlockFace({
        name: "NullPrototypeFace",
        dir: [0, 1, 0],
      })
    );
  });

  it("accepts plain AABB init objects during conditional part cloning", () => {
    const sourceAabb = {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    };
    const part = createBlockConditionalPart({
      aabbs: [sourceAabb],
    });

    expect(part.aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
    sourceAabb.maxX = 9;
    expect(part.aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
  });

  it("accepts frozen AABB init objects during conditional part cloning", () => {
    const frozenAabb = Object.freeze({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    });
    const part = createBlockConditionalPart({
      aabbs: [frozenAabb],
    });

    expect(part.aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
  });

  it("accepts readonly AABB init literals during conditional part cloning", () => {
    const readonlyAabb = {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    } as const;
    const part = createBlockConditionalPart({
      aabbs: [readonlyAabb],
    });

    expect(part.aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
  });

  it("skips malformed AABB init values during conditional part cloning", () => {
    const part = createBlockConditionalPart({
      aabbs: [
        {
          minX: 0,
          minY: 0,
          minZ: 0,
          maxX: Number.POSITIVE_INFINITY,
          maxY: 1,
          maxZ: 1,
        } as never,
        {
          minX: 0,
          minY: 0,
          minZ: 0,
          maxX: "1",
          maxY: 1,
          maxZ: 1,
        } as never,
      ],
    });

    expect(part.aabbs).toEqual([]);
  });

  it("skips malformed AABB instances during conditional part cloning", () => {
    const malformedAabb = AABB.create(0, 0, 0, 1, 1, 1);
    malformedAabb.maxX = Number.POSITIVE_INFINITY;
    const validAabb = AABB.create(1, 1, 1, 2, 2, 2);
    const part = createBlockConditionalPart({
      aabbs: [malformedAabb, validAabb],
    });

    expect(part.aabbs).toEqual([validAabb]);
    expect(part.aabbs[0]).not.toBe(validAabb);
  });

  it("skips non-plain face objects during conditional part cloning", () => {
    class FaceLike {
      public readonly name = "ClassFace";
      public readonly dir: [number, number, number] = [1, 0, 0];
    }

    const part = createBlockConditionalPart({
      faces: [new FaceLike()],
    });

    expect(part.faces).toEqual([]);
  });

  it("skips non-plain aabb-like objects during conditional part cloning", () => {
    class AabbLike {
      public readonly minX = 0;
      public readonly minY = 0;
      public readonly minZ = 0;
      public readonly maxX = 1;
      public readonly maxY = 1;
      public readonly maxZ = 1;
    }

    const part = createBlockConditionalPart({
      aabbs: [new AabbLike() as never],
    });

    expect(part.aabbs).toEqual([]);
  });

  it("sanitizes malformed optional BlockFaceInit fields to defaults", () => {
    const malformedFace = {
      name: "MalformedFace",
      dir: ["x", 0, 0],
      corners: [
        createCornerData([0, 0, 0], [0, 0]),
        createCornerData([0, 0, 0], [0, 0]),
      ],
      range: {
        startU: 0,
        endU: 1,
        startV: "2",
        endV: 3,
      },
    };
    const part = createBlockConditionalPart({
      faces: [malformedFace as never],
    });

    expect(part.faces).toHaveLength(1);
    expect(part.faces[0].name).toBe("MalformedFace");
    expect(part.faces[0].dir).toEqual([0, 0, 0]);
    expect(part.faces[0].corners).toEqual([
      createCornerData([0, 0, 0], [0, 0]),
      createCornerData([0, 0, 0], [0, 0]),
      createCornerData([0, 0, 0], [0, 0]),
      createCornerData([0, 0, 0], [0, 0]),
    ]);
    expect(part.faces[0].range).toEqual(createUV());
  });

  it("clones provided conditional part rules", () => {
    const inputRule: BlockRule = {
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 99,
          rotation: BlockRotation.py(Math.PI / 2),
        },
      ],
    };
    const part = createBlockConditionalPart({
      rule: inputRule,
      worldSpace: true,
    });

    const simpleRule = inputRule.rules[0];
    if (simpleRule.type !== "simple" || simpleRule.rotation === undefined || simpleRule.rotation === null) {
      throw new Error("Expected simple rule with rotation");
    }
    simpleRule.offset[0] = 9;
    simpleRule.id = 77;
    simpleRule.rotation.axis = BlockRotation.PX().axis;

    expect(part.rule).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 99,
          rotation: BlockRotation.py(Math.PI / 2),
        },
      ],
    });
  });

  it("builds cloned none rules with createBlockRule defaults", () => {
    const rule = createBlockRule();
    expect(rule).toEqual(BLOCK_RULE_NONE);
    expect(rule).not.toBe(BLOCK_RULE_NONE);
  });

  it("clones nested rules with createBlockRule", () => {
    const sourceRule: BlockRule = {
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
          rotation: BlockRotation.py(Math.PI / 2),
        },
      ],
    };
    const clonedRule = createBlockRule(sourceRule);

    const sourceSimpleRule = sourceRule.rules[0];
    if (
      sourceSimpleRule.type !== "simple" ||
      sourceSimpleRule.rotation === undefined ||
      sourceSimpleRule.rotation === null
    ) {
      throw new Error("Expected simple source rule with rotation");
    }
    sourceSimpleRule.offset[0] = 9;
    sourceSimpleRule.id = 99;
    sourceSimpleRule.rotation.axis = BlockRotation.PX().axis;

    expect(clonedRule).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
          rotation: BlockRotation.py(Math.PI / 2),
        },
      ],
    });
    expect(clonedRule).not.toBe(sourceRule);
  });

  it("accepts readonly rule-tree inputs with createBlockRule", () => {
    const readonlyRuleTree = {
      type: "combination" as const,
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple" as const,
          offset: [1, 0, 0] as const,
          id: 5,
        },
      ] as const,
    };
    const clonedRule = createBlockRule(readonlyRuleTree);

    expect(clonedRule).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
      ],
    });
  });

  it("accepts frozen rule-tree inputs with createBlockRule", () => {
    const frozenRuleTree = Object.freeze({
      type: "combination" as const,
      logic: BlockRuleLogic.And,
      rules: Object.freeze([
        Object.freeze({
          type: "simple" as const,
          offset: [1, 0, 0] as const,
          id: 5,
        }),
      ]),
    });
    const clonedRule = createBlockRule(frozenRuleTree);

    expect(clonedRule).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
      ],
    });
  });

  it("salvages iterator-trapped combination rule entries", () => {
    const rules: BlockRuleInput[] = [
      {
        type: "simple",
        offset: [1, 0, 0],
        id: 5,
      },
    ];
    Object.defineProperty(rules, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    expect(
      createBlockRule({
        type: "combination",
        logic: BlockRuleLogic.And,
        rules,
      })
    ).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
      ],
    });
  });

  it("sanitizes irrecoverable combination rule iterators to none rules", () => {
    const trappedRules = new Proxy(
      [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
      ],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );

    expect(
      createBlockRule({
        type: "combination",
        logic: BlockRuleLogic.And,
        rules: trappedRules as never,
      })
    ).toEqual(BLOCK_RULE_NONE);
  });

  it("accepts null-prototype rule inputs with createBlockRule", () => {
    const nullPrototypeRule = Object.create(null) as {
      type: "simple";
      offset: [number, number, number];
      id: number;
    };
    nullPrototypeRule.type = "simple";
    nullPrototypeRule.offset = [1, 0, 0];
    nullPrototypeRule.id = 7;

    expect(createBlockRule(nullPrototypeRule)).toEqual({
      type: "simple",
      offset: [1, 0, 0],
      id: 7,
    });
  });

  it("sanitizes nullable combination sub-rules to none rules", () => {
    const sanitizedRule = createBlockRule({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        null,
        undefined,
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
      ],
    });

    expect(sanitizedRule).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "none",
        },
        {
          type: "none",
        },
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
      ],
    });
  });

  it("supplements noisy prefix combination entries with key fallback in createBlockRule", () => {
    const noisyRules: Array<BlockRuleInput | number> = [];
    noisyRules[0] = {
      type: "simple",
      offset: [1, 0, 0],
      id: 5,
    };
    noisyRules[5_000] = {
      type: "simple",
      offset: [2, 0, 0],
      id: 9,
    };
    Object.defineProperty(noisyRules, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    expect(
      createBlockRule({
        type: "combination",
        logic: BlockRuleLogic.Or,
        rules: noisyRules as never,
      })
    ).toEqual({
      type: "combination",
      logic: BlockRuleLogic.Or,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
        {
          type: "simple",
          offset: [2, 0, 0],
          id: 9,
        },
      ],
    });
  });

  it("recovers key-based combination entries when bounded createBlockRule direct reads throw", () => {
    const sparseRules: BlockRuleInput[] = [];
    sparseRules[5_000] = {
      type: "simple",
      offset: [1, 0, 0],
      id: 5,
    };
    const trappedRules = new Proxy(sparseRules, {
      getOwnPropertyDescriptor(target, property) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          const numericIndex = Number(propertyKey);
          if (numericIndex >= 0 && numericIndex < 1_024) {
            throw new Error("descriptor trap");
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          if (propertyKey === "5000") {
            return target[5_000];
          }
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(
      createBlockRule({
        type: "combination",
        logic: BlockRuleLogic.Or,
        rules: trappedRules as never,
      })
    ).toEqual({
      type: "combination",
      logic: BlockRuleLogic.Or,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
      ],
    });
  });

  it("skips throwing key-fallback reads while salvaging createBlockRule entries", () => {
    const sparseRules: BlockRuleInput[] = [];
    sparseRules[0] = {
      type: "simple",
      offset: [1, 0, 0],
      id: 5,
    };
    sparseRules[5_000] = {
      type: "simple",
      offset: [2, 0, 0],
      id: 9,
    };
    const trappedRules = new Proxy(sparseRules, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        if (propertyKey === "0") {
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(
      createBlockRule({
        type: "combination",
        logic: BlockRuleLogic.Or,
        rules: trappedRules as never,
      })
    ).toEqual({
      type: "combination",
      logic: BlockRuleLogic.Or,
      rules: [
        {
          type: "simple",
          offset: [2, 0, 0],
          id: 9,
        },
      ],
    });
  });

  it("skips createBlockRule key enumeration when bounded length fallback is full", () => {
    let ownKeysCount = 0;
    const denseRules: BlockRuleInput[] = [];
    for (let index = 0; index < 1_024; index += 1) {
      denseRules[index] = {
        type: "simple",
        offset: [0, 0, 0],
        id: 50,
      };
    }
    denseRules[5_000] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 51,
    };
    const trappedRules = new Proxy(denseRules, {
      ownKeys(target) {
        ownKeysCount += 1;
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const clonedRule = createBlockRule({
      type: "combination",
      logic: BlockRuleLogic.Or,
      rules: trappedRules as never,
    });

    expect(clonedRule.type).toBe("combination");
    if (clonedRule.type !== "combination") {
      throw new Error("Expected combination rule");
    }
    expect(clonedRule.rules).toHaveLength(1024);
    expect(clonedRule.rules[0]).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      id: 50,
    });
    expect(clonedRule.rules[1023]).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      id: 50,
    });
    expect(
      clonedRule.rules.some((entry) => {
        return entry.type === "simple" && entry.id === 51;
      })
    ).toBe(false);
    expect(ownKeysCount).toBe(0);
  });

  it("ignores inherited numeric prototype entries in createBlockRule fallbacks", () => {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: {
        type: "simple",
        offset: [0, 0, 0],
        id: 52,
      },
    });

    try {
      const trappedRules = new Proxy([] as BlockRuleInput[], {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });

      expect(
        createBlockRule({
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: trappedRules as never,
        })
      ).toEqual({
        type: "combination",
        logic: BlockRuleLogic.Or,
        rules: [],
      });
    } finally {
      delete (Array.prototype as Record<string, BlockRuleInput>)["0"];
    }
  });

  it("sanitizes malformed createBlockRule inputs to none rules", () => {
    const malformedRule = createBlockRule({
      type: "simple",
      offset: [1, "x", 0],
      id: 1,
    } as never);
    const malformedNestedRule = createBlockRule({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 1,
        },
        {
          type: "simple",
          offset: [0, "bad", 0],
          id: 2,
        },
      ],
    } as never);

    expect(malformedRule).toEqual(BLOCK_RULE_NONE);
    expect(malformedNestedRule).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 1,
        },
        {
          type: "none",
        },
      ],
    });
  });

  it("sanitizes malformed rotation-like values in createBlockRule inputs", () => {
    const invalidValueRule = createBlockRule({
      type: "simple",
      offset: [0, 0, 0],
      id: 5,
      rotation: {
        value: 16,
        yRotation: Math.PI / 2,
      },
    });
    const invalidYRotationRule = createBlockRule({
      type: "simple",
      offset: [0, 0, 0],
      id: 5,
      rotation: {
        value: BlockRotation.PX().axis,
        yRotation: Number.POSITIVE_INFINITY,
      },
    });
    const invalidInstance = BlockRotation.py(Math.PI / 2);
    invalidInstance.axis = 16;
    const invalidInstanceRule = createBlockRule({
      type: "simple",
      offset: [0, 0, 0],
      id: 5,
      rotation: invalidInstance,
    });
    const rotationWithThrowingValue = Object.create(null) as {
      readonly value: number;
      readonly yRotation: number;
    };
    Object.defineProperty(rotationWithThrowingValue, "value", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("value trap");
      },
    });
    Object.defineProperty(rotationWithThrowingValue, "yRotation", {
      configurable: true,
      enumerable: true,
      value: Math.PI / 2,
    });
    const getterTrapRule = createBlockRule({
      type: "simple",
      offset: [0, 0, 0],
      id: 5,
      rotation: rotationWithThrowingValue as never,
    });

    expect(invalidValueRule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      id: 5,
    });
    expect(invalidYRotationRule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      id: 5,
    });
    expect(invalidInstanceRule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      id: 5,
    });
    expect(getterTrapRule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      id: 5,
    });
  });

  it("sanitizes non-plain createBlockRule inputs to none rules", () => {
    class RuleLike {
      public readonly type = "simple" as const;
      public readonly offset: [number, number, number] = [1, 0, 0];
      public readonly id = 12;
    }

    const dateRule = createBlockRule(new Date() as never);
    const mapRule = createBlockRule(new Map() as never);
    const classRule = createBlockRule(new RuleLike());
    const throwingProxyRule = createBlockRule(
      new Proxy(
        {},
        {
          getPrototypeOf: () => {
            throw new Error("prototype trap");
          },
        }
      ) as never
    );

    expect(dateRule).toEqual(BLOCK_RULE_NONE);
    expect(mapRule).toEqual(BLOCK_RULE_NONE);
    expect(classRule).toEqual(BLOCK_RULE_NONE);
    expect(throwingProxyRule).toEqual(BLOCK_RULE_NONE);
  });

  it("sanitizes getter-trap createBlockRule inputs to none rules", () => {
    const ruleWithThrowingType = Object.create(null) as {
      readonly type: string;
    };
    Object.defineProperty(ruleWithThrowingType, "type", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("type trap");
      },
    });

    expect(createBlockRule(ruleWithThrowingType as never)).toEqual(BLOCK_RULE_NONE);
  });

  it("sanitizes cyclic createBlockRule inputs without throwing", () => {
    type CyclicCombinationRule = {
      type: "combination";
      logic: BlockRuleLogic;
      rules: CyclicRuleValue[];
    };
    type CyclicRuleValue =
      | CyclicCombinationRule
      | {
          type: "simple";
          offset: [number, number, number];
          id: number;
        };

    const cyclicRule: CyclicCombinationRule = {
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [],
    };
    cyclicRule.rules.push({
      type: "simple",
      offset: [1, 0, 0],
      id: 5,
    });
    cyclicRule.rules.push(cyclicRule);

    expect(createBlockRule(cyclicRule as never)).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
        {
          type: "none",
        },
      ],
    });
    expect(
      createBlockConditionalPart({
        rule: cyclicRule as never,
      }).rule
    ).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
        {
          type: "none",
        },
      ],
    });
  });

  it("preserves shared non-cyclic rule references during sanitization", () => {
    const sharedSimpleRule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 5,
    };
    const sharedRuleTree = {
      type: "combination" as const,
      logic: BlockRuleLogic.And,
      rules: [sharedSimpleRule, sharedSimpleRule],
    };
    const clonedRule = createBlockRule(sharedRuleTree);

    sharedSimpleRule.offset[0] = 9;
    sharedSimpleRule.id = 99;

    expect(clonedRule).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 5,
        },
      ],
    });
    if (clonedRule.type !== "combination") {
      throw new Error("Expected sanitized shared rule tree to be a combination.");
    }
    expect(clonedRule.rules[0]).not.toBe(clonedRule.rules[1]);
  });

  it("sanitizes malformed optional fields in simple rules", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: "bad",
        stage: "bad",
        rotation: {
          value: 0,
          yRotation: Math.PI / 2,
        },
      } as never,
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [1, 0, 0],
      rotation: BlockRotation.py(Math.PI / 2),
    });
  });

  it("sanitizes negative or fractional optional rule numbers", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: -1,
        stage: 2.5,
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [1, 0, 0],
    });
  });

  it("sanitizes overflowing optional rule numbers", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: 65536,
        stage: 16,
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [1, 0, 0],
    });
  });

  it("retains boundary optional rule numbers", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: 65535,
        stage: 15,
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [1, 0, 0],
      id: 65535,
      stage: 15,
    });
  });

  it("omits null optional simple-rule fields during sanitization", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: null,
        stage: null,
        rotation: null,
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [1, 0, 0],
    });
  });

  it("falls back to none rules for malformed rule inputs", () => {
    const malformedSimple = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [1, "x", 0],
        id: 1,
      } as never,
    });
    const malformedCombination = createBlockConditionalPart({
      rule: {
        type: "combination",
        logic: "xor",
        rules: [],
      } as never,
    });

    expect(malformedSimple.rule).toEqual(BLOCK_RULE_NONE);
    expect(malformedCombination.rule).toEqual(BLOCK_RULE_NONE);
  });

  it("sanitizes malformed nested combination rule entries to none rules", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "combination",
        logic: BlockRuleLogic.And,
        rules: [
          {
            type: "simple",
            offset: [1, 0, 0],
            id: 1,
          },
          {
            type: "simple",
            offset: ["x", 0, 0],
            id: 2,
          },
        ],
      } as never,
    });

    expect(part.rule).toEqual({
      type: "combination",
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple",
          offset: [1, 0, 0],
          id: 1,
        },
        {
          type: "none",
        },
      ],
    });
  });

  it("accepts rotation-like plain objects in rule sanitization", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: {
          value: 0,
          yRotation: Math.PI / 2,
        },
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      rotation: BlockRotation.py(Math.PI / 2),
    });
  });

  it("accepts readonly rotation-like objects in rule sanitization", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: {
          value: 0,
          yRotation: Math.PI / 2,
        } as const,
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      rotation: BlockRotation.py(Math.PI / 2),
    });
  });

  it("sanitizes malformed rotation-like values in rule sanitization", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: {
          value: -1,
          yRotation: Math.PI / 2,
        },
      },
    });
    const overflowingPart = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: {
          value: 16,
          yRotation: Math.PI / 2,
        },
      },
    });
    const fractionalPart = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: {
          value: 1.5,
          yRotation: Math.PI / 2,
        },
      },
    });
    const invalidInstanceRotation = new BlockRotation(16, Math.PI / 2);
    const invalidInstancePart = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: invalidInstanceRotation,
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
    });
    expect(overflowingPart.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
    });
    expect(fractionalPart.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
    });
    expect(invalidInstancePart.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
    });
  });

  it("retains boundary rotation-like values in rule sanitization", () => {
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: {
          value: 15,
          yRotation: Math.PI / 2,
        },
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      rotation: new BlockRotation(15, Math.PI / 2),
    });
  });

  it("accepts null-prototype rotation-like objects in rule sanitization", () => {
    const nullPrototypeRotation = Object.create(null) as {
      value: number;
      yRotation: number;
    };
    nullPrototypeRotation.value = 0;
    nullPrototypeRotation.yRotation = Math.PI / 2;
    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: nullPrototypeRotation,
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
      rotation: BlockRotation.py(Math.PI / 2),
    });
  });

  it("rejects non-plain rotation-like objects in rule sanitization", () => {
    class RotationLike {
      public readonly value = 0;
      public readonly yRotation = Math.PI / 2;
    }

    const part = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [0, 0, 0],
        rotation: new RotationLike(),
      },
    });

    expect(part.rule).toEqual({
      type: "simple",
      offset: [0, 0, 0],
    });
  });

  it("builds dynamic patterns with deterministic defaults", () => {
    const pattern = createBlockDynamicPattern();
    expect(pattern.parts).toEqual([]);
  });

  it("builds dynamic patterns with deterministic defaults for non-object inputs", () => {
    const patternFromNull = createBlockDynamicPattern(null);
    const patternFromNumber = createBlockDynamicPattern(42 as never);
    const patternWithThrowingParts = Object.create(null) as {
      readonly parts: BlockConditionalPartInput[];
    };
    Object.defineProperty(patternWithThrowingParts, "parts", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("parts trap");
      },
    });
    const patternFromThrowingParts = createBlockDynamicPattern(
      patternWithThrowingParts as never
    );

    expect(patternFromNull.parts).toEqual([]);
    expect(patternFromNumber.parts).toEqual([]);
    expect(patternFromThrowingParts.parts).toEqual([]);
  });

  it("accepts null-prototype dynamic pattern inputs", () => {
    const nullPrototypePart = Object.create(null) as BlockConditionalPartInput;
    nullPrototypePart.worldSpace = true;
    const nullPrototypePattern = Object.create(null) as BlockDynamicPatternInput;
    nullPrototypePattern.parts = [nullPrototypePart];

    const pattern = createBlockDynamicPattern(nullPrototypePattern);

    expect(pattern.parts).toEqual([
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);
    expect(pattern.parts[0].rule).not.toBe(BLOCK_RULE_NONE);
  });

  it("accepts frozen dynamic pattern inputs", () => {
    const frozenPart = Object.freeze({
      worldSpace: true,
    });
    const frozenPattern = Object.freeze({
      parts: Object.freeze([frozenPart]),
    });

    const pattern = createBlockDynamicPattern(frozenPattern);

    expect(pattern.parts).toEqual([
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);
    expect(pattern.parts[0].rule).not.toBe(BLOCK_RULE_NONE);
  });

  it("skips malformed dynamic pattern part entries", () => {
    const throwingPrototypeProxy = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype trap");
        },
      }
    );
    const pattern = createBlockDynamicPattern({
      parts: [
        undefined,
        null,
        new Date() as never,
        42 as never,
        [] as never,
        throwingPrototypeProxy as never,
        { worldSpace: true },
      ],
    });

    expect(pattern.parts).toEqual([
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);
    expect(pattern.parts[0].rule).not.toBe(BLOCK_RULE_NONE);
  });

  it("salvages iterator-trapped dynamic pattern part entries", () => {
    const parts: BlockConditionalPartInput[] = [{ worldSpace: true }];
    Object.defineProperty(parts, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const pattern = createBlockDynamicPattern({
      parts,
    });

    expect(pattern.parts).toEqual([
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);
  });

  it("sanitizes irrecoverable dynamic pattern part iterators", () => {
    const trappedParts = new Proxy([{ worldSpace: true }], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const pattern = createBlockDynamicPattern({
      parts: trappedParts as never,
    });

    expect(pattern.parts).toEqual([]);
  });

  it("ignores inherited numeric prototype part entries in fallback scans", () => {
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { worldSpace: true },
    });

    try {
      const trappedParts = new Proxy([] as Array<BlockConditionalPartInput>, {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const pattern = createBlockDynamicPattern({
        parts: trappedParts as never,
      });

      expect(pattern.parts).toEqual([]);
    } finally {
      delete (Array.prototype as Record<string, BlockConditionalPartInput>)["0"];
    }
  });

  it("supplements noisy prefix part entries with key fallback recovery", () => {
    const noisyParts: Array<BlockConditionalPartInput | number> = [];
    noisyParts[0] = 1;
    noisyParts[5_000] = { worldSpace: true };
    Object.defineProperty(noisyParts, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const pattern = createBlockDynamicPattern({
      parts: noisyParts as never,
    });

    expect(pattern.parts).toEqual([
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);
  });

  it("merges readable prefix and key-fallback part entries", () => {
    let prefixReadCount = 0;
    const sparseParts: BlockConditionalPartInput[] = [];
    sparseParts[0] = { worldSpace: false };
    sparseParts[5_000] = { worldSpace: true };
    const trappedParts = new Proxy(sparseParts, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          prefixReadCount += 1;
          if (prefixReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const pattern = createBlockDynamicPattern({
      parts: trappedParts as never,
    });

    expect(pattern.parts).toEqual([
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: false,
      },
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);
  });

  it("recovers key-based part entries when bounded direct reads throw", () => {
    const sparseParts: BlockConditionalPartInput[] = [];
    sparseParts[5_000] = { worldSpace: true };
    const trappedParts = new Proxy(sparseParts, {
      getOwnPropertyDescriptor(target, property) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          const numericIndex = Number(propertyKey);
          if (numericIndex >= 0 && numericIndex < 1_024) {
            throw new Error("descriptor trap");
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          if (propertyKey === "5000") {
            return target[5_000];
          }
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const pattern = createBlockDynamicPattern({
      parts: trappedParts as never,
    });

    expect(pattern.parts).toEqual([
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);
  });

  it("skips throwing key-fallback reads while salvaging part entries", () => {
    const sparseParts: BlockConditionalPartInput[] = [];
    sparseParts[0] = { worldSpace: false };
    sparseParts[5_000] = { worldSpace: true };
    const trappedParts = new Proxy(sparseParts, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        if (propertyKey === "0") {
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const pattern = createBlockDynamicPattern({
      parts: trappedParts as never,
    });

    expect(pattern.parts).toEqual([
      {
        rule: BLOCK_RULE_NONE,
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);
  });

  it("skips helper key enumeration when bounded part fallback is full", () => {
    let ownKeysCount = 0;
    const denseParts: BlockConditionalPartInput[] = [];
    for (let index = 0; index < 1_024; index += 1) {
      denseParts[index] = {};
    }
    denseParts[5_000] = { worldSpace: true };
    const trappedParts = new Proxy(denseParts, {
      ownKeys(target) {
        ownKeysCount += 1;
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const pattern = createBlockDynamicPattern({
      parts: trappedParts as never,
    });

    expect(pattern.parts).toHaveLength(1024);
    expect(
      pattern.parts.some((part) => {
        return part.worldSpace;
      })
    ).toBe(false);
    expect(ownKeysCount).toBe(0);
  });

  it("accepts partial dynamic pattern part inputs", () => {
    const sourceRule = {
      type: "simple" as const,
      offset: [2, 0, 0] as [number, number, number],
      id: 51,
    };
    const sourcePart = {
      rule: sourceRule,
      worldSpace: true,
    };
    const sourceParts: BlockConditionalPartInput[] = [sourcePart];
    const pattern = createBlockDynamicPattern({
      parts: sourceParts,
    });

    expect(pattern.parts).toEqual([
      {
        rule: {
          type: "simple",
          offset: [2, 0, 0],
          id: 51,
        },
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: true,
      },
    ]);

    sourceRule.offset[0] = 9;
    sourceRule.id = 99;
    sourcePart.worldSpace = false;
    sourceParts.push({});

    expect(pattern.parts).toHaveLength(1);
    expect(pattern.parts[0]).toEqual({
      rule: {
        type: "simple",
        offset: [2, 0, 0],
        id: 51,
      },
      faces: [],
      aabbs: [],
      isTransparent: [false, false, false, false, false, false],
      worldSpace: true,
    });
  });

  it("accepts BlockFaceInit values in dynamic pattern parts", () => {
    const faceInit: BlockFaceInit = {
      name: "PatternInitFace",
      dir: [1, 0, 0],
    };
    const pattern = createBlockDynamicPattern({
      parts: [
        {
          faces: [faceInit],
        },
      ],
    });

    expect(pattern.parts).toHaveLength(1);
    expect(pattern.parts[0].faces).toHaveLength(1);
    expect(pattern.parts[0].faces[0].name).toBe("PatternInitFace");
    expect(pattern.parts[0].faces[0].dir).toEqual([1, 0, 0]);

    faceInit.name = "MutatedPatternInitFace";
    if (faceInit.dir !== undefined) {
      faceInit.dir[0] = 9;
    }

    expect(pattern.parts[0].faces[0].name).toBe("PatternInitFace");
    expect(pattern.parts[0].faces[0].dir).toEqual([1, 0, 0]);
  });

  it("accepts readonly dynamic pattern part arrays", () => {
    const patternParts = [
      {
        rule: {
          type: "simple" as const,
          offset: [1, 0, 0] as [number, number, number],
          id: 60,
        },
      },
    ] as const;
    const pattern = createBlockDynamicPattern({
      parts: patternParts,
    });

    expect(pattern.parts).toEqual([
      {
        rule: {
          type: "simple",
          offset: [1, 0, 0],
          id: 60,
        },
        faces: [],
        aabbs: [],
        isTransparent: [false, false, false, false, false, false],
        worldSpace: false,
      },
    ]);
  });

  it("skips invalid nested face and aabb entries in dynamic pattern parts", () => {
    const validFaceInit: BlockFaceInit = {
      name: "ValidPatternFace",
    };
    const malformedFaceInstance = new BlockFace({ name: "MalformedPatternFace" });
    (malformedFaceInstance as { name: string | number }).name = 42;
    const validAabb = AABB.create(0, 0, 0, 1, 1, 1);
    const pattern = createBlockDynamicPattern({
      parts: [
        {
          faces: [
            undefined,
            null,
            { name: 42 } as never,
            malformedFaceInstance,
            validFaceInit,
          ],
          aabbs: [undefined, null, { clone: "not-a-function" } as never, validAabb],
        },
      ],
    });

    expect(pattern.parts).toHaveLength(1);
    expect(pattern.parts[0].faces).toHaveLength(1);
    expect(pattern.parts[0].faces[0].name).toBe("ValidPatternFace");
    expect(pattern.parts[0].aabbs).toHaveLength(1);
    expect(pattern.parts[0].aabbs[0]).toEqual(validAabb);
    expect(pattern.parts[0].aabbs[0]).not.toBe(validAabb);
  });

  it("accepts plain AABB init objects in dynamic pattern parts", () => {
    const sourceAabb = {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    };
    const pattern = createBlockDynamicPattern({
      parts: [
        {
          aabbs: [sourceAabb],
        },
      ],
    });

    expect(pattern.parts).toHaveLength(1);
    expect(pattern.parts[0].aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);

    sourceAabb.maxX = 9;
    expect(pattern.parts[0].aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
  });

  it("accepts null-prototype face init objects in dynamic pattern parts", () => {
    const nullPrototypeFace = Object.create(null) as {
      name: string;
      dir: [number, number, number];
    };
    nullPrototypeFace.name = "NullPrototypePatternFace";
    nullPrototypeFace.dir = [0, 1, 0];
    const pattern = createBlockDynamicPattern({
      parts: [
        {
          faces: [nullPrototypeFace],
        },
      ],
    });

    expect(pattern.parts).toHaveLength(1);
    expect(pattern.parts[0].faces).toEqual([
      new BlockFace({
        name: "NullPrototypePatternFace",
        dir: [0, 1, 0],
      }),
    ]);
  });

  it("accepts readonly AABB init literals in dynamic pattern parts", () => {
    const readonlyAabb = {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    } as const;
    const pattern = createBlockDynamicPattern({
      parts: [
        {
          aabbs: [readonlyAabb],
        },
      ],
    });

    expect(pattern.parts).toHaveLength(1);
    expect(pattern.parts[0].aabbs).toEqual([AABB.create(0, 0, 0, 1, 1, 1)]);
  });

  it("skips malformed AABB instances in dynamic pattern parts", () => {
    const malformedAabb = AABB.create(0, 0, 0, 1, 1, 1);
    malformedAabb.maxY = Number.NaN;
    const validAabb = AABB.create(1, 1, 1, 2, 2, 2);
    const pattern = createBlockDynamicPattern({
      parts: [
        {
          aabbs: [malformedAabb, validAabb],
        },
      ],
    });

    expect(pattern.parts).toHaveLength(1);
    expect(pattern.parts[0].aabbs).toEqual([validAabb]);
    expect(pattern.parts[0].aabbs[0]).not.toBe(validAabb);
  });

  it("clones dynamic pattern parts to avoid external mutation", () => {
    const sourcePart = createBlockConditionalPart({
      rule: {
        type: "simple",
        offset: [1, 0, 0],
        id: 50,
        rotation: BlockRotation.py(Math.PI / 2),
      },
      faces: [new BlockFace({ name: "PatternFace" })],
      aabbs: [AABB.create(0, 0, 0, 1, 1, 1)],
      isTransparent: [true, false, false, false, false, false],
      worldSpace: false,
    });
    const sourceParts = [sourcePart];
    const pattern = createBlockDynamicPattern({
      parts: sourceParts,
    });

    expect(pattern.parts).toHaveLength(1);
    expect(pattern.parts[0]).not.toBe(sourcePart);
    expect(pattern.parts[0].faces[0]).not.toBe(sourcePart.faces[0]);
    expect(pattern.parts[0].aabbs[0]).not.toBe(sourcePart.aabbs[0]);
    expect(pattern.parts[0].rule).not.toBe(sourcePart.rule);

    sourcePart.faces[0].name = "MutatedPatternFace";
    sourcePart.faces[0].dir[0] = 9;
    sourcePart.faces[0].corners[0].pos[0] = 9;
    sourcePart.faces[0].range.startU = 9;
    sourcePart.aabbs[0].maxX = 9;
    sourcePart.isTransparent[0] = false;
    if (sourcePart.rule.type !== "simple") {
      throw new Error("Expected simple rule in dynamic pattern source part");
    }
    sourcePart.rule.offset[0] = 9;
    sourcePart.rule.id = 77;
    if (
      sourcePart.rule.rotation !== undefined &&
      sourcePart.rule.rotation !== null
    ) {
      sourcePart.rule.rotation.axis = BlockRotation.PX().axis;
    }
    sourceParts.push(createBlockConditionalPart({}));

    const [clonedPart] = pattern.parts;
    expect(pattern.parts).toHaveLength(1);
    expect(clonedPart.faces[0].name).toBe("PatternFace");
    expect(clonedPart.faces[0].dir[0]).toBe(0);
    expect(clonedPart.faces[0].corners[0].pos[0]).toBe(0);
    expect(clonedPart.faces[0].range.startU).toBe(0);
    expect(clonedPart.aabbs[0].maxX).toBe(1);
    expect(clonedPart.isTransparent).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(clonedPart.rule).toEqual({
      type: "simple",
      offset: [1, 0, 0],
      id: 50,
      rotation: BlockRotation.py(Math.PI / 2),
    });
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

  it("supports createBlockFace helper with cloned init fields", () => {
    const initCorner = createCornerData([0, 0, 0], [0, 0]);
    const init: BlockFaceInit = {
      name: "HelperFace",
      dir: [1, 0, 0],
      corners: [initCorner, initCorner, initCorner, initCorner],
      range: createUV(0, 1, 2, 3),
    };
    const face = createBlockFace(init);

    expect(face).toBeInstanceOf(BlockFace);
    expect(face.name).toBe("HelperFace");
    expect(face.dir).toEqual([1, 0, 0]);
    expect(face.range).toEqual({
      startU: 0,
      endU: 1,
      startV: 2,
      endV: 3,
    });

    init.name = "MutatedHelperFace";
    if (init.dir !== undefined) {
      init.dir[0] = 9;
    }
    if (init.corners !== undefined) {
      init.corners[0].pos[0] = 9;
    }
    if (init.range !== undefined) {
      init.range.startU = 9;
    }

    expect(face.name).toBe("HelperFace");
    expect(face.dir).toEqual([1, 0, 0]);
    expect(face.corners[0].pos[0]).toBe(0);
    expect(face.range.startU).toBe(0);
  });

  it("supports createBlockFace helper with frozen init objects", () => {
    const frozenInit = Object.freeze({
      name: "FrozenFace",
      dir: [1, 0, 0] as const,
    });
    const face = createBlockFace(frozenInit);

    expect(face).toBeInstanceOf(BlockFace);
    expect(face.name).toBe("FrozenFace");
    expect(face.dir).toEqual([1, 0, 0]);
  });

  it("supports createBlockFace helper with null-prototype init objects", () => {
    const nullPrototypeInit = Object.create(null) as {
      name: string;
      dir: [number, number, number];
    };
    nullPrototypeInit.name = "NullPrototypeFace";
    nullPrototypeInit.dir = [0, 1, 0];

    const face = createBlockFace(nullPrototypeInit);

    expect(face).toBeInstanceOf(BlockFace);
    expect(face.name).toBe("NullPrototypeFace");
    expect(face.dir).toEqual([0, 1, 0]);
  });

  it("falls back to default when createBlockFace receives malformed BlockFace instances", () => {
    const malformedSourceFace = new BlockFace({ name: "SourceFace" });
    (malformedSourceFace as { name: string | number }).name = 42;

    expect(createBlockFace(malformedSourceFace)).toEqual(
      new BlockFace({ name: "Face" })
    );
  });

  it("falls back to default when createBlockFace receives prototype-throwing proxies", () => {
    const throwingPrototypeProxy = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype trap");
        },
      }
    );

    expect(createBlockFace(throwingPrototypeProxy as never)).toEqual(
      new BlockFace({ name: "Face" })
    );
  });

  it("falls back to default when createBlockFace receives getter-trap init objects", () => {
    const faceWithThrowingName = Object.create(null) as {
      readonly name: string;
    };
    Object.defineProperty(faceWithThrowingName, "name", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("name trap");
      },
    });

    expect(createBlockFace(faceWithThrowingName as never)).toEqual(
      new BlockFace({ name: "Face" })
    );
  });

  it("sanitizes malformed vector and corner access traps in createBlockFace", () => {
    const dirWithLengthTrap = new Proxy([1, 0, 0], {
      get: (target, property, receiver) => {
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const cornersWithIteratorTrap = [
      createCornerData([0, 0, 0], [0, 0]),
      createCornerData([1, 0, 0], [1, 0]),
      createCornerData([1, 1, 0], [1, 1]),
      createCornerData([0, 1, 0], [0, 1]),
    ];
    Object.defineProperty(cornersWithIteratorTrap, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });

    const face = createBlockFace({
      name: "TrapFace",
      dir: dirWithLengthTrap as never,
      corners: cornersWithIteratorTrap as never,
    });

    expect(face.name).toBe("TrapFace");
    expect(face.dir).toEqual([0, 0, 0]);
    expect(face.corners).toEqual([
      createCornerData([0, 0, 0], [0, 0]),
      createCornerData([1, 0, 0], [1, 0]),
      createCornerData([1, 1, 0], [1, 1]),
      createCornerData([0, 1, 0], [0, 1]),
    ]);
  });

  it("sanitizes irrecoverable corner collection traps in createBlockFace", () => {
    const trappedCorners = new Proxy(
      [
        createCornerData([0, 0, 0], [0, 0]),
        createCornerData([1, 0, 0], [1, 0]),
        createCornerData([1, 1, 0], [1, 1]),
        createCornerData([0, 1, 0], [0, 1]),
      ],
      {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );

    const face = createBlockFace({
      name: "TrapFace",
      corners: trappedCorners as never,
    });

    expect(face.corners).toEqual(
      new BlockFace({
        name: "Defaults",
      }).corners
    );
  });

  it("builds deterministic default faces for malformed createBlockFace input", () => {
    const defaultFace = createBlockFace();
    const nullFace = createBlockFace(null);
    const malformedFace = createBlockFace({
      name: 42,
    } as never);

    expect(defaultFace).toEqual(new BlockFace({ name: "Face" }));
    expect(nullFace).toEqual(new BlockFace({ name: "Face" }));
    expect(malformedFace).toEqual(new BlockFace({ name: "Face" }));
  });

  it("accepts BlockFace instances in createBlockFace and clones values", () => {
    const sourceFace = new BlockFace({
      name: "SourceFace",
      dir: [0, 1, 0],
      range: createUV(1, 2, 3, 4),
    });
    const clonedFace = createBlockFace(sourceFace);

    expect(clonedFace).toEqual(sourceFace);
    expect(clonedFace).not.toBe(sourceFace);

    sourceFace.name = "MutatedSourceFace";
    sourceFace.dir[1] = 9;
    sourceFace.range.endU = 9;

    expect(clonedFace.name).toBe("SourceFace");
    expect(clonedFace.dir).toEqual([0, 1, 0]);
    expect(clonedFace.range.endU).toBe(2);
  });

  it("falls back for non-plain face-like createBlockFace inputs", () => {
    class FaceLike {
      public readonly name = "FaceLike";
      public readonly dir: [number, number, number] = [1, 0, 0];
    }

    const fallbackFace = createBlockFace(new FaceLike());

    expect(fallbackFace).toEqual(new BlockFace({ name: "Face" }));
  });

  it("supports createAABB helper with cloned AABB values", () => {
    const sourceAabb = AABB.create(0, 0, 0, 1, 1, 1);
    const clonedAabb = createAABB(sourceAabb);

    expect(clonedAabb).toEqual(sourceAabb);
    expect(clonedAabb).not.toBe(sourceAabb);

    sourceAabb.maxX = 9;
    expect(clonedAabb.maxX).toBe(1);
  });

  it("supports createAABB helper with plain and null-prototype init objects", () => {
    const initAabb = {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    };
    const nullPrototypeInit = Object.create(null) as {
      [Key in keyof AABBInit]: number;
    };
    nullPrototypeInit.minX = 1;
    nullPrototypeInit.minY = 2;
    nullPrototypeInit.minZ = 3;
    nullPrototypeInit.maxX = 4;
    nullPrototypeInit.maxY = 5;
    nullPrototypeInit.maxZ = 6;

    const fromPlainInit = createAABB(initAabb);
    const fromNullPrototypeInit = createAABB(nullPrototypeInit);

    expect(fromPlainInit).toEqual(AABB.create(0, 0, 0, 1, 1, 1));
    expect(fromNullPrototypeInit).toEqual(AABB.create(1, 2, 3, 4, 5, 6));

    initAabb.maxX = 9;
    nullPrototypeInit.maxX = 9;

    expect(fromPlainInit.maxX).toBe(1);
    expect(fromNullPrototypeInit.maxX).toBe(4);
  });

  it("supports createAABB helper with frozen init objects", () => {
    const frozenInit = Object.freeze({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    });

    expect(createAABB(frozenInit)).toEqual(AABB.create(0, 0, 0, 1, 1, 1));
  });

  it("supports readonly AABB init literals in createAABB", () => {
    const readonlyInit = {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: 1,
      maxZ: 1,
    } as const;

    expect(createAABB(readonlyInit)).toEqual(AABB.create(0, 0, 0, 1, 1, 1));
  });

  it("falls back to empty AABB for malformed createAABB inputs", () => {
    class AabbLike {
      public readonly minX = 0;
      public readonly minY = 0;
      public readonly minZ = 0;
      public readonly maxX = 1;
      public readonly maxY = 1;
      public readonly maxZ = 1;
    }
    const malformedAabbInstance = AABB.create(0, 0, 0, 1, 1, 1);
    malformedAabbInstance.minZ = Number.NaN;
    const throwingPrototypeProxy = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype trap");
        },
      }
    );
    const aabbWithThrowingMinX = Object.create(null) as {
      readonly minX: number;
      readonly minY: number;
      readonly minZ: number;
      readonly maxX: number;
      readonly maxY: number;
      readonly maxZ: number;
    };
    Object.defineProperty(aabbWithThrowingMinX, "minX", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("minX trap");
      },
    });
    Object.defineProperty(aabbWithThrowingMinX, "minY", {
      configurable: true,
      enumerable: true,
      value: 0,
    });
    Object.defineProperty(aabbWithThrowingMinX, "minZ", {
      configurable: true,
      enumerable: true,
      value: 0,
    });
    Object.defineProperty(aabbWithThrowingMinX, "maxX", {
      configurable: true,
      enumerable: true,
      value: 1,
    });
    Object.defineProperty(aabbWithThrowingMinX, "maxY", {
      configurable: true,
      enumerable: true,
      value: 1,
    });
    Object.defineProperty(aabbWithThrowingMinX, "maxZ", {
      configurable: true,
      enumerable: true,
      value: 1,
    });

    expect(createAABB()).toEqual(AABB.empty());
    expect(createAABB(null)).toEqual(AABB.empty());
    expect(createAABB(new AabbLike() as never)).toEqual(AABB.empty());
    expect(createAABB(malformedAabbInstance)).toEqual(AABB.empty());
    expect(createAABB(throwingPrototypeProxy as never)).toEqual(AABB.empty());
    expect(createAABB(aabbWithThrowingMinX as never)).toEqual(AABB.empty());
    expect(
      createAABB({
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: Number.POSITIVE_INFINITY,
        maxY: 1,
        maxZ: 1,
      } as never)
    ).toEqual(AABB.empty());
  });

  it("supports createBlockRotation helper with cloned rotation values", () => {
    const sourceRotation = BlockRotation.py(Math.PI / 2);
    const clonedRotation = createBlockRotation(sourceRotation);

    expect(clonedRotation).toEqual(sourceRotation);
    expect(clonedRotation).not.toBe(sourceRotation);

    sourceRotation.axis = BlockRotation.PX().axis;
    sourceRotation.yRotation = 0;

    expect(clonedRotation).toEqual(BlockRotation.py(Math.PI / 2));
  });

  it("supports createBlockRotation helper with plain and null-prototype inputs", () => {
    const plainInput = {
      value: BlockRotation.PX().axis,
      yRotation: Math.PI / 2,
    } as const;
    const nullPrototypeInput = Object.create(null) as {
      [Key in keyof BlockRotationInput]: number;
    };
    nullPrototypeInput.value = BlockRotation.NZ().axis;
    nullPrototypeInput.yRotation = Math.PI;

    expect(createBlockRotation(plainInput)).toEqual(
      new BlockRotation(BlockRotation.PX().axis, Math.PI / 2)
    );
    expect(createBlockRotation(nullPrototypeInput)).toEqual(
      new BlockRotation(BlockRotation.NZ().axis, Math.PI)
    );
  });

  it("retains boundary createBlockRotation encoded values", () => {
    const boundaryRotation = createBlockRotation({
      value: 15,
      yRotation: Math.PI / 2,
    });

    expect(boundaryRotation).toEqual(new BlockRotation(15, Math.PI / 2));
  });

  it("supports createBlockRotation helper with frozen rotation init objects", () => {
    const frozenInput = Object.freeze({
      value: BlockRotation.PX().axis,
      yRotation: Math.PI / 2,
    });

    expect(createBlockRotation(frozenInput)).toEqual(
      new BlockRotation(BlockRotation.PX().axis, Math.PI / 2)
    );
  });

  it("falls back to identity for malformed createBlockRotation inputs", () => {
    class RotationLike {
      public readonly value = BlockRotation.PX().axis;
      public readonly yRotation = Math.PI / 2;
    }
    const malformedInstance = BlockRotation.py(Math.PI / 2);
    malformedInstance.axis = 16;
    const malformedYRotationInstance = BlockRotation.py(Math.PI / 2);
    malformedYRotationInstance.yRotation = Number.POSITIVE_INFINITY;
    const throwingPrototypeProxy = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype trap");
        },
      }
    );
    const valueTrapRotation = Object.create(null) as {
      readonly value: number;
      readonly yRotation: number;
    };
    Object.defineProperty(valueTrapRotation, "value", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("value trap");
      },
    });
    Object.defineProperty(valueTrapRotation, "yRotation", {
      configurable: true,
      enumerable: true,
      value: Math.PI / 2,
    });
    const proxyRotation = new Proxy(BlockRotation.py(Math.PI / 2), {
      get: (target, property, receiver) => {
        if (property === "value") {
          throw new Error("value trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(createBlockRotation()).toEqual(BlockRotation.py(0));
    expect(createBlockRotation(null)).toEqual(BlockRotation.py(0));
    expect(createBlockRotation(new RotationLike() as never)).toEqual(
      BlockRotation.py(0)
    );
    expect(
      createBlockRotation({
        value: -1,
        yRotation: Math.PI / 2,
      } as never)
    ).toEqual(BlockRotation.py(0));
    expect(
      createBlockRotation({
        value: 16,
        yRotation: Math.PI / 2,
      } as never)
    ).toEqual(BlockRotation.py(0));
    expect(
      createBlockRotation({
        value: 1.5,
        yRotation: Math.PI / 2,
      } as never)
    ).toEqual(BlockRotation.py(0));
    expect(
      createBlockRotation({
        value: BlockRotation.PX().axis,
        yRotation: Number.POSITIVE_INFINITY,
      } as never)
    ).toEqual(BlockRotation.py(0));
    expect(createBlockRotation(malformedInstance)).toEqual(BlockRotation.py(0));
    expect(createBlockRotation(malformedYRotationInstance)).toEqual(
      BlockRotation.py(0)
    );
    expect(createBlockRotation(throwingPrototypeProxy as never)).toEqual(
      BlockRotation.py(0)
    );
    expect(createBlockRotation(valueTrapRotation as never)).toEqual(
      BlockRotation.py(0)
    );
    expect(createBlockRotation(proxyRotation as never)).toEqual(
      BlockRotation.py(0)
    );
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

  it("treats null simple-rule fields as optional constraints", () => {
    const access = {
      getVoxel: () => 12,
      getVoxelRotation: () => BlockRotation.py(Math.PI / 2),
      getVoxelStage: () => 3,
    };
    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      id: null,
      rotation: null,
      stage: null,
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

  it("treats empty AND combinations as true", () => {
    const access = {
      getVoxel: () => 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const rule = {
      type: "combination" as const,
      logic: BlockRuleLogic.And,
      rules: [],
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(true);
  });

  it("treats empty OR combinations as false", () => {
    const access = {
      getVoxel: () => 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const rule = {
      type: "combination" as const,
      logic: BlockRuleLogic.Or,
      rules: [],
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(false);
  });

  it("treats cyclic AND/OR combination edges as deterministic matches", () => {
    const access = {
      getVoxel: () => 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };
    const andCycleRule = {
      type: "combination" as const,
      logic: BlockRuleLogic.And,
      rules: [] as BlockRule[],
    };
    andCycleRule.rules.push(andCycleRule);
    const orCycleRule = {
      type: "combination" as const,
      logic: BlockRuleLogic.Or,
      rules: [] as BlockRule[],
    };
    orCycleRule.rules.push(orCycleRule);

    expect(BlockRuleEvaluator.evaluate(andCycleRule, [0, 0, 0], access)).toBe(
      true
    );
    expect(BlockRuleEvaluator.evaluate(orCycleRule, [0, 0, 0], access)).toBe(true);
  });

  it("treats cyclic NOT combination edges as deterministic non-matches", () => {
    const access = {
      getVoxel: () => 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };
    const notCycleRule = {
      type: "combination" as const,
      logic: BlockRuleLogic.Not,
      rules: [] as BlockRule[],
    };
    notCycleRule.rules.push(notCycleRule);

    expect(BlockRuleEvaluator.evaluate(notCycleRule, [0, 0, 0], access)).toBe(
      false
    );
  });

  it("salvages indexed combination rules when iterator access traps", () => {
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 33 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };
    const iteratorTrapRules = new Proxy(
      [
        {
          type: "simple" as const,
          offset: [0, 0, 0] as [number, number, number],
          id: 33,
        },
      ],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: iteratorTrapRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
  });

  it("sanitizes malformed combination-rule collections to empty semantics", () => {
    const access = {
      getVoxel: () => 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };
    const malformedRules = new Proxy([BLOCK_RULE_NONE], {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.And,
          rules: malformedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: malformedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(false);
    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Not,
          rules: malformedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
  });

  it("salvages key-based combination entries when length access traps", () => {
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 34 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };
    const lengthTrapRules = new Proxy(
      [
        {
          type: "simple" as const,
          offset: [0, 0, 0] as [number, number, number],
          id: 34,
        },
      ],
      {
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            throw new Error("length trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: lengthTrapRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
  });

  it("caps combination length-fallback scans for iterator-trapped rule lists", () => {
    let indexedReadCount = 0;
    const oversizedRules = new Proxy([], {
      getOwnPropertyDescriptor(target, property) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          throw new Error("descriptor trap");
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          indexedReadCount += 1;
          if (propertyKey === "0") {
            return {
              type: "simple",
              offset: [0, 0, 0],
              id: 35,
            };
          }
          return undefined;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 35 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: oversizedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
    expect(indexedReadCount).toBe(1024);
  });

  it("recovers key-based rules when bounded direct-read probes throw", () => {
    const sparseRules: BlockRule[] = [];
    sparseRules[5_000] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 45,
    };
    const trappedRules = new Proxy(sparseRules, {
      getOwnPropertyDescriptor(target, property) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          const numericIndex = Number(propertyKey);
          if (numericIndex >= 0 && numericIndex < 1_024) {
            throw new Error("descriptor trap");
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1_000_000_000;
        }
        if (typeof propertyKey === "string" && /^(0|[1-9]\d*)$/.test(propertyKey)) {
          if (propertyKey === "5000") {
            return target[5_000];
          }
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 45 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: trappedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
  });

  it("skips throwing key-fallback rule reads instead of forcing none entries", () => {
    const sparseRules: BlockRule[] = [];
    sparseRules[0] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 46,
    };
    sparseRules[1] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 47,
    };
    const trappedRules = new Proxy(sparseRules, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        if (propertyKey === "0") {
          throw new Error("read trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 47 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.And,
          rules: trappedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
  });

  it("supplements none-only bounded prefixes with key-fallback recovery", () => {
    const noisyRules: Array<BlockRule | number> = [];
    noisyRules[0] = 1;
    noisyRules[5_000] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 39,
    };
    Object.defineProperty(noisyRules, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 39 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: noisyRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
  });

  it("supplements non-empty rule prefixes with key-fallback recovery", () => {
    const noisyRules: Array<BlockRule | number> = [];
    noisyRules[0] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 42,
    };
    noisyRules[5_000] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 43,
    };
    Object.defineProperty(noisyRules, Symbol.iterator, {
      configurable: true,
      enumerable: false,
      get: () => {
        throw new Error("iterator trap");
      },
    });
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 43 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: noisyRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
  });

  it("merges non-empty prefix and key-fallback rule recoveries", () => {
    let zeroReadCount = 0;
    const sparseRules: BlockRule[] = [];
    sparseRules[0] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 52,
    };
    sparseRules[5_000] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 53,
    };
    const trappedRules = new Proxy(sparseRules, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          zeroReadCount += 1;
          if (zeroReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 53 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: trappedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
  });

  it("preserves duplicate-value rule entries across fallback merging", () => {
    let zeroReadCount = 0;
    const duplicateRules: BlockRule[] = [];
    duplicateRules[0] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 54,
    };
    duplicateRules[5_000] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 54,
    };
    const trappedRules = new Proxy(duplicateRules, {
      get(target, property, receiver) {
        const propertyKey =
          typeof property === "number" ? String(property) : property;
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          return 1;
        }
        if (propertyKey === "0") {
          zeroReadCount += 1;
          if (zeroReadCount > 1) {
            throw new Error("read trap");
          }
        }
        return Reflect.get(target, property, receiver);
      },
    });
    let voxelReadCount = 0;
    const access = {
      getVoxel: () => {
        voxelReadCount += 1;
        return 0;
      },
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: trappedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(false);
    expect(voxelReadCount).toBe(2);
  });

  it("skips sparse hole placeholders during combination length fallback", () => {
    const sparseRules: BlockRule[] = [];
    sparseRules[1] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 37,
    };
    const trappedRules = new Proxy(sparseRules, {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const access = {
      getVoxel: () => 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: trappedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(false);
  });

  it("ignores inherited numeric prototype entries in combination fallback scans", () => {
    const inheritedRule: BlockRule = {
      type: "simple",
      offset: [0, 0, 0],
      id: 38,
    };
    Object.defineProperty(Array.prototype, "0", {
      configurable: true,
      enumerable: true,
      value: inheritedRule,
    });

    try {
      const trappedRules = new Proxy([] as BlockRule[], {
        ownKeys() {
          throw new Error("ownKeys trap");
        },
        get(target, property, receiver) {
          if (property === Symbol.iterator) {
            throw new Error("iterator trap");
          }
          if (property === "length") {
            return 1;
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const access = {
        getVoxel: () => 38,
        getVoxelRotation: () => BlockRotation.py(0),
        getVoxelStage: () => 0,
      };

      expect(
        BlockRuleEvaluator.evaluate(
          {
            type: "combination",
            logic: BlockRuleLogic.Or,
            rules: trappedRules as never,
          },
          [0, 0, 0],
          access
        )
      ).toBe(false);
    } finally {
      delete (Array.prototype as Record<string, BlockRule>)["0"];
    }
  });

  it("prefers smallest bounded indices during key-based rule fallback", () => {
    let numericReadCount = 0;
    let highIndexReadCount = 0;
    const keyFallbackRules: BlockRule[] = [];
    for (let index = 0; index < 1_024; index += 1) {
      keyFallbackRules[index] =
        index === 0
          ? {
              type: "simple",
              offset: [0, 0, 0],
              id: 36,
            }
          : BLOCK_RULE_NONE;
    }
    keyFallbackRules[1_000_000] = BLOCK_RULE_NONE;

    const trappedRules = new Proxy(keyFallbackRules, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        if (property === "length") {
          throw new Error("length trap");
        }
        if (property === "1000000") {
          highIndexReadCount += 1;
          throw new Error("high index should be excluded");
        }
        if (typeof property === "string" && /^(0|[1-9]\d*)$/.test(property)) {
          numericReadCount += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 36 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: trappedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
    expect(numericReadCount).toBe(1024);
    expect(highIndexReadCount).toBe(0);
  });

  it("skips key enumeration when bounded rule-length recovery is full", () => {
    let ownKeysCount = 0;
    const denseRules: BlockRule[] = [];
    for (let index = 0; index < 1_024; index += 1) {
      denseRules[index] = BLOCK_RULE_NONE;
    }
    denseRules[5_000] = {
      type: "simple",
      offset: [0, 0, 0],
      id: 41,
    };
    const trappedRules = new Proxy(denseRules, {
      ownKeys(target) {
        ownKeysCount += 1;
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          throw new Error("iterator trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 0 ? 41 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(
        {
          type: "combination",
          logic: BlockRuleLogic.Or,
          rules: trappedRules as never,
        },
        [0, 0, 0],
        access
      )
    ).toBe(true);
    expect(ownKeysCount).toBe(0);
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

  it("normalizes large full-turn y-rotations for y-rotatable offsets", () => {
    const rule = {
      type: "simple" as const,
      offset: [1000, 0, 0] as [number, number, number],
      id: 17,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 1000 && y === 0 && z === 0 ? 17 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(Math.PI * 2 * 1_000_000_000_000),
      yRotatable: true,
      worldSpace: false,
    });

    expect(matched).toBe(true);
  });

  it("normalizes large partial-turn y-rotations for y-rotatable offsets", () => {
    const rule = {
      type: "simple" as const,
      offset: [1000, 0, 0] as [number, number, number],
      id: 18,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 1000 ? 18 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(Math.PI / 2 + Math.PI * 2 * 1_000_000_000_000),
      yRotatable: true,
      worldSpace: false,
    });

    expect(matched).toBe(true);
  });

  it("normalizes large negative partial-turn y-rotations for y-rotatable offsets", () => {
    const rule = {
      type: "simple" as const,
      offset: [1000, 0, 0] as [number, number, number],
      id: 19,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === -1000 ? 19 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(-(Math.PI / 2) - Math.PI * 2 * 1_000_000_000_000),
      yRotatable: true,
      worldSpace: false,
    });

    expect(matched).toBe(true);
  });

  it("preserves large non-segment y-rotations for y-rotatable offsets", () => {
    const rotationAngle = 0.1 + Math.PI * 2 * 1_000_000_000_000;
    const normalizedAngle =
      ((rotationAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const expectedX = Math.round(1000 * Math.cos(normalizedAngle));
    const expectedZ = Math.round(1000 * Math.sin(normalizedAngle));
    const rule = {
      type: "simple" as const,
      offset: [1000, 0, 0] as [number, number, number],
      id: 20,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === expectedX && y === 0 && z === expectedZ ? 20 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(rotationAngle),
      yRotatable: true,
      worldSpace: false,
    });

    expect(expectedX).toBeLessThan(1000);
    expect(expectedZ).toBeGreaterThan(0);
    expect(matched).toBe(true);
  });

  it("avoids over-snapping very large non-segment y-rotations", () => {
    const rotationAngle = 0.1 + Math.PI * 2 * 100_000_000_000_000;
    const normalizedAngle =
      ((rotationAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const expectedX = Math.round(1000 * Math.cos(normalizedAngle));
    const expectedZ = Math.round(1000 * Math.sin(normalizedAngle));
    const rule = {
      type: "simple" as const,
      offset: [1000, 0, 0] as [number, number, number],
      id: 23,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === expectedX && y === 0 && z === expectedZ ? 23 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(rotationAngle),
      yRotatable: true,
      worldSpace: false,
    });

    expect(expectedX).toBeLessThan(1000);
    expect(expectedZ).toBeGreaterThan(0);
    expect(matched).toBe(true);
  });

  it("applies rotated offsets relative to non-origin positions", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 21,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 3 && y === 4 && z === 6 ? 21 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [3, 4, 5], access, {
      rotation: BlockRotation.py(Math.PI / 2),
      yRotatable: true,
      worldSpace: false,
    });

    expect(matched).toBe(true);
  });

  it("treats non-finite y-rotation offsets as identity for rules", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 22,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 1 && y === 0 && z === 0 ? 22 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    for (const angle of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
        rotation: BlockRotation.py(angle),
        yRotatable: true,
        worldSpace: false,
      });

      expect(matched).toBe(true);
    }
  });

  it("accepts plain rotation option objects for y-rotatable rules", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 24,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === 1 ? 24 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: { yRotation: Math.PI / 2 },
      yRotatable: true,
      worldSpace: false,
    });

    expect(matched).toBe(true);
  });

  it("sanitizes malformed rule-evaluation option values to deterministic defaults", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 25,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 1 && y === 0 && z === 0 ? 25 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: { yRotation: Number.NaN },
      yRotatable: "true" as never,
      worldSpace: "false" as never,
    });

    expect(matched).toBe(true);
  });

  it("guards option getter traps while evaluating rules", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 26,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 1 && y === 0 && z === 0 ? 26 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const trapOptions = new Proxy(
      {},
      {
        get(target, property, receiver) {
          if (
            property === "rotation" ||
            property === "yRotatable" ||
            property === "worldSpace"
          ) {
            throw new Error("options trap");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );

    const matched = BlockRuleEvaluator.evaluate(
      rule,
      [0, 0, 0],
      access,
      trapOptions as never
    );

    expect(matched).toBe(true);
  });

  it("guards malformed rotation-option getters for y-rotatable rules", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 27,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 1 && y === 0 && z === 0 ? 27 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const rotationWithTrap = Object.create(null) as BlockRuleEvaluationRotationInput;
    Object.defineProperty(rotationWithTrap, "yRotation", {
      configurable: true,
      enumerable: true,
      get: () => {
        throw new Error("yRotation trap");
      },
    });

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: rotationWithTrap,
      yRotatable: true,
      worldSpace: false,
    });

    expect(matched).toBe(true);
  });

  it("normalizes rule-evaluation options once for nested combinations", () => {
    const rule = {
      type: "combination" as const,
      logic: BlockRuleLogic.And,
      rules: [
        {
          type: "simple" as const,
          offset: [1, 0, 0] as [number, number, number],
          id: 28,
        },
        {
          type: "simple" as const,
          offset: [2, 0, 0] as [number, number, number],
          id: 29,
        },
      ],
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) => {
        if (x === 0 && y === 0 && z === 1) {
          return 28;
        }
        if (x === 0 && y === 0 && z === 2) {
          return 29;
        }
        return 0;
      },
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    let rotationReadCount = 0;
    const options = Object.create(null) as {
      readonly rotation: BlockRotation;
      readonly yRotatable: boolean;
      readonly worldSpace: boolean;
    };
    Object.defineProperty(options, "rotation", {
      configurable: true,
      enumerable: true,
      get: () => {
        rotationReadCount += 1;
        if (rotationReadCount > 1) {
          throw new Error("rotation option trap");
        }
        return BlockRotation.py(Math.PI / 2);
      },
    });
    Object.defineProperty(options, "yRotatable", {
      configurable: true,
      enumerable: true,
      value: true,
    });
    Object.defineProperty(options, "worldSpace", {
      configurable: true,
      enumerable: true,
      value: false,
    });

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, options);

    expect(matched).toBe(true);
    expect(rotationReadCount).toBe(1);
  });

  it("returns false when voxel id access throws during rule evaluation", () => {
    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      id: 30,
    };
    const access = {
      getVoxel: () => {
        throw new Error("getVoxel trap");
      },
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(false);
  });

  it("returns false when stage access throws during rule evaluation", () => {
    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      stage: 4,
    };
    const access = {
      getVoxel: () => 1,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => {
        throw new Error("getVoxelStage trap");
      },
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(false);
  });

  it("returns false when rotation access/comparison throws during rule evaluation", () => {
    const rule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      rotation: BlockRotation.py(0),
    };
    const rotationWithEqualsTrap = new Proxy(BlockRotation.py(0), {
      get(target, property, receiver) {
        if (property === "equals") {
          throw new Error("equals trap");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const access = {
      getVoxel: () => 1,
      getVoxelRotation: () => rotationWithEqualsTrap as never,
      getVoxelStage: () => 0,
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(false);
  });

  it("treats non-finite constrained coordinates as non-matches", () => {
    const malformedOffsetRule = {
      type: "simple" as const,
      offset: [Number.NaN, 0, 0] as [number, number, number],
      id: 31,
    };
    const malformedPositionRule = {
      type: "simple" as const,
      offset: [0, 0, 0] as [number, number, number],
      id: 32,
    };
    const access = {
      getVoxel: () => 32,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    expect(
      BlockRuleEvaluator.evaluate(malformedOffsetRule, [0, 0, 0], access)
    ).toBe(false);
    expect(
      BlockRuleEvaluator.evaluate(
        malformedPositionRule,
        [Number.NaN, 0, 0] as never,
        access
      )
    ).toBe(false);
  });

  it("keeps unconstrained malformed-coordinate rules as deterministic matches", () => {
    const rule = {
      type: "simple" as const,
      offset: [Number.NaN, 0, 0] as [number, number, number],
    };
    let getVoxelCalls = 0;
    let getVoxelRotationCalls = 0;
    let getVoxelStageCalls = 0;
    const access = {
      getVoxel: () => {
        getVoxelCalls += 1;
        return 0;
      },
      getVoxelRotation: () => {
        getVoxelRotationCalls += 1;
        return BlockRotation.py(0);
      },
      getVoxelStage: () => {
        getVoxelStageCalls += 1;
        return 0;
      },
    };

    expect(BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access)).toBe(true);
    expect(getVoxelCalls).toBe(0);
    expect(getVoxelRotationCalls).toBe(0);
    expect(getVoxelStageCalls).toBe(0);
  });

  it("rotates offsets for negative y-rotation values", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 14,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 0 && y === 0 && z === -1 ? 14 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(-Math.PI / 2),
      yRotatable: true,
      worldSpace: false,
    });

    expect(matched).toBe(true);
  });

  it("rounds rotated offsets when y-rotation yields fractional components", () => {
    const rule = {
      type: "simple" as const,
      offset: [1, 0, 0] as [number, number, number],
      id: 15,
    };

    const access = {
      getVoxel: (x: number, y: number, z: number) =>
        x === 1 && y === 0 && z === 1 ? 15 : 0,
      getVoxelRotation: () => BlockRotation.py(0),
      getVoxelStage: () => 0,
    };

    const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access, {
      rotation: BlockRotation.py(Math.PI / 4),
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
