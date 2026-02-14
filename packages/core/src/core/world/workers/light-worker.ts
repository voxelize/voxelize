import init, {
  process_light_batch_fast,
  set_registry,
} from "@voxelize/wasm-lighter";

import { Coords2, Coords3 } from "../../../types";
import { LightColor } from "../../../utils/light-utils";
import { BlockRule } from "../block";
import type { LightNode, VoxelDelta, WorldOptions } from "../index";
import { RawChunk } from "../raw-chunk";
import type { SerializedRawChunk } from "../raw-chunk";

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

interface DeltaBatch {
  cx: number;
  cz: number;
  deltas: VoxelDelta[];
  startIndex?: number;
}

interface LightBatchMessage {
  type: "batchOperations";
  jobId: string;
  color: LightColor;
  boundingBox: {
    min: Coords3;
    shape: Coords3;
  };
  chunksData: (SerializedRawChunk | null)[];
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
  lights: Uint32Array;
}

interface WasmLightBatchResult {
  modifiedChunks: WasmLightChunkResult[];
}

type WorkerModifiedChunk = {
  coords: Coords2;
  lights: Uint32Array;
};

type SerializedWasmChunk =
  | {
      voxels: Uint32Array;
      lights: Uint32Array;
      shape: [number, number, number];
    }
  | null;

let wasmInitialized = false;
let registryInitialized = false;
const pendingBatchMessages: LightBatchMessage[] = [];
let pendingBatchMessagesHead = 0;
const MAX_PENDING_BATCH_MESSAGES = 512;
const reusableBoundsMin = new Int32Array(3);
const reusableBoundsShape = new Uint32Array(3);
const emptyUint32Array = new Uint32Array(0);
const emptyTransferList: Transferable[] = [];
const reusableModifiedChunks: WorkerModifiedChunk[] = [];
const reusableTransferBuffers: ArrayBuffer[] = [];
const reusableSerializedChunks: SerializedWasmChunk[] = [];
const reusableChunkShape: [number, number, number] = [0, 0, 0];
const reusablePostMessageOptions: StructuredSerializeOptions = {
  transfer: emptyTransferList,
};

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

  const convertedPatterns = new Array<WasmLightDynamicPattern>(patterns.length);
  for (let patternIndex = 0; patternIndex < patterns.length; patternIndex++) {
    const pattern = patterns[patternIndex];
    const convertedParts = new Array<WasmLightConditionalPart>(
      pattern.parts.length
    );
    for (let partIndex = 0; partIndex < pattern.parts.length; partIndex++) {
      const part = pattern.parts[partIndex];
      convertedParts[partIndex] = {
        rule: part.rule,
        redLightLevel: part.redLightLevel,
        greenLightLevel: part.greenLightLevel,
        blueLightLevel: part.blueLightLevel,
      };
    }
    convertedPatterns[patternIndex] = { parts: convertedParts };
  }

  return convertedPatterns;
};

