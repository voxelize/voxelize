import { Object3D } from "three";
import { describe, expect, it } from "vitest";

import type { World } from "../core/world";

import { VoxelInteract } from "./voxel-interact";

/** A world with one solid block, straight in front of the camera. */
function worldWithOneBlock(): World {
  return {
    raycastVoxels: () => ({
      voxel: [1, 2, 3],
      normal: [0, 1, 0],
      point: [1.5, 3, 3.5],
    }),
    getVoxelAt: () => 1,
    getAABBOverride: () => undefined,
    getAABBOverrideOwner: () => undefined,
    getBlockAt: () => null,
  } as unknown as World;
}

describe("VoxelInteract", () => {
  it("keeps targeting with the highlight hidden, so whatever reads the target still works", () => {
    const interact = new VoxelInteract(new Object3D(), worldWithOneBlock());
    interact.isHighlightHidden = true;
    interact.update();
    expect(interact.target).toEqual([1, 2, 3]);
    expect(interact.visible).toBe(false);

    interact.isHighlightHidden = false;
    interact.update();
    expect(interact.target).toEqual([1, 2, 3]);
    expect(interact.visible).toBe(true);
  });

  it("stops targeting altogether when toggled off", () => {
    const interact = new VoxelInteract(new Object3D(), worldWithOneBlock());
    interact.toggle(false);
    interact.update();
    expect(interact.target).toBeNull();
    expect(interact.visible).toBe(false);

    interact.isHighlightHidden = true;
    interact.toggle(true);
    expect(interact.visible).toBe(false);
    interact.update();
    expect(interact.target).toEqual([1, 2, 3]);
  });
});
