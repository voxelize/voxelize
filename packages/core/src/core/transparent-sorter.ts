import { Camera, Mesh, Object3D, Vector3 } from "three";

const _worldPos = new Vector3();
const _camPos = new Vector3();
const _camWorldPos = new Vector3();
const _camDir = new Vector3();

export interface TransparentMeshData {
  centroids: Float32Array;
  faceCount: number;
  originalIndices: Uint32Array;
  sortedIndices: Uint32Array;
  distances: Float32Array;
  faceOrder: Uint32Array;
  lastCameraPos: Vector3;
  lastCameraDir: Vector3;
  bucketCounts: Uint32Array;
  bucketOffsets: Uint32Array;
  tempOrder: Uint32Array;
}

const CAMERA_MOVE_THRESHOLD_SQ = 1.0;
const CAMERA_DIR_THRESHOLD = 0.02;
const BUCKET_COUNT = 256;

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
    lastCameraDir: new Vector3(Infinity, Infinity, Infinity),
    bucketCounts: new Uint32Array(BUCKET_COUNT),
    bucketOffsets: new Uint32Array(BUCKET_COUNT),
    tempOrder: new Uint32Array(faceCount),
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

export function sortTransparentMesh(
  mesh: Mesh,
  data: TransparentMeshData,
  camera: Camera
): void {
  mesh.getWorldPosition(_worldPos);
  camera.getWorldPosition(_camWorldPos);
  _camPos.copy(_camWorldPos).sub(_worldPos);

  camera.getWorldDirection(_camDir);

  const isFirstSort =
    data.lastCameraPos.x === Infinity &&
    data.lastCameraPos.y === Infinity &&
    data.lastCameraPos.z === Infinity;

  if (!isFirstSort) {
    const posMoved =
      _camPos.distanceToSquared(data.lastCameraPos) >= CAMERA_MOVE_THRESHOLD_SQ;

    const dx = _camDir.x - data.lastCameraDir.x;
    const dy = _camDir.y - data.lastCameraDir.y;
    const dz = _camDir.z - data.lastCameraDir.z;
    const dirChanged = dx * dx + dy * dy + dz * dz >= CAMERA_DIR_THRESHOLD;

    if (!posMoved && !dirChanged) {
      return;
    }
  }

  data.lastCameraPos.copy(_camPos);
  data.lastCameraDir.copy(_camDir);

  const { centroids, faceCount, distances, faceOrder } = data;

  let minDist = Infinity;
  let maxDist = 0;

  for (let f = 0; f < faceCount; f++) {
    const cx = centroids[f * 3] - _camPos.x;
    const cy = centroids[f * 3 + 1] - _camPos.y;
    const cz = centroids[f * 3 + 2] - _camPos.z;
    const d = cx * cx + cy * cy + cz * cz;
    distances[f] = d;
    if (d < minDist) minDist = d;
    if (d > maxDist) maxDist = d;
  }

  const range = maxDist - minDist;
  if (range < 0.0001) {
    for (let f = 0; f < faceCount; f++) {
      faceOrder[f] = f;
    }
  } else {
    const { bucketCounts, bucketOffsets, tempOrder } = data;
    const scale = (BUCKET_COUNT - 1) / range;

    bucketCounts.fill(0);

    for (let f = 0; f < faceCount; f++) {
      const bucket = (BUCKET_COUNT - 1 - (distances[f] - minDist) * scale) | 0;
      bucketCounts[bucket]++;
    }

    bucketOffsets[0] = 0;
    for (let i = 1; i < BUCKET_COUNT; i++) {
      bucketOffsets[i] = bucketOffsets[i - 1] + bucketCounts[i - 1];
    }

    bucketCounts.fill(0);

    for (let f = 0; f < faceCount; f++) {
      const bucket = (BUCKET_COUNT - 1 - (distances[f] - minDist) * scale) | 0;
      const idx = bucketOffsets[bucket] + bucketCounts[bucket];
      tempOrder[idx] = f;
      bucketCounts[bucket]++;
    }

    for (let f = 0; f < faceCount; f++) {
      faceOrder[f] = tempOrder[f];
    }
  }

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
  for (let i = 0; i < sortedIndices.length; i++) {
    targetArray[i] = sortedIndices[i];
  }
  indexAttr.needsUpdate = true;
}
