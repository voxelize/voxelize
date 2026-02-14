import {
  Camera,
  Mesh,
  Object3D,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

const _worldPos = new Vector3();
const _camWorldPos = new Vector3();

export interface TransparentMeshData {
  centroids: Float32Array;
  faceCount: number;
  originalIndices: Uint16Array | Uint32Array;
  sortedIndices: Uint16Array | Uint32Array;
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
  const indices = geometry.index.array as Uint16Array | Uint32Array;
  const faceCount = Math.floor(indices.length / 6);

  if (faceCount <= 1) return null;

  const centroids = new Float32Array(faceCount * 3);
  const faceOrder = new Uint32Array(faceCount);
  for (
    let faceIndex = 0, indexOffset = 0, centroidOffset = 0;
    faceIndex < faceCount;
    faceIndex++, indexOffset += 6, centroidOffset += 3
  ) {
    faceOrder[faceIndex] = faceIndex;
    const i0 = indices[indexOffset] * 3;
    const i1 = indices[indexOffset + 1] * 3;
    const i2 = indices[indexOffset + 2] * 3;

    centroids[centroidOffset] =
      (positions[i0] + positions[i1] + positions[i2]) / 3;
    centroids[centroidOffset + 1] =
      (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
    centroids[centroidOffset + 2] =
      (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;
  }

  const originalIndices =
    indices instanceof Uint32Array ? new Uint32Array(indices) : new Uint16Array(indices);
  const sortedIndices = indices;

  return {
    centroids,
    faceCount,
    originalIndices,
    sortedIndices,
    faceOrder,
    lastCameraPos: new Vector3(Infinity, Infinity, Infinity),
    sortKeys: new Uint32Array(faceCount),
    sortTemp: new Uint32Array(faceCount),
  };
}

export function setupTransparentSorting(object: Object3D): void {
  const traversalStack: Object3D[] = [object];

  while (traversalStack.length > 0) {
    const child = traversalStack.pop();
    if (!child) {
      continue;
    }

    const childChildren = child.children;
    for (let childIndex = 0; childIndex < childChildren.length; childIndex++) {
      traversalStack.push(childChildren[childIndex]);
    }

    if (!(child instanceof Mesh)) {
      continue;
    }
    const geometry = child.geometry;
    if (!geometry || !geometry.index) {
      continue;
    }

    const material = child.material;
    let isTransparent = false;
    if (Array.isArray(material)) {
      const materialCount = material.length;
      for (let materialIndex = 0; materialIndex < materialCount; materialIndex++) {
        if (material[materialIndex].transparent) {
          isTransparent = true;
          break;
        }
      }
    } else {
      isTransparent = material.transparent;
    }

    if (!isTransparent) {
      continue;
    }

    const sortData = prepareTransparentMesh(child);
    if (!sortData) {
      continue;
    }

    child.userData.transparentSortData = sortData;
    child.onBeforeRender = sortTransparentMeshOnBeforeRender;
  }
}

const _floatView = new Float32Array(1);
const _intView = new Uint32Array(_floatView.buffer);
const _counts = new Uint32Array(256);

function radixSortDescending(
  faceOrder: Uint32Array,
  faceCount: number,
  keys: Uint32Array,
  temp: Uint32Array
): void {
  const counts = _counts;
  let src = faceOrder;
  let dst = temp;

  for (let shift = 0; shift < 32; shift += 8) {
    counts.fill(0);

    for (let i = 0; i < faceCount; i++) {
      counts[(keys[src[i]] >> shift) & 0xff]++;
    }

    for (let i = 1; i < 256; i++) {
      counts[i] += counts[i - 1];
    }

    for (let i = faceCount - 1; i >= 0; i--) {
      const idx = src[i];
      const bucket = (keys[idx] >> shift) & 0xff;
      dst[--counts[bucket]] = idx;
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
  const camX = _camWorldPos.x - _worldPos.x;
  const camY = _camWorldPos.y - _worldPos.y;
  const camZ = _camWorldPos.z - _worldPos.z;
  const lastCameraPos = data.lastCameraPos;

  const isFirstSort = lastCameraPos.x === Infinity;

  if (!isFirstSort) {
    const dx = camX - lastCameraPos.x;
    const dy = camY - lastCameraPos.y;
    const dz = camZ - lastCameraPos.z;
    if (dx * dx + dy * dy + dz * dz < CAMERA_MOVE_THRESHOLD_SQ) {
      return;
    }
  }
  lastCameraPos.x = camX;
  lastCameraPos.y = camY;
  lastCameraPos.z = camZ;

  const { centroids, faceCount, faceOrder, sortKeys, sortTemp } = data;

  for (let f = 0, centroidIndex = 0; f < faceCount; f++, centroidIndex += 3) {
    const cx = centroids[centroidIndex] - camX;
    const cy = centroids[centroidIndex + 1] - camY;
    const cz = centroids[centroidIndex + 2] - camZ;
    const distance = cx * cx + cy * cy + cz * cz;
    _floatView[0] = distance;
    const bits = _intView[0];
    sortKeys[f] = bits ^ (-(bits >> 31) | 0x80000000) ^ 0xffffffff;
  }

  radixSortDescending(faceOrder, faceCount, sortKeys, sortTemp);

  const { originalIndices, sortedIndices } = data;
  const sourceIndices = originalIndices;
  const targetIndices = sortedIndices;
  for (let i = 0, dstOffset = 0; i < faceCount; i++, dstOffset += 6) {
    const srcFace = faceOrder[i];
    const srcOffset = srcFace * 6;

    targetIndices[dstOffset] = sourceIndices[srcOffset];
    targetIndices[dstOffset + 1] = sourceIndices[srcOffset + 1];
    targetIndices[dstOffset + 2] = sourceIndices[srcOffset + 2];
    targetIndices[dstOffset + 3] = sourceIndices[srcOffset + 3];
    targetIndices[dstOffset + 4] = sourceIndices[srcOffset + 4];
    targetIndices[dstOffset + 5] = sourceIndices[srcOffset + 5];
  }

  mesh.geometry.index!.needsUpdate = true;
}

export function sortTransparentMeshOnBeforeRender(
  this: Object3D,
  _renderer: WebGLRenderer,
  _scene: Scene,
  camera: Camera
): void {
  if (!(this instanceof Mesh)) {
    return;
  }

  const sortData = this.userData.transparentSortData as
    | TransparentMeshData
    | undefined;
  if (!sortData) {
    return;
  }

  sortTransparentMesh(this, sortData, camera);
}
