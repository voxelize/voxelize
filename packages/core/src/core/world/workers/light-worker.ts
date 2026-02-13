import init, {
  process_light_batch_fast,
  set_registry,
} from "@voxelize/wasm-lighter";

import { Coords2, Coords3 } from "../../../types";
import { ChunkUtils } from "../../../utils/chunk-utils";
import { LightColor } from "../../../utils/light-utils";
import { BlockRule } from "../block";
import type { LightNode, VoxelDelta, WorldOptions } from "../index";
import { RawChunk } from "../raw-chunk";

interface SerializedDynamicPart {
  rule: BlockRule;
  redLightLevel?: number;
  greenLightLevel?: number;
  blueLightLevel?: number;
}

interface SerializedDynamicPattern {
  parts: SerializedDynamicPart[];
}

interface SerializedBlock {
  id: number;
  isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean];
  isOpaque: boolean;
  isLight: boolean;
  lightReduce: boolean;
  redLightLevel: number;
  greenLightLevel: number;
  blueLightLevel: number;
  dynamicPatterns?: SerializedDynamicPattern[] | null;
}

interface SerializedRegistry {
  blocksById: [number, SerializedBlock][];
}

interface WasmLightConditionalPart {
  rule: BlockRule;
  redLightLevel?: number;
  greenLightLevel?: number;
  blueLightLevel?: number;
}

interface WasmLightDynamicPattern {
  parts: WasmLightConditionalPart[];
}

interface WasmLightBlock {
  id: number;
  isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean];
  isOpaque: boolean;
  isLight: boolean;
  lightReduce: boolean;
  redLightLevel: number;
  greenLightLevel: number;
  blueLightLevel: number;
  dynamicPatterns: WasmLightDynamicPattern[] | null;
}

interface WasmLightRegistry {
  blocksById: [number, WasmLightBlock][];
}

interface SerializedChunkData {
  id: string;
  x: number;
  z: number;
  voxels: ArrayBuffer;
  lights: ArrayBuffer;
  options: {
    size: number;
    maxHeight: number;
    maxLightLevel: number;
    subChunks: number;
  };
}

interface LightBatchMessage {
  type: "batchOperations";
  jobId: string;
  color: LightColor;
  boundingBox: {
    min: Coords3;
    shape: Coords3;
  };
  chunksData: (SerializedChunkData | null)[];
  chunkGridDimensions: [number, number];
  chunkGridOffset: [number, number];
  relevantDeltas: Record<string, VoxelDelta[]>;
  lightOps: {
    removals: Coords3[];
    floods: LightNode[];
  };
  options: WorldOptions;
}

interface InitMessage {
  type: "init";
  registryData: SerializedRegistry;
}

type LightWorkerMessage = InitMessage | LightBatchMessage;

interface WasmLightChunkResult {
  coords: Coords2;
  lights: number[];
}

interface WasmLightBatchResult {
  modifiedChunks: WasmLightChunkResult[];
}

let wasmInitialized = false;
let registryInitialized = false;
const pendingBatchMessages: LightBatchMessage[] = [];

const ensureWasmInitialized = async () => {
  if (!wasmInitialized) {
    await init();
    wasmInitialized = true;
  }
};

const convertDynamicPatterns = (
  patterns: SerializedDynamicPattern[] | null | undefined
): WasmLightDynamicPattern[] | null => {
  if (!patterns) {
    return null;
  }

  return patterns.map((pattern) => ({
    parts: pattern.parts.map((part) => ({
      rule: part.rule,
      redLightLevel: part.redLightLevel,
      greenLightLevel: part.greenLightLevel,
      blueLightLevel: part.blueLightLevel,
    })),
  }));
};

const convertRegistryToWasm = (registry: SerializedRegistry): WasmLightRegistry => {
  const blocksById: [number, WasmLightBlock][] = registry.blocksById.map(
    ([id, block]) => [
      id,
      {
        id: block.id,
        isTransparent: block.isTransparent,
        isOpaque: block.isOpaque,
        isLight: block.isLight,
        lightReduce: block.lightReduce,
        redLightLevel: block.redLightLevel,
        greenLightLevel: block.greenLightLevel,
        blueLightLevel: block.blueLightLevel,
        dynamicPatterns: convertDynamicPatterns(block.dynamicPatterns),
      },
    ]
  );

  return { blocksById };
};

const colorToIndex = (color: LightColor): number => {
  switch (color) {
    case "SUNLIGHT":
      return 0;
    case "RED":
      return 1;
    case "GREEN":
      return 2;
    case "BLUE":
      return 3;
  }
};

const deserializeChunkGrid = (
  chunksData: (SerializedChunkData | null)[],
  gridWidth: number,
  gridDepth: number
): (RawChunk | null)[][] => {
  const chunkGrid: (RawChunk | null)[][] = [];
  let index = 0;

  for (let x = 0; x < gridWidth; x++) {
    chunkGrid[x] = [];
    for (let z = 0; z < gridDepth; z++) {
      const chunkData = chunksData[index++];
      chunkGrid[x][z] = chunkData ? RawChunk.deserialize(chunkData) : null;
    }
  }

  return chunkGrid;
};

