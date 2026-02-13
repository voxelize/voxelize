import init, {
  process_light_batch_fast,
  set_registry,
} from "@voxelize/wasm-lighter";

import { Coords2, Coords3 } from "../../../types";
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

interface DeltaBatch {
  cx: number;
  cz: number;
  deltas: VoxelDelta[];
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
  lastRelevantSequenceId: number;
  relevantDeltas: DeltaBatch[];
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
let pendingBatchMessagesHead = 0;
const MAX_PENDING_BATCH_MESSAGES = 512;
const reusableBoundsMin = new Int32Array(3);
const reusableBoundsShape = new Uint32Array(3);
const emptyUint32Array = new Uint32Array(0);

const hasPendingBatchMessages = () =>
  pendingBatchMessagesHead < pendingBatchMessages.length;

const pendingBatchMessageCount = () =>
  pendingBatchMessages.length - pendingBatchMessagesHead;

const normalizePendingBatchMessages = () => {
  if (pendingBatchMessagesHead === 0) {
    return;
  }

  if (pendingBatchMessagesHead >= pendingBatchMessages.length) {
    pendingBatchMessages.length = 0;
    pendingBatchMessagesHead = 0;
    return;
  }

  if (
    pendingBatchMessagesHead >= 1024 &&
    pendingBatchMessagesHead * 2 >= pendingBatchMessages.length
  ) {
    pendingBatchMessages.copyWithin(0, pendingBatchMessagesHead);
    pendingBatchMessages.length -= pendingBatchMessagesHead;
    pendingBatchMessagesHead = 0;
  }
};

const postEmptyBatchResult = (jobId: string, lastSequenceId = 0) => {
  postMessage({
    jobId,
    modifiedChunks: [],
    appliedDeltas: { lastSequenceId },
  });
};

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
): (RawChunk | null)[] => {
  const chunkGrid: (RawChunk | null)[] = new Array(gridWidth * gridDepth);

  for (let index = 0; index < chunkGrid.length; index++) {
    const chunkData = chunksData[index];
    chunkGrid[index] = chunkData ? RawChunk.deserialize(chunkData) : null;
  }

  return chunkGrid;
};

const applyRelevantDeltas = (
  chunkGrid: (RawChunk | null)[],
  gridWidth: number,
  gridDepth: number,
  gridOffsetX: number,
  gridOffsetZ: number,
  relevantDeltas: DeltaBatch[]
): number => {
  let lastSequenceId = 0;

  for (const { cx, cz, deltas } of relevantDeltas) {
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

    const chunk = chunkGrid[localX * gridDepth + localZ];
    if (!chunk) {
      continue;
    }

    if (deltas.length > 0) {
      const chunkLastSequenceId = deltas[deltas.length - 1].sequenceId;
      if (chunkLastSequenceId > lastSequenceId) {
        lastSequenceId = chunkLastSequenceId;
      }
    }

    for (const delta of deltas) {
      const { coords, newVoxel, newRotation, newStage } = delta;
      const vx = coords[0];
      const vy = coords[1];
      const vz = coords[2];

      chunk.setVoxel(vx, vy, vz, newVoxel);
      if (newRotation) {
        chunk.setVoxelRotation(vx, vy, vz, newRotation);
      }
      if (newStage !== undefined) {
        chunk.setVoxelStage(vx, vy, vz, newStage);
      }
    }
  }

  return lastSequenceId;
};

const serializeChunkGrid = (
  chunkGrid: (RawChunk | null)[],
  gridWidth: number,
  gridDepth: number
) => {
  const cellCount = gridWidth * gridDepth;
  const serialized: (
    | {
        voxels: Uint32Array;
        lights: Uint32Array;
        shape: [number, number, number];
      }
    | null
  )[] = new Array(cellCount);

  for (let index = 0; index < cellCount; index++) {
    const chunk = chunkGrid[index];
    if (!chunk) {
      serialized[index] = null;
      continue;
    }

    const { size, maxHeight } = chunk.options;
    serialized[index] = {
      voxels: chunk.voxels.data,
      lights: chunk.lights.data,
      shape: [size, maxHeight, size],
    };
  }

  return serialized;
};

