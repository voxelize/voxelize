import init, { mesh_chunk_fast, set_registry } from "@voxelize/wasm-mesher";

import { Coords3 } from "../../../types";
import { type WorldOptions } from "../index";

type ChunkData = {
  voxels: Uint32Array | number[];
  lights: Uint32Array | number[];
  shape: [number, number, number];
  min: [number, number, number];
};

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type RegistryData = {
  blocksById: [number, object][];
  blocksByName: [string, object][];
};

type InitMessage = {
  type: "init";
  registryData: RegistryData;
};

type MeshBatchMessage = {
  type?: string;
  chunksData: (
    | {
        id: string;
        x: number;
        z: number;
        voxels: ArrayBuffer;
        lights: ArrayBuffer;
        options: { size: number; maxHeight: number };
      }
    | null
  )[];
  min: Coords3;
  max: Coords3;
  options: WorldOptions;
};

type MeshWorkerMessage = InitMessage | MeshBatchMessage;

type WasmBlock = {
  id: number;
  name: string;
  rotatable: boolean;
  yRotatable: boolean;
  isEmpty: boolean;
  isFluid: boolean;
  isWaterlogged: boolean;
  isOpaque: boolean;
  isSeeThrough: boolean;
  isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean];
  transparentStandalone: boolean;
  occludesFluid: boolean;
  faces: {
    name: string;
    independent: boolean;
    isolated: boolean;
    textureGroup: string | null;
    dir: [number, number, number];
    corners: { pos: [number, number, number]; uv: [number, number] }[];
    range: { startU: number; endU: number; startV: number; endV: number };
  }[];
  aabbs: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  }[];
  dynamicPatterns:
    | {
        parts: {
          rule: object;
          faces: {
            name: string;
            independent: boolean;
            isolated: boolean;
            textureGroup: string | null;
            dir: [number, number, number];
            corners: { pos: [number, number, number]; uv: [number, number] }[];
            range: {
              startU: number;
              endU: number;
              startV: number;
              endV: number;
            };
          }[];
          aabbs: {
            minX: number;
            minY: number;
            minZ: number;
            maxX: number;
            maxY: number;
            maxZ: number;
          }[];
          isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean];
          worldSpace: boolean;
        }[];
      }[]
    | null;
};

type WasmRegistry = {
  blocksById: [number, WasmBlock][];
};

type WasmFace = WasmBlock["faces"][number];
type WasmFaceCorner = WasmFace["corners"][number];
type WasmAabb = WasmBlock["aabbs"][number];
type WasmDynamicPatterns = NonNullable<WasmBlock["dynamicPatterns"]>;
type WasmDynamicPattern = WasmDynamicPatterns[number];
type WasmDynamicPatternPart = WasmDynamicPattern["parts"][number];

type GeometryProtocol = {
  voxel: number;
  at: Coords3 | null;
  faceName: string | null;
  positions: number[];
  indices: number[];
  uvs: number[];
  lights: number[];
};

function workerComputeNormals(
  positions: Float32Array,
  indices: Uint16Array
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const e1x = positions[ib] - positions[ia];
    const e1y = positions[ib + 1] - positions[ia + 1];
    const e1z = positions[ib + 2] - positions[ia + 2];
    const e2x = positions[ic] - positions[ia];
    const e2y = positions[ic + 1] - positions[ia + 1];
    const e2z = positions[ic + 2] - positions[ia + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    normals[ia] = nx;
    normals[ia + 1] = ny;
    normals[ia + 2] = nz;
    normals[ib] = nx;
    normals[ib + 1] = ny;
    normals[ib + 2] = nz;
    normals[ic] = nx;
    normals[ic + 1] = ny;
    normals[ic + 2] = nz;
  }
  return normals;
}

function workerComputeBoundingSphere(positions: Float32Array): {
  center: [number, number, number];
  radius: number;
} {
  const count = positions.length / 3;
  if (count === 0) return { center: [0, 0, 0], radius: 0 };
  let cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i];
    cy += positions[i + 1];
    cz += positions[i + 2];
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let maxR2 = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - cx;
    const dy = positions[i + 1] - cy;
    const dz = positions[i + 2] - cz;
    const r2 = dx * dx + dy * dy + dz * dz;
    if (r2 > maxR2) maxR2 = r2;
  }
  return { center: [cx, cy, cz], radius: Math.sqrt(maxR2) };
}

let wasmInitialized = false;
let registryInitialized = false;
const pendingMeshMessages: MeshBatchMessage[] = [];
let pendingMeshMessagesHead = 0;
const MAX_PENDING_MESH_MESSAGES = 512;

const minArray = new Int32Array(3);
const maxArray = new Int32Array(3);
const emptyUint32Array = new Uint32Array(0);

const hasPendingMeshMessages = () =>
  pendingMeshMessagesHead < pendingMeshMessages.length;

const pendingMeshMessageCount = () =>
  pendingMeshMessages.length - pendingMeshMessagesHead;

