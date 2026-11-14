import init, {
  mesh_chunk_packed,
  set_float_blocks,
  set_registry,
} from "@voxelize/wasm-mesher";

import { Coords3 } from "../../../types";
import { type BranchShape, type BranchSocket } from "../branch";
import { type WorldOptions } from "../index";
import { type SerializedChunkPayload } from "../raw-chunk";
import { Registry } from "../registry";
import {
  isMainThreadSortedBlock,
  positionUnitsPerBlock,
} from "../vertex-quantization";

import { WORKER_READY_MESSAGE_TYPE } from "./worker-ready";

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
  isWaterloggable: boolean;
  isWaterloggingFluid: boolean;
  isOpaque: boolean;
  isSeeThrough: boolean;
  isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean];
  transparentStandalone: boolean;
  standaloneFaceDepth: number;
  occludesFluid: boolean;
  isPlant: boolean;
  stackGroup: number;
  isAnimated: boolean;
  faces: {
    name: string;
    independent: boolean;
    isolated: boolean;
    textureGroup: string | null;
    dir: [number, number, number];
    corners: { pos: [number, number, number]; uv: [number, number] }[];
    range: { startU: number; endU: number; startV: number; endV: number };
    emissive: number;
    stageTintMask: number;
    pigmentMask: number;
    regionalTint: boolean;
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
            emissive: number;
            stageTintMask: number;
            pigmentMask: number;
            regionalTint: boolean;
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
  connected: ConnectedFrame | null;
  // Mirror `branch`, `branch_sockets` and `branch_shell` on the mesher's
  // `Block`. Dropping any would mesh a branch as its plain texture cube,
  // leave twigs short of their leaves, or draw a wide trunk's shells as
  // cubes the moment a chunk re-meshes locally.
  branch: BranchShape | null;
  branchSockets: BranchSocket[];
  branchShell: boolean;
  // Mirrors `stage_faces`: without it a voxel whose stage picks the block's
  // other look re-meshes locally in its plain one.
  stageFaces: { mask: number; faces: WasmBlock["faces"] } | null;
  // Mirrors `tufts`: without it a canopy's soft outline drops off the moment
  // a chunk re-meshes locally.
  tufts: {
    faces: WasmBlock["faces"];
    stageFaces: WasmBlock["faces"];
    jitter: number;
    tilt: number;
  } | null;
};

// Mirrors `ConnectedFrame` in crates/mesher/src/mesher/types.rs. Dropping it
// here would mesh joined glass with every frame on the moment a chunk
// re-meshes locally, while the server's meshes drew only the outline.
type ConnectedFrame = {
  key: number;
  frameTexels: number;
  cornerTexels: number;
  texelsPerBlock: number;
  clearInterior: boolean;
  interiorOneIn?: number;
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
  emissive?: number;
  stageTintMask?: number;
  pigmentMask?: number;
  regionalTint?: boolean;
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
  isWaterloggable?: boolean;
  isWaterloggingFluid?: boolean;
  isOpaque: boolean;
  isSeeThrough: boolean;
  isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean];
  transparentStandalone: boolean;
  standaloneFaceDepth?: number;
  lightAttenuation?: number;
  occludesFluid?: boolean;
  isPlant?: boolean;
  stackGroup?: number;
  isAnimated?: boolean;
  faces: RawWasmFace[];
  aabbs: RawWasmAabb[];
  dynamicPatterns?: RawWasmDynamicPattern[] | null;
  connected?: ConnectedFrame | null;
  branch?: BranchShape | null;
  branchSockets?: BranchSocket[];
  branchShell?: boolean;
  stageFaces?: { mask: number; faces: RawWasmFace[] } | null;
  tufts?: {
    faces: RawWasmFace[];
    stageFaces?: RawWasmFace[];
    jitter: number;
    tilt?: number;
  } | null;
};

/**
 * A geometry as the mesher hands it back (`mesh_chunk_packed`): already in
 * the typed arrays the main thread uploads, each on a buffer of its own.
 */
type PackedGeometry = {
  voxel: number;
  at?: Coords3;
  faceName?: string;
  positions: Uint16Array | Float32Array;
  uvs: Uint16Array | Float32Array;
  normals: Int8Array | Float32Array;
  indices: Uint16Array | Uint32Array;
  lights: Int32Array;
  lightTwist: Uint8Array;
  bsCenter: [number, number, number];
  bsRadius: number;
};

