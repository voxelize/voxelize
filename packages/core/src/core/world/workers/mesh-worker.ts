import init, { mesh_chunk_fast, set_registry } from "@voxelize/wasm-mesher";

import { Coords3 } from "../../../types";
import { type WorldOptions } from "../index";
import { type SerializedChunkPayload } from "../raw-chunk";

type ChunkData = {
  voxels: Uint32Array | number[];
  lights: Uint32Array | number[];
  shape: [number, number, number];
  min: [number, number, number];
};

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
  isPlant: boolean;
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

type RawWasmFace = {
  name: string;
  independent: boolean;
  isolated: boolean;
  textureGroup?: string | null;
  dir: [number, number, number];
  corners: { pos: [number, number, number]; uv: [number, number] }[];
  range?: {
    startU?: number;
    endU?: number;
    startV?: number;
    endV?: number;
  };
};

type RawWasmAabb = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

type RawWasmDynamicPattern = {
  parts: {
    rule: object;
    faces: RawWasmFace[];
    aabbs: RawWasmAabb[];
    isTransparent?: [boolean, boolean, boolean, boolean, boolean, boolean];
    worldSpace?: boolean;
  }[];
};

type RawWasmBlock = {
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
  occludesFluid?: boolean;
  isPlant?: boolean;
  faces: RawWasmFace[];
  aabbs: RawWasmAabb[];
  dynamicPatterns?: RawWasmDynamicPattern[] | null;
};

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
  indices: Uint16Array,
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

const minArray = new Int32Array(3);
const maxArray = new Int32Array(3);
const emptyUint32Array = new Uint32Array(0);

function toUint32View(
  buffer: ArrayBufferLike,
  byteOffset?: number,
  length?: number,
): Uint32Array {
  if (!buffer || buffer.byteLength === 0) {
    return emptyUint32Array;
  }
  if (byteOffset !== undefined && length !== undefined) {
    return new Uint32Array(buffer, byteOffset, length);
  }
  return new Uint32Array(buffer);
}

onmessage = async function (e) {
  const { type } = e.data;

  if (type && type.toLowerCase() === "init") {
    if (!wasmInitialized) {
      await init();
      wasmInitialized = true;
    }

    const rawRegistry = e.data.registryData;
    const wasmRegistry = convertRegistryToWasm(rawRegistry);
    set_registry(wasmRegistry);
    return;
  }

  if (!wasmInitialized) {
    // @ts-expect-error postMessage typing
    postMessage({ geometries: [] }, []);
    return;
  }

  const { chunksData, min, max } = e.data;
  const { chunkSize } = e.data.options as WorldOptions;

  const chunks = chunksData.map(
    (chunkData: SerializedChunkPayload | null): ChunkData | null => {
      if (!chunkData) return null;

      const { x, z, voxels, lights, options } = chunkData;
      const { size, maxHeight } = options;
      const voxelView = toUint32View(
        voxels,
        chunkData.voxelsByteOffset,
        chunkData.voxelsLength,
      );
      const lightView = toUint32View(
        lights,
        chunkData.lightsByteOffset,
        chunkData.lightsLength,
      );

      return {
        voxels: voxelView,
        lights: lightView,
        shape: [size, maxHeight, size] as [number, number, number],
        min: [x * size, 0, z * size] as [number, number, number],
      };
    },
  );

  minArray[0] = min[0];
  minArray[1] = min[1];
  minArray[2] = min[2];
  maxArray[0] = max[0];
  maxArray[1] = max[1];
  maxArray[2] = max[2];

  let result: { geometries: GeometryProtocol[] };
  try {
    result = mesh_chunk_fast(chunks, minArray, maxArray, chunkSize) as {
      geometries: GeometryProtocol[];
    };
  } catch (error) {
    // A wasm trap (panic) aborts mid-mutation: thread-local state inside the
    // module (e.g. a borrowed RefCell) stays locked, so every later call on
    // this instance fails too. wasm-bindgen's init() refuses to re-create an
    // instance, so the worker cannot heal itself. Report the poisoning so
    // the pool replaces this worker; the caller re-queues the chunk.
    console.error(
      "[mesh-worker] wasm mesher trapped; requesting replacement",
      error,
    );
    // @ts-expect-error postMessage typing
    postMessage({ geometries: null, isWorkerPoisoned: true }, []);
    return;
  }
  const geometries = result.geometries;

  const arrayBuffers: ArrayBuffer[] = [];
  const geometriesPacked = geometries
    .map((geometry) => {
      const positions = new Float32Array(geometry.positions);
      const indices = new Uint16Array(geometry.indices.length);
      for (let i = 0; i < geometry.indices.length; i++) {
        indices[i] = geometry.indices[i];
      }

      const normals = workerComputeNormals(positions, indices);
      const bs = workerComputeBoundingSphere(positions);

      const packedGeometry = {
        indices,
        lights: new Int32Array(geometry.lights),
        positions,
        uvs: new Float32Array(geometry.uvs),
        normals,
        bsCenter: bs.center,
        bsRadius: bs.radius,
        voxel: geometry.voxel,
        faceName: geometry.faceName,
        at: geometry.at,
      };

      arrayBuffers.push(packedGeometry.indices.buffer);
      arrayBuffers.push(packedGeometry.lights.buffer);
      arrayBuffers.push(packedGeometry.positions.buffer);
      arrayBuffers.push(packedGeometry.uvs.buffer);
      arrayBuffers.push(packedGeometry.normals.buffer as ArrayBuffer);

      return packedGeometry;
    })
    .filter((geometry) => geometry.positions.length > 0);

  // @ts-expect-error postMessage typing
  postMessage({ geometries: geometriesPacked }, arrayBuffers);
};

