import assert from "node:assert/strict";

import * as THREE from "three";
import { describe, it } from "vitest";

import { BoneTextureManager } from "./bone-texture-manager";

/// The slot-by-slot identity write the constructor used to do, kept as the
/// reference the fast fill must match byte for byte.
function referenceIdentityData(
  manager: BoneTextureManager,
  maxInstances: number,
  bonesPerInstance: number,
): Uint16Array {
  const data = new Uint16Array(manager.getWidth() * manager.getHeight() * 4);
  const identity = new THREE.Matrix4().elements;
  for (let slot = 0; slot < maxInstances * bonesPerInstance; slot++) {
    for (let i = 0; i < 16; i++) {
      data[slot * 16 + i] = THREE.DataUtils.toHalfFloat(identity[i]);
    }
  }
  return data;
}

function dirtyRange(manager: BoneTextureManager): [number, number] {
  const internals = manager as unknown as {
    dirtyMinPixel: number;
    dirtyMaxPixel: number;
  };
  return [internals.dirtyMinPixel, internals.dirtyMaxPixel];
}

describe("BoneTextureManager", () => {
  it("starts every bone slot at identity, and nothing past them", () => {
    for (const [maxInstances, bones] of [
      [1, 1],
      [1, 3],
      [3, 1],
      [7, 5],
      [1000, 194],
      [1000, 10],
      [300, 7],
    ]) {
      const manager = new BoneTextureManager(maxInstances, bones);
      const data = manager.getTexture().image.data as Uint16Array;
      const expected = referenceIdentityData(manager, maxInstances, bones);
      assert.equal(data.length, expected.length);
      assert.ok(
        Buffer.from(data.buffer).equals(Buffer.from(expected.buffer)),
        `${maxInstances}x${bones}: bone texture differs from slot-by-slot identity`,
      );
      assert.deepEqual(dirtyRange(manager), [0, maxInstances * bones * 4 - 1]);
    }
  });

  it("resets a slot to identity when it is allocated and freed", () => {
    const manager = new BoneTextureManager(4, 3);
    const data = manager.getTexture().image.data as Uint16Array;
    const pristine = data.slice();
    const slot = manager.allocate();
    const moved = new THREE.Matrix4().makeTranslation(1, 2, 3);
    for (let bone = 0; bone < 3; bone++) {
      manager.setBoneMatrix(slot, bone, moved);
    }
    assert.ok(!Buffer.from(data.buffer).equals(Buffer.from(pristine.buffer)));
    manager.free(slot);
    assert.ok(Buffer.from(data.buffer).equals(Buffer.from(pristine.buffer)));
    manager.allocate();
    assert.ok(Buffer.from(data.buffer).equals(Buffer.from(pristine.buffer)));
  });
});