/** Where a mesh call's time went inside the mesher, in milliseconds. */
type MeshTimings = { readMs: number; meshMs: number; packMs: number };

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

    // Arrives as one JSON string (see Registry.serialize); parsing it here
    // is what keeps the main thread out of the registry hand-off.
    const rawRegistry = Registry.parseSerialized(e.data.registryData);
    const wasmRegistry = convertRegistryToWasm(rawRegistry);
    set_registry(wasmRegistry);
    // The blocks the main thread sorts keep float attributes; every other
    // block's geometry comes back packed compact (vertex-quantization.ts).
    set_float_blocks(
      Uint32Array.from(
        rawRegistry.blocksById
          .filter(([, block]: [number, RawWasmBlock]) =>
            isMainThreadSortedBlock({
              isFluid: block.isFluid,
              isSeeThrough: block.isSeeThrough,
              transparentStandalone: block.transparentStandalone,
              lightAttenuation: block.lightAttenuation ?? 0,
            }),
          )
          .map(([id]: [number, RawWasmBlock]) => id),
      ),
    );
    // The pool hands this worker no job until it hears this.
    // @ts-expect-error postMessage typing
    postMessage({ type: WORKER_READY_MESSAGE_TYPE }, []);
    return;
  }

  if (!wasmInitialized) {
    console.warn("[mesh-worker] mesh request before init; returning empty");
    // @ts-expect-error postMessage typing
    postMessage({ geometries: [] }, []);
    return;
  }

  const { chunksData, min, max } = e.data;
  const options = e.data.options as WorldOptions;
  // A free-standing voxel box rides as one chunk as wide as itself; its
  // geometry still quantizes on the world's own section scale.
  const chunkSize: number = e.data.meshChunkSize ?? options.chunkSize;
  const positionUnits = positionUnitsPerBlock(options);

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

  // The mesher reads the part of each chunk a section's mesh can touch
  // straight out of these arrays, and returns every geometry packed: normals,
  // bounding sphere, light twist and quantization are done in the same call
  // that meshed it, so nothing here walks a vertex.
  let result: {
    geometries: PackedGeometry[];
    connectivity: number;
    timings: MeshTimings;
  };
  try {
    result = mesh_chunk_packed(
      chunks,
      minArray,
      maxArray,
      chunkSize,
      positionUnits,
    ) as typeof result;
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

  const arrayBuffers: ArrayBuffer[] = [];
  for (const geometry of result.geometries) {
    arrayBuffers.push(
      geometry.indices.buffer as ArrayBuffer,
      geometry.lights.buffer as ArrayBuffer,
      geometry.lightTwist.buffer as ArrayBuffer,
      geometry.positions.buffer as ArrayBuffer,
      geometry.uvs.buffer as ArrayBuffer,
      geometry.normals.buffer as ArrayBuffer,
    );
  }

  const payload = {
    geometries: result.geometries,
    connectivity: result.connectivity,
    timings: result.timings,
  };
  // @ts-expect-error postMessage typing
  postMessage(payload, arrayBuffers);
};

export function convertRegistryToWasm(rawRegistry: {
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
        isWaterloggable: block.isWaterloggable ?? false,
        isWaterloggingFluid: block.isWaterloggingFluid ?? false,
        isOpaque: block.isOpaque,
        isSeeThrough: block.isSeeThrough,
        isTransparent: block.isTransparent,
        transparentStandalone: block.transparentStandalone as boolean,
        standaloneFaceDepth: block.standaloneFaceDepth ?? 0,
        occludesFluid: block.occludesFluid ?? false,
        isPlant: block.isPlant ?? false,
        stackGroup: block.stackGroup ?? 0,
        isAnimated: block.isAnimated ?? false,
        faces: convertFaces(block.faces),
        aabbs: convertAabbs(block.aabbs),
        dynamicPatterns: block.dynamicPatterns
          ? convertDynamicPatterns(block.dynamicPatterns)
          : null,
        connected: block.connected ?? null,
        branch: block.branch ?? null,
        branchSockets: block.branchSockets ?? [],
        branchShell: block.branchShell ?? false,
        stageFaces: block.stageFaces
          ? {
              mask: block.stageFaces.mask,
              faces: convertFaces(block.stageFaces.faces),
            }
          : null,
        tufts: block.tufts
          ? {
              faces: convertFaces(block.tufts.faces),
              stageFaces: convertFaces(block.tufts.stageFaces ?? []),
              jitter: block.tufts.jitter,
              tilt: block.tufts.tilt ?? 0,
            }
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
    emissive: face.emissive ?? 0,
    stageTintMask: face.stageTintMask ?? 0,
    pigmentMask: face.pigmentMask ?? 0,
    regionalTint: face.regionalTint ?? false,
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
