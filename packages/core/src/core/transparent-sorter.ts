import {
  BufferAttribute,
  Camera,
  InterleavedBufferAttribute,
  Mesh,
  Object3D,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

const _worldPos = new Vector3();
const _camWorldPos = new Vector3();
const _transparentTraversalStack: Object3D[] = [];
const DEFAULT_ON_BEFORE_RENDER = Object3D.prototype.onBeforeRender;
const clearTransparentSortState = (mesh: Mesh) => {
  if (mesh.userData.transparentSortData !== undefined) {
    delete mesh.userData.transparentSortData;
  }
  if (mesh.onBeforeRender === sortTransparentMeshOnBeforeRender) {
    mesh.onBeforeRender = DEFAULT_ON_BEFORE_RENDER;
  }
};

export interface TransparentMeshData {
  centroids: Float32Array;
  faceCount: number;
  indexVersion: number;
  positionArray: ArrayLike<number>;
  positionCount: number;
  positionOffset: number;
  positionStride: number;
  positionVersion: number;
  originalIndices: Uint16Array | Uint32Array;
  sortedIndices: Uint16Array | Uint32Array;
  faceOrder: Uint32Array;
  lastCameraPos: Vector3;
  sortKeys: Uint32Array;
  sortTemp: Uint32Array;
}

const CAMERA_MOVE_THRESHOLD_SQ = 0.25;
const hasTransparentMaterial = (mesh: Mesh) => {
  const material = mesh.material;
  if (Array.isArray(material)) {
    const materialCount = material.length;
    if (materialCount === 1) {
      const firstMaterial = material[0];
      return !!firstMaterial && firstMaterial.transparent;
    }
    for (let materialIndex = 0; materialIndex < materialCount; materialIndex++) {
      const materialEntry = material[materialIndex];
      if (materialEntry && materialEntry.transparent) {
        return true;
      }
    }
    return false;
  }

  return !!material && material.transparent;
};

export function prepareTransparentMesh(mesh: Mesh): TransparentMeshData | null {
  const geometry = mesh.geometry;
  if (!geometry.index) return null;
  const positionAttr = geometry.getAttribute("position");
  if (!positionAttr || positionAttr.itemSize < 3) return null;

  const positions = positionAttr.array as ArrayLike<number>;
  const vertexCount = positionAttr.count;
  if (!Number.isInteger(vertexCount) || vertexCount <= 0) return null;
  const positionStride = getPositionStride(positionAttr);
  const positionOffset = getPositionOffset(positionAttr);
  const requiredPositionLength = positionOffset + (vertexCount - 1) * positionStride + 3;
  if (requiredPositionLength > positions.length) return null;
  const indices = geometry.index.array as Uint16Array | Uint32Array;
  const indicesLength = indices.length;
  if (indicesLength % 6 !== 0) return null;
  const faceCount = indicesLength / 6;

  if (faceCount <= 1) return null;

  const centroids = new Float32Array(faceCount * 3);
  const faceOrder = new Uint32Array(faceCount);
  if (positionStride === 3 && positionOffset === 0) {
    for (
      let faceIndex = 0, indexOffset = 0, centroidOffset = 0;
      faceIndex < faceCount;
      faceIndex++, indexOffset += 6, centroidOffset += 3
    ) {
      faceOrder[faceIndex] = faceIndex;
      const i0Index = indices[indexOffset];
      const i1Index = indices[indexOffset + 1];
      const i2Index = indices[indexOffset + 2];
      const i3Index = indices[indexOffset + 3];
      const i4Index = indices[indexOffset + 4];
      const i5Index = indices[indexOffset + 5];
      let maxIndex = i0Index > i1Index ? i0Index : i1Index;
      if (i2Index > maxIndex) maxIndex = i2Index;
      if (i3Index > maxIndex) maxIndex = i3Index;
      if (i4Index > maxIndex) maxIndex = i4Index;
      if (i5Index > maxIndex) maxIndex = i5Index;
      if (maxIndex >= vertexCount) {
        return null;
      }
      const i0 = i0Index * 3;
      const i1 = i1Index * 3;
      const i2 = i2Index * 3;
      const cx = (positions[i0] + positions[i1] + positions[i2]) / 3;
      const cy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
      const cz = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;
      if (!areFinite3(cx, cy, cz)) {
        return null;
      }

      centroids[centroidOffset] = cx;
      centroids[centroidOffset + 1] = cy;
      centroids[centroidOffset + 2] = cz;
    }
  } else {
    for (
      let faceIndex = 0, indexOffset = 0, centroidOffset = 0;
      faceIndex < faceCount;
      faceIndex++, indexOffset += 6, centroidOffset += 3
    ) {
      faceOrder[faceIndex] = faceIndex;
      const i0Index = indices[indexOffset];
      const i1Index = indices[indexOffset + 1];
      const i2Index = indices[indexOffset + 2];
      const i3Index = indices[indexOffset + 3];
      const i4Index = indices[indexOffset + 4];
      const i5Index = indices[indexOffset + 5];
      let maxIndex = i0Index > i1Index ? i0Index : i1Index;
      if (i2Index > maxIndex) maxIndex = i2Index;
      if (i3Index > maxIndex) maxIndex = i3Index;
      if (i4Index > maxIndex) maxIndex = i4Index;
      if (i5Index > maxIndex) maxIndex = i5Index;
      if (maxIndex >= vertexCount) {
        return null;
      }
      const i0 = i0Index * positionStride + positionOffset;
      const i1 = i1Index * positionStride + positionOffset;
      const i2 = i2Index * positionStride + positionOffset;
      const cx = (positions[i0] + positions[i1] + positions[i2]) / 3;
      const cy = (positions[i0 + 1] + positions[i1 + 1] + positions[i2 + 1]) / 3;
      const cz = (positions[i0 + 2] + positions[i1 + 2] + positions[i2 + 2]) / 3;
      if (!areFinite3(cx, cy, cz)) {
        return null;
      }

      centroids[centroidOffset] = cx;
      centroids[centroidOffset + 1] = cy;
      centroids[centroidOffset + 2] = cz;
    }
  }

  const originalIndices =
    indices instanceof Uint32Array ? new Uint32Array(indices) : new Uint16Array(indices);
  const sortedIndices = indices;

  return {
    centroids,
    faceCount,
    indexVersion: getPositionVersion(geometry.index),
    positionArray: positions,
    positionCount: vertexCount,
    positionOffset,
    positionStride,
    positionVersion: getPositionVersion(positionAttr),
    originalIndices,
    sortedIndices,
    faceOrder,
    lastCameraPos: new Vector3(Infinity, Infinity, Infinity),
    sortKeys: new Uint32Array(faceCount),
    sortTemp: new Uint32Array(faceCount),
  };
}

export function setupTransparentSorting(object: Object3D): void {
  const traversalStack = _transparentTraversalStack;
  traversalStack.length = 0;
  traversalStack.push(object);

  while (traversalStack.length > 0) {
    const child = traversalStack.pop()!;

    const childChildren = child.children;
    for (let childIndex = 0; childIndex < childChildren.length; childIndex++) {
      traversalStack.push(childChildren[childIndex]);
    }

    if (!(child instanceof Mesh)) {
      continue;
    }
    if (!hasTransparentMaterial(child)) {
      clearTransparentSortState(child);
      continue;
    }
    const geometry = child.geometry;
    if (!geometry || !geometry.index) {
      clearTransparentSortState(child);
      continue;
    }

    const sortData = prepareTransparentMesh(child);
    if (!sortData) {
      clearTransparentSortState(child);
      continue;
    }

    child.userData.transparentSortData = sortData;
    child.onBeforeRender = sortTransparentMeshOnBeforeRender;
  }
  traversalStack.length = 0;
}

const _floatView = new Float32Array(1);
const _intView = new Uint32Array(_floatView.buffer);
const _counts = new Uint32Array(256);
const areFinite3 = (x: number, y: number, z: number) =>
  Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
const getPositionVersion = (
  attribute: BufferAttribute | InterleavedBufferAttribute
) => ("version" in attribute ? attribute.version : attribute.data.version);
const getPositionStride = (
  attribute: BufferAttribute | InterleavedBufferAttribute
) =>
  attribute instanceof InterleavedBufferAttribute
    ? attribute.data.stride
    : attribute.itemSize;
const getPositionOffset = (
  attribute: BufferAttribute | InterleavedBufferAttribute
) => (attribute instanceof InterleavedBufferAttribute ? attribute.offset : 0);

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
  const positionAttr = mesh.geometry.getAttribute("position");
  if (
    !positionAttr ||
    positionAttr.itemSize < 3 ||
    positionAttr.array !== data.positionArray ||
    positionAttr.count !== data.positionCount ||
    getPositionOffset(positionAttr) !== data.positionOffset ||
    getPositionStride(positionAttr) !== data.positionStride ||
    getPositionVersion(positionAttr) !== data.positionVersion
  ) {
    return;
  }
  const geometryIndex = mesh.geometry.index;
  if (
    !geometryIndex ||
    geometryIndex.array !== data.sortedIndices ||
    getPositionVersion(geometryIndex) !== data.indexVersion
  ) {
    return;
  }

  mesh.getWorldPosition(_worldPos);
  camera.getWorldPosition(_camWorldPos);
  const camX = _camWorldPos.x - _worldPos.x;
  const camY = _camWorldPos.y - _worldPos.y;
  const camZ = _camWorldPos.z - _worldPos.z;
  if (!areFinite3(camX, camY, camZ)) {
    return;
  }
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

  geometryIndex.needsUpdate = true;
  data.indexVersion = getPositionVersion(geometryIndex);
}

