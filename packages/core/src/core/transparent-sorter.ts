import { Camera, Mesh, Object3D, Vector3 } from "three";

const _worldPos = new Vector3();
const _camPos = new Vector3();
const _camWorldPos = new Vector3();

export interface TransparentMeshData {
  centroids: Float32Array;
  faceCount: number;
  originalIndices: Uint32Array;
  sortedIndices: Uint32Array;
  distances: Float32Array;
  faceOrder: Uint32Array;
  lastCameraPos: Vector3;
  sortKeys: Uint32Array;
  sortTemp: Uint32Array;
}

const CAMERA_MOVE_THRESHOLD_SQ = 0.25;

export function prepareTransparentMesh(mesh: Mesh): TransparentMeshData | null {
  const geometry = mesh.geometry;
  if (!geometry.index) return null;

  const positions = geometry.getAttribute("position").array as Float32Array;
  const indices = geometry.index.array;
  const faceCount = Math.floor(indices.length / 6);

  if (faceCount === 0) return null;

  const centroids = new Float32Array(faceCount * 3);

  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 6] * 3;
    const i1 = indices[f * 6 + 1] * 3;
    const i2 = indices[f * 6 + 2] * 3;

    centroids[f * 3] = (positions[i0] + positions[i1] + positions[i2]) / 3;
    centroids[f * 3 + 1] =
      (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
    centroids[f * 3 + 2] =
      (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;
  }

  return {
    centroids,
    faceCount,
    originalIndices: new Uint32Array(indices),
    sortedIndices: new Uint32Array(indices.length),
    distances: new Float32Array(faceCount),
    faceOrder: new Uint32Array(faceCount),
    lastCameraPos: new Vector3(Infinity, Infinity, Infinity),
    sortKeys: new Uint32Array(faceCount),
    sortTemp: new Uint32Array(faceCount),
  };
}

export function setupTransparentSorting(object: Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (!child.geometry?.index) return;

    const material = child.material;
    const isTransparent = Array.isArray(material)
      ? material.some((m) => m.transparent)
      : material?.transparent;

    if (!isTransparent) return;

    const sortData = prepareTransparentMesh(child);
    if (!sortData) return;

    child.userData.transparentSortData = sortData;
    child.onBeforeRender = (_renderer, _scene, camera) => {
      sortTransparentMesh(
        child,
        child.userData.transparentSortData as TransparentMeshData,
        camera
      );
    };
  });
}

const _floatView = new Float32Array(1);
const _intView = new Uint32Array(_floatView.buffer);
const _counts = new Uint32Array(256);

function radixSortDescending(
  distances: Float32Array,
  faceOrder: Uint32Array,
  faceCount: number,
  keys: Uint32Array,
  temp: Uint32Array
): void {
  for (let i = 0; i < faceCount; i++) {
    _floatView[0] = distances[i];
    const bits = _intView[0];
    keys[i] = bits ^ (-(bits >> 31) | 0x80000000) ^ 0xffffffff;
  }

  let src = faceOrder;
  let dst = temp;

  for (let shift = 0; shift < 32; shift += 8) {
    _counts.fill(0);

    for (let i = 0; i < faceCount; i++) {
      _counts[(keys[src[i]] >> shift) & 0xff]++;
    }

    for (let i = 1; i < 256; i++) {
      _counts[i] += _counts[i - 1];
    }

    for (let i = faceCount - 1; i >= 0; i--) {
      const idx = src[i];
      const bucket = (keys[idx] >> shift) & 0xff;
      dst[--_counts[bucket]] = idx;
    }

    const tmp = src;
    src = dst;
    dst = tmp;
  }

  if (src !== faceOrder) {
    faceOrder.set(src);
  }
}

export function sortTransparentMesh(
  mesh: Mesh,
  data: TransparentMeshData,
  camera: Camera
): void {
  mesh.getWorldPosition(_worldPos);
  camera.getWorldPosition(_camWorldPos);
  _camPos.copy(_camWorldPos).sub(_worldPos);

  const isFirstSort =
    data.lastCameraPos.x === Infinity &&
    data.lastCameraPos.y === Infinity &&
    data.lastCameraPos.z === Infinity;

  if (
    !isFirstSort &&
    _camPos.distanceToSquared(data.lastCameraPos) < CAMERA_MOVE_THRESHOLD_SQ
  ) {
    return;
  }
  data.lastCameraPos.copy(_camPos);

  const { centroids, faceCount, distances, faceOrder, sortKeys, sortTemp } =
    data;

  for (let f = 0; f < faceCount; f++) {
    const cx = centroids[f * 3] - _camPos.x;
    const cy = centroids[f * 3 + 1] - _camPos.y;
    const cz = centroids[f * 3 + 2] - _camPos.z;
    distances[f] = cx * cx + cy * cy + cz * cz;
    faceOrder[f] = f;
  }

  radixSortDescending(distances, faceOrder, faceCount, sortKeys, sortTemp);

  const { originalIndices, sortedIndices } = data;
  for (let i = 0; i < faceCount; i++) {
    const srcFace = faceOrder[i];
    const srcOffset = srcFace * 6;
    const dstOffset = i * 6;

    sortedIndices[dstOffset] = originalIndices[srcOffset];
    sortedIndices[dstOffset + 1] = originalIndices[srcOffset + 1];
    sortedIndices[dstOffset + 2] = originalIndices[srcOffset + 2];
    sortedIndices[dstOffset + 3] = originalIndices[srcOffset + 3];
    sortedIndices[dstOffset + 4] = originalIndices[srcOffset + 4];
    sortedIndices[dstOffset + 5] = originalIndices[srcOffset + 5];
  }

  const indexAttr = mesh.geometry.index!;
  const targetArray = indexAttr.array;
  (targetArray as Uint32Array).set(sortedIndices);
  indexAttr.needsUpdate = true;
}