const normalizePendingMeshMessages = () => {
  if (pendingMeshMessagesHead === 0) {
    return;
  }

  if (pendingMeshMessagesHead >= pendingMeshMessages.length) {
    pendingMeshMessages.length = 0;
    pendingMeshMessagesHead = 0;
    return;
  }

  if (
    pendingMeshMessagesHead >= 1024 &&
    pendingMeshMessagesHead * 2 >= pendingMeshMessages.length
  ) {
    pendingMeshMessages.copyWithin(0, pendingMeshMessagesHead);
    pendingMeshMessages.length -= pendingMeshMessagesHead;
    pendingMeshMessagesHead = 0;
  }
};

const ensureWasmInitialized = async () => {
  if (!wasmInitialized) {
    await init();
    wasmInitialized = true;
  }
};

const postEmptyMeshResult = () => {
  postMessage(
    { geometries: [] },
    {
      transfer: [],
    }
  );
};

const isInitMessage = (message: MeshWorkerMessage): message is InitMessage =>
  message.type === "init";

const processMeshMessage = (message: MeshBatchMessage) => {
  const { chunksData, min, max } = message;
  const { chunkSize, greedyMeshing = true } = message.options;

  if (max[0] <= min[0] || max[1] <= min[1] || max[2] <= min[2]) {
    postEmptyMeshResult();
    return;
  }

  const chunks: (ChunkData | null)[] = new Array(chunksData.length);
  let hasAnyChunk = false;
  for (let i = 0; i < chunksData.length; i++) {
    const chunkData = chunksData[i];
    if (!chunkData) {
      chunks[i] = null;
      continue;
    }

    hasAnyChunk = true;
    const { x, z, voxels, lights, options } = chunkData;
    const { size, maxHeight } = options;

    chunks[i] = {
      voxels: voxels.byteLength ? new Uint32Array(voxels) : emptyUint32Array,
      lights: lights.byteLength ? new Uint32Array(lights) : emptyUint32Array,
      shape: [size, maxHeight, size],
      min: [x * size, 0, z * size],
    };
  }

  if (!hasAnyChunk) {
    postEmptyMeshResult();
    return;
  }

  minArray[0] = min[0];
  minArray[1] = min[1];
  minArray[2] = min[2];
  maxArray[0] = max[0];
  maxArray[1] = max[1];
  maxArray[2] = max[2];

  const result = mesh_chunk_fast(
    chunks,
    minArray,
    maxArray,
    chunkSize,
    greedyMeshing
  ) as { geometries: GeometryProtocol[] };
  const maxGeometryCount = result.geometries.length;
  if (maxGeometryCount === 0) {
    postEmptyMeshResult();
    return;
  }
  const arrayBuffers = new Array<ArrayBuffer>(maxGeometryCount * 5);
  const geometriesPacked = new Array<{
    indices: Uint16Array;
    lights: Int32Array;
    positions: Float32Array;
    uvs: Float32Array;
    normals: Float32Array;
    bsCenter: [number, number, number];
    bsRadius: number;
    voxel: number;
    faceName: string | null;
    at: Coords3 | null;
  }>(maxGeometryCount);
  let geometryCount = 0;
  let bufferCount = 0;

  for (let geometryIndex = 0; geometryIndex < result.geometries.length; geometryIndex++) {
    const geometry = result.geometries[geometryIndex];
    if (geometry.positions.length === 0) {
      continue;
    }

    const positions = new Float32Array(geometry.positions);
    const indices = new Uint16Array(geometry.indices);
    const normals = workerComputeNormals(positions, indices);
    const bs = workerComputeBoundingSphere(positions);
    const lights = new Int32Array(geometry.lights);
    const uvs = new Float32Array(geometry.uvs);

    geometriesPacked[geometryCount] = {
      indices,
      lights,
      positions,
      uvs,
      normals,
      bsCenter: bs.center,
      bsRadius: bs.radius,
      voxel: geometry.voxel,
      faceName: geometry.faceName,
      at: geometry.at,
    };
    geometryCount++;

    arrayBuffers[bufferCount++] = indices.buffer;
    arrayBuffers[bufferCount++] = lights.buffer;
    arrayBuffers[bufferCount++] = positions.buffer;
    arrayBuffers[bufferCount++] = uvs.buffer;
    arrayBuffers[bufferCount++] = normals.buffer as ArrayBuffer;
  }

  geometriesPacked.length = geometryCount;
  arrayBuffers.length = bufferCount;

  postMessage(
    { geometries: geometriesPacked },
    {
      transfer: arrayBuffers,
    }
  );
};

onmessage = async function (e: MessageEvent<MeshWorkerMessage>) {
  const message = e.data;

  if (isInitMessage(message)) {
    await ensureWasmInitialized();

    const rawRegistry = message.registryData;
    const wasmRegistry = convertRegistryToWasm(rawRegistry);
    set_registry(wasmRegistry);
    registryInitialized = true;

    if (hasPendingMeshMessages()) {
      const start = pendingMeshMessagesHead;
      const end = pendingMeshMessages.length;
      for (let i = start; i < end; i++) {
        processMeshMessage(pendingMeshMessages[i]);
      }
      pendingMeshMessages.length = 0;
      pendingMeshMessagesHead = 0;
    }

    return;
  }

  await ensureWasmInitialized();
  if (!registryInitialized) {
    if (pendingMeshMessageCount() >= MAX_PENDING_MESH_MESSAGES) {
      pendingMeshMessagesHead++;
      postEmptyMeshResult();
      normalizePendingMeshMessages();
    }
    pendingMeshMessages.push(message);
    return;
  }
  processMeshMessage(message);
};

