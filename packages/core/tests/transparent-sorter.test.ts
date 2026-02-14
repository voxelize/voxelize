import { describe, expect, it } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

import {
  prepareTransparentMesh,
  sortTransparentMesh,
  sortTransparentMeshOnBeforeRender,
} from "../src/core/transparent-sorter";

const createQuadGeometry = (quadCount: number) => {
  const geometry = new BufferGeometry();
  const vertexCount = quadCount * 4;
  const positions = new Float32Array(vertexCount * 3);
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    const offset = vertexIndex * 3;
    positions[offset] = vertexIndex;
    positions[offset + 1] = 0;
    positions[offset + 2] = 0;
  }

  const indices = new Uint16Array(quadCount * 6);
  for (let quadIndex = 0; quadIndex < quadCount; quadIndex++) {
    const baseVertex = quadIndex * 4;
    const baseIndex = quadIndex * 6;
    indices[baseIndex] = baseVertex;
    indices[baseIndex + 1] = baseVertex + 1;
    indices[baseIndex + 2] = baseVertex + 2;
    indices[baseIndex + 3] = baseVertex;
    indices[baseIndex + 4] = baseVertex + 2;
    indices[baseIndex + 5] = baseVertex + 3;
  }

  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return geometry;
};

describe("transparent sorter", () => {
  it("skips sort setup for single-face geometry", () => {
    const mesh = new Mesh(createQuadGeometry(1), new MeshBasicMaterial());
    expect(prepareTransparentMesh(mesh)).toBeNull();
  });

  it("returns null when geometry has no position attribute", () => {
    const geometry = new BufferGeometry();
    geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    const mesh = new Mesh(geometry, new MeshBasicMaterial());

    expect(prepareTransparentMesh(mesh)).toBeNull();
  });

  it("returns early when mesh index buffer no longer matches sort data", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    const replacementIndex = new Uint16Array([
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
    ]);
    mesh.geometry.setIndex(new BufferAttribute(replacementIndex, 1));

    const before = Array.from(replacementIndex);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);

    expect(() => sortTransparentMesh(mesh, sortData, camera)).not.toThrow();
    expect(Array.from(replacementIndex)).toEqual(before);
  });

  it("refreshes transparent sort data when geometry index changes", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    const replacementIndex = new Uint16Array([
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
    ]);
    mesh.geometry.setIndex(new BufferAttribute(replacementIndex, 1));
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);

    sortTransparentMeshOnBeforeRender.call(
      mesh,
      {} as WebGLRenderer,
      new Scene(),
      camera
    );

    const refreshedSortData = mesh.userData.transparentSortData;
    expect(refreshedSortData).not.toBe(sortData);
    expect(refreshedSortData.sortedIndices).toBe(mesh.geometry.index?.array);
  });

  it("clears sorting callback when refreshed geometry no longer needs sorting", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    mesh.geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);

    sortTransparentMeshOnBeforeRender.call(
      mesh,
      {} as WebGLRenderer,
      new Scene(),
      camera
    );

    expect(mesh.userData.transparentSortData).toBeUndefined();
    expect(mesh.onBeforeRender).toBe(Object3D.prototype.onBeforeRender);
  });
});
