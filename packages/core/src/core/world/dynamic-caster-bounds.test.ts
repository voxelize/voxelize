import {
  Box3,
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
} from "three";
import { describe, expect, it } from "vitest";

import {
  boundsIntersectSphere,
  computePoolCasterBounds,
} from "./dynamic-caster-bounds";

const makePool = (positions: [number, number, number][], capacity = 8) => {
  const pool = new Group();
  const mesh = new InstancedMesh(
    new BufferGeometry(),
    new MeshBasicMaterial(),
    capacity,
  );
  const zero = new Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < capacity; i++) mesh.setMatrixAt(i, zero);
  const matrix = new Matrix4();
  positions.forEach(([x, y, z], i) => {
    matrix.makeTranslation(x, y, z);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.count = positions.length;
  pool.add(mesh);
  return pool;
};

describe("computePoolCasterBounds", () => {
  it("folds live instance positions and ignores zero-scale slots", () => {
    const pool = makePool([
      [10, 64, -5],
      [20, 66, 15],
    ]);
    // A freed slot inside the active count range: zero-scale must not fold.
    const mesh = pool.children[0] as InstancedMesh;
    mesh.setMatrixAt(1, new Matrix4().makeScale(0, 0, 0));
    mesh.setMatrixAt(2, new Matrix4().makeTranslation(20, 66, 15));
    mesh.count = 3;

    const bounds = computePoolCasterBounds(pool, new Box3());
    expect(bounds.isEmpty()).toBe(false);
    expect(bounds.min.x).toBe(10);
    expect(bounds.max.x).toBe(20);
    expect(bounds.min.y).toBe(64);
    expect(bounds.max.y).toBe(66);
    expect(bounds.min.z).toBe(-5);
    expect(bounds.max.z).toBe(15);
  });

  it("reports an empty box for a pool with no live instances", () => {
    const bounds = computePoolCasterBounds(makePool([]), new Box3());
    expect(bounds.isEmpty()).toBe(true);
  });

  it("skips invisible subtrees", () => {
    const pool = makePool([[5, 5, 5]]);
    pool.children[0].visible = false;
    const bounds = computePoolCasterBounds(pool, new Box3());
    expect(bounds.isEmpty()).toBe(true);
  });
});

describe("boundsIntersectSphere", () => {
  it("never intersects an empty box", () => {
    expect(boundsIntersectSphere(new Box3(), 0, 0, 0, 1000, 10)).toBe(false);
  });

  it("applies the caster body margin outside the raw radius", () => {
    const bounds = computePoolCasterBounds(makePool([[20, 0, 0]]), new Box3());
    // Light at origin with range 13: instance origin at 20 is out of the
    // bare radius and a 1.6-block body margin does not close a 5.4-block gap.
    expect(boundsIntersectSphere(bounds, 0, 0, 0, 13, 1.6)).toBe(false);
    // At 14 blocks the 1.6 margin closes it.
    expect(
      boundsIntersectSphere(
        computePoolCasterBounds(makePool([[14, 0, 0]]), new Box3()),
        0,
        0,
        0,
        13,
        1.6,
      ),
    ).toBe(true);
  });
});