function convertRegistryToWasm(rawRegistry: {
  blocksById: [number, RawWasmBlock][];
  blocksByName: [string, RawWasmBlock][];
}): WasmRegistry {
  const blocksById: [number, WasmBlock][] = rawRegistry.blocksById.map(
    ([id, block]) => {
      const wasmBlock: WasmBlock = {
        id: block.id,
        name: block.name,
        rotatable: block.rotatable,
        yRotatable: block.yRotatable,
        isEmpty: block.isEmpty,
        isFluid: block.isFluid,
        isWaterlogged: block.isWaterlogged,
        isOpaque: block.isOpaque,
        isSeeThrough: block.isSeeThrough,
        isTransparent: block.isTransparent,
        transparentStandalone: block.transparentStandalone as boolean,
        occludesFluid: block.occludesFluid ?? false,
        isPlant: block.isPlant ?? false,
        faces: convertFaces(block.faces),
        aabbs: convertAabbs(block.aabbs),
        dynamicPatterns: block.dynamicPatterns
          ? convertDynamicPatterns(block.dynamicPatterns)
          : null,
      };
      return [id, wasmBlock];
    },
  );

  return { blocksById };
}

function convertFaces(faces: RawWasmFace[] | undefined): WasmBlock["faces"] {
  if (!faces) return [];
  return faces.map((face) => ({
    name: face.name,
    independent: face.independent,
    isolated: face.isolated,
    textureGroup: face.textureGroup ?? null,
    dir: face.dir,
    corners: face.corners.map((corner) => ({
      pos: corner.pos,
      uv: corner.uv,
    })),
    range: {
      startU: face.range?.startU ?? 0,
      endU: face.range?.endU ?? 1,
      startV: face.range?.startV ?? 0,
      endV: face.range?.endV ?? 1,
    },
  }));
}

function convertAabbs(aabbs: RawWasmAabb[] | undefined): WasmBlock["aabbs"] {
  if (!aabbs) return [];
  return aabbs.map((aabb) => ({
    minX: aabb.minX,
    minY: aabb.minY,
    minZ: aabb.minZ,
    maxX: aabb.maxX,
    maxY: aabb.maxY,
    maxZ: aabb.maxZ,
  }));
}

function convertDynamicPatterns(
  patterns: RawWasmDynamicPattern[],
): WasmBlock["dynamicPatterns"] {
  if (!patterns) return null;
  return patterns.map((pattern) => ({
    parts: pattern.parts.map((part) => ({
      rule: part.rule,
      faces: convertFaces(part.faces),
      aabbs: convertAabbs(part.aabbs),
      isTransparent: part.isTransparent ?? [
        false,
        false,
        false,
        false,
        false,
        false,
      ],
      worldSpace: part.worldSpace ?? false,
    })),
  }));
}
