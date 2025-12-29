import init, { mesh_chunk_fast, set_registry } from "@voxelize/wasm-mesher";

import { Coords3 } from "../../../types";
import { type WorldOptions } from "../index";

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

type GeometryProtocol = {
  voxel: number;
  at: Coords3 | null;
  faceName: string | null;
  positions: number[];
  indices: number[];
  uvs: number[];
  lights: number[];
};

let wasmInitialized = false;

const minArray = new Int32Array(3);
const maxArray = new Int32Array(3);
const emptyUint32Array = new Uint32Array(0);

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
  const { chunkSize, greedyMeshing = true } = e.data.options as WorldOptions;

  const chunks = chunksData.map(
    (
      chunkData: {
        id: string;
        x: number;
        z: number;
        voxels: ArrayBuffer;
        lights: ArrayBuffer;
        options: { size: number; maxHeight: number };
      } | null
    ): ChunkData | null => {
      if (!chunkData) return null;

      const { x, z, voxels, lights, options } = chunkData;
      const { size, maxHeight } = options;

      return {
        voxels:
          voxels && voxels.byteLength
            ? new Uint32Array(voxels)
            : emptyUint32Array,
        lights:
          lights && lights.byteLength
            ? new Uint32Array(lights)
            : emptyUint32Array,
        shape: [size, maxHeight, size] as [number, number, number],
        min: [x * size, 0, z * size] as [number, number, number],
      };
    }
  );

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
  const geometries = result.geometries;

  const arrayBuffers: ArrayBuffer[] = [];
  const geometriesPacked = geometries
    .map((geometry) => {
      const packedGeometry = {
        indices: new Uint16Array(geometry.indices.length),
        lights: new Int32Array(geometry.lights),
        positions: new Float32Array(geometry.positions),
        uvs: new Float32Array(geometry.uvs),
        voxel: geometry.voxel,
        faceName: geometry.faceName,
        at: geometry.at,
      };

      for (let i = 0; i < geometry.indices.length; i++) {
        packedGeometry.indices[i] = geometry.indices[i];
      }

      arrayBuffers.push(packedGeometry.indices.buffer);
      arrayBuffers.push(packedGeometry.lights.buffer);
      arrayBuffers.push(packedGeometry.positions.buffer);
      arrayBuffers.push(packedGeometry.uvs.buffer);

      return packedGeometry;
    })
    .filter((geometry) => geometry.positions.length > 0);

  // @ts-expect-error postMessage typing
  postMessage({ geometries: geometriesPacked }, arrayBuffers);
};

function convertRegistryToWasm(rawRegistry: {
  blocksById: [number, object][];
  blocksByName: [string, object][];
}): WasmRegistry {
  const blocksById: [number, WasmBlock][] = rawRegistry.blocksById.map(
    ([id, block]: [number, Record<string, unknown>]) => {
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
        faces: convertFaces(block.faces as Record<string, unknown>[]),
        aabbs: convertAabbs(block.aabbs as Record<string, unknown>[]),
        dynamicPatterns: block.dynamicPatterns
          ? convertDynamicPatterns(
              block.dynamicPatterns as Record<string, unknown>[]
            )
          : null,
      };
      return [id, wasmBlock];
    }
  );

  return { blocksById };
}

function convertFaces(faces: Record<string, unknown>[]): WasmBlock["faces"] {
  if (!faces) return [];
  return faces.map((face) => ({
    name: face.name as string,
    independent: face.independent as boolean,
    isolated: face.isolated as boolean,
    textureGroup: (face.textureGroup as string) ?? null,
    dir: face.dir as [number, number, number],
    corners: (face.corners as Record<string, unknown>[]).map((corner) => ({
      pos: corner.pos as [number, number, number],
      uv: corner.uv as [number, number],
    })),
    range: {
      startU: (face.range as Record<string, number>)?.startU ?? 0,
      endU: (face.range as Record<string, number>)?.endU ?? 1,
      startV: (face.range as Record<string, number>)?.startV ?? 0,
      endV: (face.range as Record<string, number>)?.endV ?? 1,
    },
  }));
}

function convertAabbs(aabbs: Record<string, unknown>[]): WasmBlock["aabbs"] {
  if (!aabbs) return [];
  return aabbs.map((aabb) => ({
    minX: aabb.minX as number,
    minY: aabb.minY as number,
    minZ: aabb.minZ as number,
    maxX: aabb.maxX as number,
    maxY: aabb.maxY as number,
    maxZ: aabb.maxZ as number,
  }));
}

function convertDynamicPatterns(
  patterns: Record<string, unknown>[]
): WasmBlock["dynamicPatterns"] {
  if (!patterns) return null;
  return patterns.map((pattern) => ({
    parts: (pattern.parts as Record<string, unknown>[]).map((part) => ({
      rule: part.rule as object,
      faces: convertFaces(part.faces as Record<string, unknown>[]),
      aabbs: convertAabbs(part.aabbs as Record<string, unknown>[]),
      isTransparent: (part.isTransparent as [
        boolean,
        boolean,
        boolean,
        boolean,
        boolean,
        boolean
      ]) ?? [false, false, false, false, false, false],
      worldSpace: (part.worldSpace as boolean) ?? false,
    })),
  }));
}