export function sortTransparentMeshOnBeforeRender(
  this: Object3D,
  _renderer: WebGLRenderer,
  _scene: Scene,
  camera: Camera
): void {
  const mesh = this as Mesh;
  let sortData = mesh.userData.transparentSortData as
    | TransparentMeshData
    | undefined;
  if (!sortData) {
    return;
  }
  if (
    mesh.onBeforeRender === sortTransparentMeshOnBeforeRender &&
    !hasTransparentMaterial(mesh)
  ) {
    clearTransparentSortState(mesh);
    return;
  }
  const geometry = mesh.geometry;
  const geometryIndex = geometry.index;
  const positionAttr = geometry.getAttribute("position");
  if (
    !geometryIndex ||
    geometryIndex.array !== sortData.sortedIndices ||
    getPositionVersion(geometryIndex) !== sortData.indexVersion ||
    !positionAttr ||
    positionAttr.itemSize < 3 ||
    positionAttr.array !== sortData.positionArray ||
    positionAttr.count !== sortData.positionCount ||
    getPositionOffset(positionAttr) !== sortData.positionOffset ||
    getPositionStride(positionAttr) !== sortData.positionStride ||
    getPositionVersion(positionAttr) !== sortData.positionVersion
  ) {
    const refreshedSortData = prepareTransparentMesh(mesh);
    if (!refreshedSortData) {
      clearTransparentSortState(mesh);
      return;
    }
    mesh.userData.transparentSortData = refreshedSortData;
    sortData = refreshedSortData;
  }

  sortTransparentMesh(mesh, sortData, camera);
}
