import { AABB } from "@voxelize/aabb";
import { describe, expect, it } from "vitest";

import { BlockRotation, PY_ROTATION, PZ_ROTATION } from "./block";

/** The 3-wide, 2-tall wall panel box: x -1..2, y 0..2, z 0..0.22. */
const panelBox = () => new AABB(-1, 0, 0, 2, 2, 0.22);
/** A plain unit cube, the case the snap-to-zero was written for. */
const unitBox = () => new AABB(0, 0, 0, 1, 1, 1);

const near = (value: number, expected: number) =>
  expect(value).toBeCloseTo(expected, 6);

describe("BlockRotation.rotateAABB", () => {
  it("returns a copy for the identity rotation", () => {
    const rotated = new BlockRotation(PY_ROTATION, 0).rotateAABB(panelBox());
    near(rotated.minX, -1);
    near(rotated.maxX, 2);
    near(rotated.minZ, 0);
    near(rotated.maxZ, 0.22);
  });

  it.each([
    [4, "quarter turn"],
    [8, "half turn"],
    [12, "three-quarter turn"],
  ])(
    "keeps a box that reaches outside its voxel intact after a %s",
    (segments) => {
      const rotation = BlockRotation.encode(PY_ROTATION, segments);
      const rotated = rotation.rotateAABB(panelBox());
      // A box centred on x = 0.5 stays three voxels wide about the anchor's
      // centre whichever way it turns; the negative side must survive.
      if (segments === 8) {
        near(rotated.minX, -1);
        near(rotated.maxX, 2);
        near(rotated.minZ, 0.78);
        near(rotated.maxZ, 1);
      } else {
        near(rotated.minZ, -1);
        near(rotated.maxZ, 2);
        near(rotated.width, 0.22);
      }
      near(rotated.minY, 0);
      near(rotated.maxY, 2);
    },
  );

  it("still snaps rotation dust on a unit cube to exact bounds", () => {
    const rotation = BlockRotation.encode(PY_ROTATION, 4);
    const rotated = rotation.rotateAABB(unitBox());
    expect(rotated.minX).toBe(0);
    expect(rotated.minZ).toBe(0);
    near(rotated.maxX, 1);
    near(rotated.maxZ, 1);
  });

  it("keeps the negative side through an axis rotation too", () => {
    const rotated = new BlockRotation(PZ_ROTATION, 0).rotateAABB(panelBox());
    near(rotated.minX, -1);
    near(rotated.maxX, 2);
  });
});
