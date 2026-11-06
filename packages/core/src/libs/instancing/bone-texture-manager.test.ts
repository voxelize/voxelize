import assert from "node:assert/strict";

import * as THREE from "three/webgpu";
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
  it("writes a bone as the half floats three would, natively", () => {
    const manager = new BoneTextureManager(2, 3);
    const data = manager.getTexture().image.data as Uint16Array;
    const slot = manager.allocate();
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(1.37, -0.002, 2049.5),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.1, 2.4)),
      new THREE.Vector3(0.75, 1.25, 1e-5),
    );
    manager.setBoneMatrix(slot, 2, matrix);
    const offset = (slot * 3 + 2) * 16;
    for (let i = 0; i < 16; i++) {
      const written = THREE.DataUtils.fromHalfFloat(data[offset + i]);
      const reference = THREE.DataUtils.fromHalfFloat(
        THREE.DataUtils.toHalfFloat(matrix.elements[i]),
      );
      // Native conversion rounds to nearest; three's truncates. Either is
      // within one half-float step of the value.
      const step = Math.max(Math.abs(reference) * 2 ** -10, 2 ** -24);
      assert.ok(
        Math.abs(written - matrix.elements[i]) <= step,
        `element ${i}: ${written} vs ${matrix.elements[i]}`,
      );
      assert.ok(Math.abs(written - reference) <= step);
    }
  });
});
