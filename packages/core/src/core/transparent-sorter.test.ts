import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
} from "three";
import { describe, expect, it } from "vitest";

import {
  prepareTransparentMesh,
  sortTransparentMesh,
  transparentSortStats,
} from "./transparent-sorter";

function makeQuadMesh(
  quads: { axis: 0 | 1 | 2; offset: number; u: number; v: number }[],
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const { axis, offset, u, v } of quads) {
    const base = positions.length / 3;
    for (const [du, dv] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      const vertex = [0, 0, 0];
      vertex[axis] = offset;
      vertex[(axis + 1) % 3] = u + du;
      vertex[(axis + 2) % 3] = v + dv;
      positions.push(...vertex);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  return new Mesh(geometry, new MeshBasicMaterial({ transparent: true }));
}

describe("prepareTransparentMesh classification", () => {
  it("classifies coplanar faces as single-plane", () => {
    const mesh = makeQuadMesh([
      { axis: 1, offset: 4, u: 0, v: 0 },
      { axis: 1, offset: 4, u: 2, v: 5 },
      { axis: 1, offset: 4, u: 7, v: 1 },
    ]);
    const data = prepareTransparentMesh(mesh);
    expect(data?.classification).toBe("single-plane");
  });

  it("classifies multi-plane axis-aligned faces as plane-triggers", () => {
    const mesh = makeQuadMesh([
      { axis: 1, offset: 4, u: 0, v: 0 },
      { axis: 1, offset: 8, u: 0, v: 0 },
      { axis: 0, offset: 2, u: 0, v: 0 },
    ]);
    const data = prepareTransparentMesh(mesh);
    expect(data?.classification).toBe("plane-triggers");
    expect(data?.planesByAxis[0]).toEqual([2]);
    expect(data?.planesByAxis[1]).toEqual([4, 8]);
    expect(data?.planesByAxis[2]).toEqual([]);
  });

  it("falls back to distance for non-axis-aligned faces", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1]),
        3,
      ),
    );
    geometry.setIndex(
      new BufferAttribute(new Uint32Array([0, 1, 2, 0, 2, 3]), 1),
    );
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({ transparent: true }),
    );
    const data = prepareTransparentMesh(mesh);
    expect(data?.classification).toBe("distance");
  });
});

describe("plane-crossing sort triggers", () => {
  it("sorts once per interval and again only after crossing a plane", () => {
    const mesh = makeQuadMesh([
      { axis: 1, offset: 4, u: 0, v: 0 },
      { axis: 1, offset: 8, u: 0, v: 0 },
    ]);
    const data = prepareTransparentMesh(mesh);
    if (!data) throw new Error("expected sort data");
    const camera = new PerspectiveCamera();

    const sortsBefore = transparentSortStats.count;

    camera.position.set(0.5, 2, 0.5);
    camera.updateMatrixWorld();
    sortTransparentMesh(mesh, data, camera);
    expect(transparentSortStats.count).toBe(sortsBefore + 1);

    // Long move inside the same interval: no re-sort.
    camera.position.set(30, 3.5, 30);
    camera.updateMatrixWorld();
    sortTransparentMesh(mesh, data, camera);
    expect(transparentSortStats.count).toBe(sortsBefore + 1);

    // Crossing y=4 flips the painter's order: re-sort.
    camera.position.set(30, 5, 30);
    camera.updateMatrixWorld();
    sortTransparentMesh(mesh, data, camera);
    expect(transparentSortStats.count).toBe(sortsBefore + 2);
  });

  it("orders faces back-to-front across the crossed plane", () => {
    const mesh = makeQuadMesh([
      { axis: 1, offset: 4, u: 0, v: 0 },
      { axis: 1, offset: 8, u: 0, v: 0 },
    ]);
    const data = prepareTransparentMesh(mesh);
    if (!data) throw new Error("expected sort data");
    const camera = new PerspectiveCamera();

    camera.position.set(0.5, 20, 0.5);
    camera.updateMatrixWorld();
    sortTransparentMesh(mesh, data, camera);

    const indexArray = mesh.geometry.index?.array;
    if (!indexArray) throw new Error("expected index");
    // Above both planes, the y=4 face (vertices 0-3) must draw first.
    expect(indexArray[0]).toBeLessThan(4);
  });
});
