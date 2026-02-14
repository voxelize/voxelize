import { describe, expect, it } from "vitest";
import {
  BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";

import {
  prepareTransparentMesh,
  setupTransparentSorting,
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

  it("returns null when geometry position attribute is not vec3", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          0, 0, 1, 0, 0, 1, 1, 1,
        ]),
        2
      )
    );
    geometry.setIndex(
      new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3]), 1)
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());

    expect(prepareTransparentMesh(mesh)).toBeNull();
  });

  it("returns null when vec3 position attribute length is malformed", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          0, 0, 0, 1, 0, 0, 0, 1, 0, 1,
        ]),
        3
      )
    );
    geometry.setIndex(
      new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3]), 1)
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());

    expect(prepareTransparentMesh(mesh)).toBeNull();
  });

  it("returns null when centroid coordinates are non-finite", () => {
    const geometry = createQuadGeometry(2);
    const positionAttr = geometry.getAttribute("position");
    const positions = positionAttr.array as Float32Array;
    positions[0] = Number.NaN;
    const mesh = new Mesh(geometry, new MeshBasicMaterial());

    expect(prepareTransparentMesh(mesh)).toBeNull();
  });

  it("returns null when geometry indices are not quad-aligned", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0,
        ]),
        3
      )
    );
    geometry.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 2, 3, 4]), 1));
    const mesh = new Mesh(geometry, new MeshBasicMaterial());

    expect(prepareTransparentMesh(mesh)).toBeNull();
  });

  it("supports tightly packed vec4 position attributes by reading xyz", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          0, 0, 0, 99,
          3, 0, 0, 98,
          0, 3, 0, 97,
          3, 3, 0, 96,
          10, 0, 0, 95,
          13, 0, 0, 94,
          10, 3, 0, 93,
          13, 3, 0, 92,
        ]),
        4
      )
    );
    geometry.setIndex(
      new BufferAttribute(
        new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
        1
      )
    );

    const sortData = prepareTransparentMesh(new Mesh(geometry, new MeshBasicMaterial()));
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }
    expect(sortData.centroids[0]).toBeCloseTo(1);
    expect(sortData.centroids[1]).toBeCloseTo(1);
    expect(sortData.centroids[2]).toBeCloseTo(0);
  });

  it("supports interleaved position attributes with non-zero offsets", () => {
    const geometry = new BufferGeometry();
    const interleaved = new InterleavedBuffer(
      new Float32Array([
        99, 0, 0, 0,
        98, 3, 0, 0,
        97, 0, 3, 0,
        96, 3, 3, 0,
        95, 10, 0, 0,
        94, 13, 0, 0,
        93, 10, 3, 0,
        92, 13, 3, 0,
      ]),
      4
    );
    geometry.setAttribute("position", new InterleavedBufferAttribute(interleaved, 3, 1));
    geometry.setIndex(
      new BufferAttribute(
        new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
        1
      )
    );

    const sortData = prepareTransparentMesh(new Mesh(geometry, new MeshBasicMaterial()));
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }
    expect(sortData.centroids[0]).toBeCloseTo(1);
    expect(sortData.centroids[1]).toBeCloseTo(1);
    expect(sortData.centroids[2]).toBeCloseTo(0);
  });

  it("returns null when geometry indices reference missing vertices", () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([
          0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0,
        ]),
        3
      )
    );
    geometry.setIndex(
      new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 99, 0, 1, 2, 0, 2, 3]), 1)
    );
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

  it("returns early when camera world position is non-finite", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    const geometryIndex = mesh.geometry.index;
    expect(geometryIndex).not.toBeNull();
    if (!geometryIndex) {
      return;
    }

    const before = Array.from(geometryIndex.array);
    const camera = new PerspectiveCamera();
    camera.position.set(Number.NaN, 0, 10);
    camera.updateMatrixWorld(true);
    mesh.updateMatrixWorld(true);

    sortTransparentMesh(mesh, sortData, camera);

    expect(Array.from(geometryIndex.array)).toEqual(before);
    expect(sortData.lastCameraPos.x).toBe(Infinity);
    expect(sortData.lastCameraPos.y).toBe(Infinity);
    expect(sortData.lastCameraPos.z).toBe(Infinity);
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

  it("refreshes transparent sort data when geometry index version changes", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    const geometryIndex = mesh.geometry.index;
    expect(geometryIndex).not.toBeNull();
    if (!geometryIndex) {
      return;
    }
    geometryIndex.needsUpdate = true;
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
    expect(refreshedSortData.indexVersion).toBeGreaterThan(sortData.indexVersion);
    expect(refreshedSortData.indexVersion).toBeLessThanOrEqual(geometryIndex.version);
  });

  it("does not refresh transparent sort data after sorter-owned index updates", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);

    sortTransparentMeshOnBeforeRender.call(
      mesh,
      {} as WebGLRenderer,
      new Scene(),
      camera
    );
    const sortDataAfterFirstRender = mesh.userData.transparentSortData;
    camera.position.set(0, 0, 11);

    sortTransparentMeshOnBeforeRender.call(
      mesh,
      {} as WebGLRenderer,
      new Scene(),
      camera
    );

    expect(mesh.userData.transparentSortData).toBe(sortDataAfterFirstRender);
  });

  it("refreshes transparent sort data when position attribute changes", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    const newPositions = new Float32Array(sortData.faceCount * 12);
    for (let index = 0; index < newPositions.length; index++) {
      newPositions[index] = index;
    }
    mesh.geometry.setAttribute("position", new BufferAttribute(newPositions, 3));
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
    expect(refreshedSortData.positionArray).toBe(
      mesh.geometry.getAttribute("position").array
    );
  });

  it("refreshes transparent sort data when position attribute version changes", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    const positionAttr = mesh.geometry.getAttribute("position");
    positionAttr.needsUpdate = true;
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
    expect(refreshedSortData.positionVersion).toBe(positionAttr.version);
  });

  it("skips direct transparent sort when cached position version is stale", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    const geometryIndex = mesh.geometry.index;
    expect(geometryIndex).not.toBeNull();
    if (!geometryIndex) {
      return;
    }
    const before = Array.from(geometryIndex.array);
    const positionAttr = mesh.geometry.getAttribute("position");
    positionAttr.needsUpdate = true;
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);

    sortTransparentMesh(mesh, sortData, camera);

    expect(Array.from(geometryIndex.array)).toEqual(before);
  });

  it("skips direct transparent sort when cached index version is stale", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    const geometryIndex = mesh.geometry.index;
    expect(geometryIndex).not.toBeNull();
    if (!geometryIndex) {
      return;
    }
    const before = Array.from(geometryIndex.array);
    geometryIndex.needsUpdate = true;
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 10);

    sortTransparentMesh(mesh, sortData, camera);

    expect(Array.from(geometryIndex.array)).toEqual(before);
  });

  it("refreshes transparent sort data for interleaved position updates", () => {
    const geometry = new BufferGeometry();
    const interleavedPositions = new InterleavedBuffer(
      new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
        2, 0, 0,
        3, 0, 0,
        3, 1, 0,
        2, 1, 0,
      ]),
      3
    );
    geometry.setAttribute(
      "position",
      new InterleavedBufferAttribute(interleavedPositions, 3, 0)
    );
    geometry.setIndex(
      new BufferAttribute(
        new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
        1
      )
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    const positionAttr = mesh.geometry.getAttribute("position");
    if (!(positionAttr instanceof InterleavedBufferAttribute)) {
      throw new Error("Expected interleaved position attribute");
    }
    positionAttr.data.needsUpdate = true;
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
    expect(refreshedSortData.positionVersion).toBe(positionAttr.data.version);
  });

  it("refreshes transparent sort data when position layout changes with same array", () => {
    const geometry = new BufferGeometry();
    const interleaved = new InterleavedBuffer(
      new Float32Array([
        99, 0, 0, 0,
        98, 1, 0, 0,
        97, 0, 1, 0,
        96, 1, 1, 0,
        95, 2, 0, 0,
        94, 3, 0, 0,
        93, 2, 1, 0,
        92, 3, 1, 0,
      ]),
      4
    );
    geometry.setAttribute("position", new InterleavedBufferAttribute(interleaved, 3, 1));
    geometry.setIndex(
      new BufferAttribute(
        new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
        1
      )
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }
    mesh.userData.transparentSortData = sortData;
    geometry.setAttribute("position", new InterleavedBufferAttribute(interleaved, 3, 0));
    const positionAttr = mesh.geometry.getAttribute("position");
    expect(positionAttr.array).toBe(sortData.positionArray);
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
    expect(refreshedSortData.positionOffset).toBe(0);
    expect(refreshedSortData.positionStride).toBe(4);
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

  it("clears sorting callback when refreshed geometry loses position data", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    const geometryWithoutPositions = new BufferGeometry();
    geometryWithoutPositions.setIndex(
      new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1)
    );
    mesh.geometry = geometryWithoutPositions;
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

  it("clears sorting callback when position attribute is removed in place", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sortData = prepareTransparentMesh(mesh);
    expect(sortData).not.toBeNull();
    if (!sortData) {
      return;
    }

    mesh.userData.transparentSortData = sortData;
    mesh.geometry.deleteAttribute("position");
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

  it("ignores malformed single-entry material arrays during setup", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const malformedMaterials: (MeshBasicMaterial | undefined)[] = [undefined];
    mesh.material = malformedMaterials as MeshBasicMaterial[];

    expect(() => setupTransparentSorting(mesh)).not.toThrow();
    expect(mesh.userData.transparentSortData).toBeUndefined();
    expect(mesh.onBeforeRender).toBe(Object3D.prototype.onBeforeRender);
  });

  it("accepts transparent material arrays with sparse entries during setup", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial());
    const sparseMaterials: (MeshBasicMaterial | undefined)[] = [
      undefined,
      new MeshBasicMaterial({ transparent: true }),
    ];
    mesh.material = sparseMaterials as MeshBasicMaterial[];

    setupTransparentSorting(mesh);

    expect(mesh.userData.transparentSortData).toBeDefined();
    expect(mesh.onBeforeRender).toBe(sortTransparentMeshOnBeforeRender);
  });

  it("clears stale sort state when setup is rerun on opaque mesh", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial({ transparent: true }));
    setupTransparentSorting(mesh);
    expect(mesh.userData.transparentSortData).toBeDefined();
    expect(mesh.onBeforeRender).toBe(sortTransparentMeshOnBeforeRender);

    mesh.material = new MeshBasicMaterial({ transparent: false });
    setupTransparentSorting(mesh);

    expect(mesh.userData.transparentSortData).toBeUndefined();
    expect(mesh.onBeforeRender).toBe(Object3D.prototype.onBeforeRender);
  });

  it("clears stale sort state when setup is rerun without geometry index", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial({ transparent: true }));
    setupTransparentSorting(mesh);
    expect(mesh.userData.transparentSortData).toBeDefined();
    expect(mesh.onBeforeRender).toBe(sortTransparentMeshOnBeforeRender);

    mesh.geometry.setIndex(null);
    setupTransparentSorting(mesh);

    expect(mesh.userData.transparentSortData).toBeUndefined();
    expect(mesh.onBeforeRender).toBe(Object3D.prototype.onBeforeRender);
  });

  it("clears stale sort state when material becomes opaque at render-time", () => {
    const mesh = new Mesh(createQuadGeometry(2), new MeshBasicMaterial({ transparent: true }));
    setupTransparentSorting(mesh);
    expect(mesh.userData.transparentSortData).toBeDefined();
    expect(mesh.onBeforeRender).toBe(sortTransparentMeshOnBeforeRender);

    mesh.material = new MeshBasicMaterial({ transparent: false });
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