const applyRelevantDeltas = (
  chunkGrid: (RawChunk | null)[][],
  gridWidth: number,
  gridDepth: number,
  gridOffsetX: number,
  gridOffsetZ: number,
  relevantDeltas: Record<string, VoxelDelta[]>
): number => {
  let lastSequenceId = 0;

  for (const [chunkName, deltas] of Object.entries(relevantDeltas)) {
    const [cx, cz] = ChunkUtils.parseChunkName(chunkName);
    const localX = cx - gridOffsetX;
    const localZ = cz - gridOffsetZ;

    if (
      localX < 0 ||
      localX >= gridWidth ||
      localZ < 0 ||
      localZ >= gridDepth
    ) {
      continue;
    }

    const chunk = chunkGrid[localX][localZ];
    if (!chunk) {
      continue;
    }

    for (const delta of deltas) {
      const { coords, newVoxel, newRotation, newStage, sequenceId } = delta;
      chunk.setVoxel(coords[0], coords[1], coords[2], newVoxel);
      if (newRotation) {
        chunk.setVoxelRotation(coords[0], coords[1], coords[2], newRotation);
      }
      if (newStage !== undefined) {
        chunk.setVoxelStage(coords[0], coords[1], coords[2], newStage);
      }
      lastSequenceId = Math.max(lastSequenceId, sequenceId);
    }
  }

  return lastSequenceId;
};

const serializeChunkGrid = (
  chunkGrid: (RawChunk | null)[][],
  gridWidth: number,
  gridDepth: number
) => {
  const serialized: (
    | {
        voxels: Uint32Array;
        lights: Uint32Array;
        shape: [number, number, number];
      }
    | null
  )[] = [];

  for (let x = 0; x < gridWidth; x++) {
    for (let z = 0; z < gridDepth; z++) {
      const chunk = chunkGrid[x][z];
      if (!chunk) {
        serialized.push(null);
        continue;
      }

      const { size, maxHeight } = chunk.options;
      serialized.push({
        voxels: chunk.voxels.data,
        lights: chunk.lights.data,
        shape: [size, maxHeight, size],
      });
    }
  }

  return serialized;
};

const processBatchMessage = (message: LightBatchMessage) => {
  const {
    jobId,
    color,
    boundingBox,
    chunksData,
    chunkGridDimensions,
    chunkGridOffset,
    relevantDeltas,
    lightOps,
    options,
  } = message;

  const [gridWidth, gridDepth] = chunkGridDimensions;
  const [gridOffsetX, gridOffsetZ] = chunkGridOffset;
  const chunkGrid = deserializeChunkGrid(chunksData, gridWidth, gridDepth);
  const lastSequenceId = applyRelevantDeltas(
    chunkGrid,
    gridWidth,
    gridDepth,
    gridOffsetX,
    gridOffsetZ,
    relevantDeltas
  );

  const serializedChunks = serializeChunkGrid(chunkGrid, gridWidth, gridDepth);
  const boundsMin = Int32Array.from(boundingBox.min);
  const boundsShape = Uint32Array.from([
    boundingBox.shape[0],
    boundingBox.shape[1],
    boundingBox.shape[2],
  ]);
  const wasmResult = process_light_batch_fast(
    serializedChunks,
    gridWidth,
    gridDepth,
    gridOffsetX,
    gridOffsetZ,
    colorToIndex(color),
    lightOps.removals,
    lightOps.floods,
    boundsMin,
    boundsShape,
    options.chunkSize,
    options.maxHeight,
    options.maxLightLevel
  ) as WasmLightBatchResult;

  const modifiedChunks = wasmResult.modifiedChunks.map((chunk) => ({
    coords: chunk.coords,
    lights: new Uint32Array(chunk.lights),
  }));

  postMessage(
    {
      jobId,
      modifiedChunks,
      appliedDeltas: { lastSequenceId },
    },
    {
      transfer: modifiedChunks.map((chunk) => chunk.lights.buffer),
    }
  );
};

onmessage = async (event: MessageEvent<LightWorkerMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    await ensureWasmInitialized();

    const wasmRegistry = convertRegistryToWasm(message.registryData);
    set_registry(wasmRegistry);
    registryInitialized = true;

    if (pendingBatchMessages.length > 0) {
      const toProcess = pendingBatchMessages.splice(0, pendingBatchMessages.length);
      for (const pendingBatchMessage of toProcess) {
        processBatchMessage(pendingBatchMessage);
      }
    }

    return;
  }

  await ensureWasmInitialized();

  if (!registryInitialized) {
    pendingBatchMessages.push(message);
    return;
  }

  processBatchMessage(message);
};