const convertRegistryToWasm = (registry: SerializedRegistry): WasmLightRegistry => {
  const blocksById = new Array<[number, WasmLightBlock]>(
    registry.blocksById.length
  );
  for (let blockIndex = 0; blockIndex < registry.blocksById.length; blockIndex++) {
    const [id, block] = registry.blocksById[blockIndex];
    blocksById[blockIndex] = [
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
    ];
  }

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
  chunksData: (SerializedRawChunk | null)[],
  gridWidth: number,
  gridDepth: number
): { chunkGrid: (RawChunk | null)[]; hasAnyChunk: boolean } => {
  const cellCount = gridWidth * gridDepth;
  const chunkGrid: (RawChunk | null)[] = new Array(cellCount);
  let hasAnyChunk = false;

  for (let index = 0; index < cellCount; index++) {
    const chunkData = chunksData[index];
    if (!chunkData) {
      chunkGrid[index] = null;
      continue;
    }

    hasAnyChunk = true;
    chunkGrid[index] = RawChunk.deserialize(chunkData);
  }

  return { chunkGrid, hasAnyChunk };
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

  for (let batchIndex = 0; batchIndex < relevantDeltas.length; batchIndex++) {
    const deltaBatch = relevantDeltas[batchIndex];
    const { cx, cz, deltas } = deltaBatch;
    const startIndex = deltaBatch.startIndex ?? 0;
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

    const deltasLength = deltas.length;
    if (deltasLength > 0) {
      const chunkLastSequenceId = deltas[deltasLength - 1].sequenceId;
      if (chunkLastSequenceId > lastSequenceId) {
        lastSequenceId = chunkLastSequenceId;
      }
    }

    if (startIndex >= deltasLength) {
      continue;
    }

    for (let deltaIndex = startIndex; deltaIndex < deltasLength; deltaIndex++) {
      const delta = deltas[deltaIndex];
      const coords = delta.coords;
      const vx = coords[0];
      const vy = coords[1];
      const vz = coords[2];

      chunk.setVoxel(vx, vy, vz, delta.newVoxel);
      const newRotation = delta.newRotation;
      if (newRotation) {
        chunk.setVoxelRotation(vx, vy, vz, newRotation);
      }
      const newStage = delta.newStage;
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
  gridDepth: number,
  chunkShape: [number, number, number],
  serialized: SerializedWasmChunk[]
) => {
  const cellCount = gridWidth * gridDepth;
  serialized.length = cellCount;

  for (let index = 0; index < cellCount; index++) {
    const chunk = chunkGrid[index];
    if (!chunk) {
      serialized[index] = null;
      continue;
    }

    serialized[index] = {
      voxels: chunk.voxels.data,
      lights: chunk.lights.data,
      shape: chunkShape,
    };
  }
};

const serializeChunksData = (
  chunksData: (SerializedRawChunk | null)[],
  gridWidth: number,
  gridDepth: number,
  chunkShape: [number, number, number],
  serialized: SerializedWasmChunk[]
): boolean => {
  const cellCount = gridWidth * gridDepth;
  serialized.length = cellCount;
  let hasAnyChunk = false;

  for (let index = 0; index < cellCount; index++) {
    const chunkData = chunksData[index];
    if (!chunkData) {
      serialized[index] = null;
      continue;
    }

    hasAnyChunk = true;
    serialized[index] = {
      voxels: chunkData.voxels.byteLength
        ? new Uint32Array(chunkData.voxels)
        : emptyUint32Array,
      lights: chunkData.lights.byteLength
        ? new Uint32Array(chunkData.lights)
        : emptyUint32Array,
      shape: chunkShape,
    };
  }

  return hasAnyChunk;
};

const processBatchMessage = (message: LightBatchMessage) => {
  const {
    jobId,
    color,
    boundingBox,
    chunksData,
    chunkGridDimensions,
    chunkGridOffset,
    lastRelevantSequenceId,
    relevantDeltas,
    lightOps,
    options,
  } = message;

  const [gridWidth, gridDepth] = chunkGridDimensions;
  const [gridOffsetX, gridOffsetZ] = chunkGridOffset;
  reusableChunkShape[0] = options.chunkSize;
  reusableChunkShape[1] = options.maxHeight;
  reusableChunkShape[2] = options.chunkSize;
  const chunkShape = reusableChunkShape;

  if (lightOps.removals.length === 0 && lightOps.floods.length === 0) {
    postEmptyBatchResult(jobId, lastRelevantSequenceId);
    return;
  }

  let lastSequenceId = 0;
  const serializedChunks = reusableSerializedChunks;
  const hasPotentialRelevantDelta = relevantDeltas.length > 0;

  if (!hasPotentialRelevantDelta) {
    const hasAnyChunk = serializeChunksData(
      chunksData,
      gridWidth,
      gridDepth,
      chunkShape,
      serializedChunks
    );
    if (!hasAnyChunk) {
      postEmptyBatchResult(jobId, 0);
      return;
    }
  } else {
    const result = deserializeChunkGrid(chunksData, gridWidth, gridDepth);
    if (!result.hasAnyChunk) {
      postEmptyBatchResult(jobId, 0);
      return;
    }
    const { chunkGrid } = result;
    lastSequenceId = applyRelevantDeltas(
      chunkGrid,
      gridWidth,
      gridDepth,
      gridOffsetX,
      gridOffsetZ,
      relevantDeltas
    );
    serializeChunkGrid(
      chunkGrid,
      gridWidth,
      gridDepth,
      chunkShape,
      serializedChunks
    );
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
  serializedChunks.length = 0;

  const modifiedChunkCount = wasmResult.modifiedChunks.length;
  const modifiedChunks = reusableModifiedChunks;
  modifiedChunks.length = modifiedChunkCount;
  const transferBuffers = reusableTransferBuffers;
  transferBuffers.length = modifiedChunkCount;

  for (let index = 0; index < modifiedChunkCount; index++) {
    const chunk = wasmResult.modifiedChunks[index];
    const lights = chunk.lights;
    const existing = modifiedChunks[index];
    if (existing) {
      existing.coords = chunk.coords;
      existing.lights = lights;
    } else {
      modifiedChunks[index] = {
        coords: chunk.coords,
        lights,
      };
    }
    transferBuffers[index] = lights.buffer;
  }

  reusablePostMessageOptions.transfer = transferBuffers;
  postMessage(
    {
      jobId,
      modifiedChunks,
      appliedDeltas: { lastSequenceId },
    },
    reusablePostMessageOptions
  );
  modifiedChunks.length = 0;
  transferBuffers.length = 0;
  reusablePostMessageOptions.transfer = emptyTransferList;
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