function convertRegistryToWasm(rawRegistry: {
  blocksById: [number, object][];
  blocksByName: [string, object][];
}): WasmRegistry {
  const sourceBlocksById = rawRegistry.blocksById;
  const blocksById = new Array<[number, WasmBlock]>(sourceBlocksById.length);
  for (let blockIndex = 0; blockIndex < sourceBlocksById.length; blockIndex++) {
    const [id, rawBlock] = sourceBlocksById[blockIndex];
    const block = rawBlock as JsonObject;
    const wasmBlock: WasmBlock = {
      id: block.id as number,
      name: block.name as string,
      rotatable: block.rotatable as boolean,
      yRotatable: block.yRotatable as boolean,
      isEmpty: block.isEmpty as boolean,
      isFluid: block.isFluid as boolean,
      isWaterlogged: block.isWaterlogged as boolean,
      isOpaque: block.isOpaque as boolean,
      isSeeThrough: block.isSeeThrough as boolean,
      isTransparent: block.isTransparent as [
        boolean,
        boolean,
        boolean,
        boolean,
        boolean,
        boolean
      ],
      transparentStandalone: block.transparentStandalone as boolean,
      occludesFluid: (block.occludesFluid as boolean) ?? false,
      faces: convertFaces(block.faces as JsonObject[]),
      aabbs: convertAabbs(block.aabbs as JsonObject[]),
      dynamicPatterns: block.dynamicPatterns
        ? convertDynamicPatterns(block.dynamicPatterns as JsonObject[])
        : null,
    };
    blocksById[blockIndex] = [id, wasmBlock];
  }

  return { blocksById };
}

function convertFaces(faces: JsonObject[]): WasmBlock["faces"] {
  if (!faces) return [];
  const convertedFaces = new Array<WasmFace>(faces.length);
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex];
    const sourceCorners = face.corners as JsonObject[];
    const corners = new Array<WasmFaceCorner>(sourceCorners.length);
    for (let cornerIndex = 0; cornerIndex < sourceCorners.length; cornerIndex++) {
      const corner = sourceCorners[cornerIndex];
      corners[cornerIndex] = {
        pos: corner.pos as [number, number, number],
        uv: corner.uv as [number, number],
      };
    }
    const faceRange = face.range as Record<string, number> | undefined;
    convertedFaces[faceIndex] = {
      name: face.name as string,
      independent: face.independent as boolean,
      isolated: face.isolated as boolean,
      textureGroup: (face.textureGroup as string) ?? null,
      dir: face.dir as [number, number, number],
      corners,
      range: {
        startU: faceRange?.startU ?? 0,
        endU: faceRange?.endU ?? 1,
        startV: faceRange?.startV ?? 0,
        endV: faceRange?.endV ?? 1,
      },
    };
  }

  return convertedFaces;
}

function convertAabbs(aabbs: JsonObject[]): WasmBlock["aabbs"] {
  if (!aabbs) return [];
  const convertedAabbs = new Array<WasmAabb>(aabbs.length);
  for (let index = 0; index < aabbs.length; index++) {
    const aabb = aabbs[index];
    convertedAabbs[index] = {
      minX: aabb.minX as number,
      minY: aabb.minY as number,
      minZ: aabb.minZ as number,
      maxX: aabb.maxX as number,
      maxY: aabb.maxY as number,
      maxZ: aabb.maxZ as number,
    };
  }

  return convertedAabbs;
}

function convertDynamicPatterns(
  patterns: JsonObject[]
): WasmBlock["dynamicPatterns"] {
  if (!patterns) return null;
  const convertedPatterns = new Array<WasmDynamicPattern>(patterns.length);
  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
    const pattern = patterns[patternIndex];
    const sourceParts = pattern.parts as JsonObject[];
    const parts = new Array<WasmDynamicPatternPart>(sourceParts.length);
    for (let partIndex = 0; partIndex < sourceParts.length; partIndex++) {
      const part = sourceParts[partIndex];
      parts[partIndex] = {
        rule: part.rule as object,
        faces: convertFaces(part.faces as JsonObject[]),
        aabbs: convertAabbs(part.aabbs as JsonObject[]),
        isTransparent: (part.isTransparent as [
          boolean,
          boolean,
          boolean,
          boolean,
          boolean,
          boolean
        ]) ?? [false, false, false, false, false, false],
        worldSpace: (part.worldSpace as boolean) ?? false,
      };
    }
    convertedPatterns[patternIndex] = { parts };
  }
  return convertedPatterns;
}