const serializeChunksData = (
  chunksData: (SerializedChunkData | null)[],
  gridWidth: number,
  gridDepth: number
) => {
  const cellCount = gridWidth * gridDepth;
  const serialized: (
    | {
        voxels: Uint32Array;
        lights: Uint32Array;
        shape: [number, number, number];
      }
    | null
  )[] = new Array(cellCount);

  for (let index = 0; index < cellCount; index++) {
    const chunkData = chunksData[index];
    if (!chunkData) {
      serialized[index] = null;
      continue;
    }

    const { size, maxHeight } = chunkData.options;
    serialized[index] = {
      voxels: chunkData.voxels.byteLength
        ? new Uint32Array(chunkData.voxels)
        : emptyUint32Array,
      lights: chunkData.lights.byteLength
        ? new Uint32Array(chunkData.lights)
        : emptyUint32Array,
      shape: [size, maxHeight, size],
    };
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

  let hasAnyChunk = false;
  for (let index = 0; index < chunksData.length; index++) {
    if (chunksData[index]) {
      hasAnyChunk = true;
      break;
    }
  }

  if (!hasAnyChunk) {
    postEmptyBatchResult(jobId, 0);
    return;
  }

  let lastSequenceId = 0;
  let serializedChunks:
    | (
        | {
            voxels: Uint32Array;
            lights: Uint32Array;
            shape: [number, number, number];
          }
        | null
      )[];

  if (relevantDeltas.length === 0) {
    serializedChunks = serializeChunksData(chunksData, gridWidth, gridDepth);
  } else {
    const chunkGrid = deserializeChunkGrid(chunksData, gridWidth, gridDepth);
    lastSequenceId = applyRelevantDeltas(
      chunkGrid,
      gridWidth,
      gridDepth,
      gridOffsetX,
      gridOffsetZ,
      relevantDeltas
    );
    serializedChunks = serializeChunkGrid(chunkGrid, gridWidth, gridDepth);
  }

  reusableBoundsMin[0] = boundingBox.min[0];
  reusableBoundsMin[1] = boundingBox.min[1];
  reusableBoundsMin[2] = boundingBox.min[2];
  reusableBoundsShape[0] = boundingBox.shape[0];
  reusableBoundsShape[1] = boundingBox.shape[1];
  reusableBoundsShape[2] = boundingBox.shape[2];
  const wasmResult = process_light_batch_fast(
    serializedChunks,
    gridWidth,
    gridDepth,
    gridOffsetX,
    gridOffsetZ,
    colorToIndex(color),
    lightOps.removals,
    lightOps.floods,
    reusableBoundsMin,
    reusableBoundsShape,
    options.chunkSize,
    options.maxHeight,
    options.maxLightLevel
  ) as WasmLightBatchResult;

  const modifiedChunkCount = wasmResult.modifiedChunks.length;
  const modifiedChunks = new Array<{
    coords: Coords2;
    lights: Uint32Array;
  }>(modifiedChunkCount);
  const transferBuffers = new Array<ArrayBuffer>(modifiedChunkCount);

  for (let index = 0; index < modifiedChunkCount; index++) {
    const chunk = wasmResult.modifiedChunks[index];
    const lights = new Uint32Array(chunk.lights);
    modifiedChunks[index] = {
      coords: chunk.coords,
      lights,
    };
    transferBuffers[index] = lights.buffer;
  }

  postMessage(
    {
      jobId,
      modifiedChunks,
      appliedDeltas: { lastSequenceId },
    },
    {
      transfer: transferBuffers,
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

    if (hasPendingBatchMessages()) {
      const start = pendingBatchMessagesHead;
      const end = pendingBatchMessages.length;
      for (let i = start; i < end; i++) {
        processBatchMessage(pendingBatchMessages[i]);
      }
      pendingBatchMessages.length = 0;
      pendingBatchMessagesHead = 0;
    }

    return;
  }

  await ensureWasmInitialized();

  if (!registryInitialized) {
    if (pendingBatchMessageCount() >= MAX_PENDING_BATCH_MESSAGES) {
      const dropped = pendingBatchMessages[pendingBatchMessagesHead];
      pendingBatchMessagesHead++;
      postEmptyBatchResult(dropped.jobId, dropped.lastRelevantSequenceId);
      normalizePendingBatchMessages();
    }
    pendingBatchMessages.push(message);
    return;
  }

  processBatchMessage(message);
};
