import { AABB } from "@voxelize/aabb";
import { describe, expect, it } from "vitest";

import { raycast, raycastAABB } from ".";

const unitBlockAt = (x: number, y: number, z: number) =>
  new AABB(x, y, z, x + 1, y + 1, z + 1);

describe("raycastAABB", () => {
  it("hits a block straight ahead at the near face", () => {
    const hit = raycastAABB([0.5, 0.5, 0.5], [1, 0, 0], unitBlockAt(3, 0, 0));
    expect(hit).toEqual({ axis: 0, distance: 2.5 });
  });

  it("stays finite when the origin sits exactly on a face plane of a zero-component axis", () => {
    // Facing +x with no z component, standing on the z = 40 voxel boundary:
    // the old slab test divided (minZ - originZ) = 0 by nz = 0 and produced
    // a NaN "hit". A NaN distance reached the third-person camera and put the
    // whole camera rig (audio listener included) at NaN.
    const hit = raycastAABB([10, 0.5, 40], [1, 0, 0], unitBlockAt(12, 0, 40));
    expect(hit).toEqual({ axis: 0, distance: 2 });
  });

  it("misses a block the ray runs alongside on a zero-component axis", () => {
    const hit = raycastAABB([10, 0.5, 41.5], [1, 0, 0], unitBlockAt(12, 0, 40));
    expect(hit).toBeNull();
  });

  it("reports the exit face when the origin is inside the block", () => {
    const hit = raycastAABB([0.5, 0.5, 0.5], [0, 0, 1], unitBlockAt(0, 0, 0));
    expect(hit).toEqual({ axis: 2, distance: 0.5 });
  });

  it("respects the max distance", () => {
    expect(
      raycastAABB([0.5, 0.5, 0.5], [1, 0, 0], unitBlockAt(3, 0, 0), 2),
    ).toBeNull();
  });
});

describe("raycast", () => {
  it("walks the grid to the first solid voxel and returns a finite hit point", () => {
    const solid = new Set(["12,0,40"]);
    const result = raycast(
      (vx, vy, vz) =>
        solid.has(`${vx},${vy},${vz}`) ? [unitBlockAt(vx, vy, vz)] : [],
      [10, 0.5, 40],
      [1, 0, 0],
      8,
    );
    expect(result).toEqual({
      point: [12, 0.5, 40],
      normal: [-1, 0, 0],
      voxel: [12, 0, 40],
    });
  });

  it("returns null past the max distance", () => {
    const result = raycast(() => [], [0, 0, 0], [1, 0, 0], 4);
    expect(result).toBeNull();
  });
});
