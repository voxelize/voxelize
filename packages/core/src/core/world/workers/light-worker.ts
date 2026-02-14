import init, {
  process_light_batch_fast,
  set_registry,
} from "@voxelize/wasm-lighter";

import { Coords2, Coords3 } from "../../../types";
import { BlockUtils } from "../../../utils/block-utils";
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
const reusableChunkGrid: (RawChunk | null)[] = [];
const emptyModifiedChunks: WorkerModifiedChunk[] = [];
const emptyChunkGrid: (RawChunk | null)[] = [];
const emptyAppliedDeltas = { lastSequenceId: 0 };
const reusableAppliedDeltas = { lastSequenceId: 0 };
const reusableBatchResultMessage = {
  jobId: "",
  modifiedChunks: emptyModifiedChunks,
  appliedDeltas: emptyAppliedDeltas,
};
const reusablePostMessageOptions: StructuredSerializeOptions = {
  transfer: emptyTransferList,
};

const hasPendingBatchMessages = () =>
  pendingBatchMessagesHead < pendingBatchMessages.length;

const pendingBatchMessageCount = () =>
  pendingBatchMessages.length - pendingBatchMessagesHead;

const isInteger = (value: number) => Number.isInteger(value);
const isPositiveInteger = (value: number) => isInteger(value) && value > 0;

const getAppliedDeltasPayload = (lastSequenceId: number) => {
  if (lastSequenceId === 0) {
    return emptyAppliedDeltas;
  }
  reusableAppliedDeltas.lastSequenceId = lastSequenceId;
  return reusableAppliedDeltas;
};

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
  const appliedDeltas = getAppliedDeltasPayload(lastSequenceId);
  reusableBatchResultMessage.jobId = jobId;
  reusableBatchResultMessage.modifiedChunks = emptyModifiedChunks;
  reusableBatchResultMessage.appliedDeltas = appliedDeltas;
  postMessage(reusableBatchResultMessage);
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
  if (!patterns || patterns.length === 0) {
    return null;
  }

  const patternCount = patterns.length;
  const convertedPatterns = new Array<WasmLightDynamicPattern>(patternCount);
  for (let patternIndex = 0; patternIndex < patternCount; patternIndex++) {
    const pattern = patterns[patternIndex];
    const partCount = pattern.parts.length;
    const convertedParts = new Array<WasmLightConditionalPart>(partCount);
    for (let partIndex = 0; partIndex < partCount; partIndex++) {
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
  const blockCount = registry.blocksById.length;
  const blocksById = new Array<[number, WasmLightBlock]>(blockCount);
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
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
  gridDepth: number,
  chunkGrid: (RawChunk | null)[]
): boolean => {
  const cellCount = gridWidth * gridDepth;
  chunkGrid.length = cellCount;
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

  return hasAnyChunk;
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
      let nextRaw = chunk.getRawValue(vx, vy, vz);
      const currentRaw = nextRaw;

      if (delta.oldVoxel !== delta.newVoxel) {
        nextRaw = BlockUtils.insertID(nextRaw, delta.newVoxel);
      }
      const newRotation = delta.newRotation;
      if (newRotation) {
        nextRaw = BlockUtils.insertRotation(nextRaw, newRotation);
      }
      const newStage = delta.newStage;
      if (newStage !== undefined) {
        nextRaw = BlockUtils.insertStage(nextRaw, newStage);
      }

      if (nextRaw !== currentRaw) {
        chunk.setRawValue(vx, vy, vz, nextRaw);
      }
    }
  }

  return lastSequenceId;
};

const serializeChunkGrid = (
  chunkGrid: (RawChunk | null)[],
  gridWidth: number,
  gridDepth: number,
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
    };
  }
};

const serializeChunksData = (
  chunksData: (SerializedRawChunk | null)[],
  gridWidth: number,
  gridDepth: number,
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
  if (
    !isPositiveInteger(options.chunkSize) ||
    !isPositiveInteger(options.maxHeight) ||
    !isInteger(options.maxLightLevel)
  ) {
    postEmptyBatchResult(jobId, lastRelevantSequenceId);
    return;
  }
  if (
    !isPositiveInteger(gridWidth) ||
    !isPositiveInteger(gridDepth) ||
    !isInteger(gridOffsetX) ||
    !isInteger(gridOffsetZ)
  ) {
    postEmptyBatchResult(jobId, lastRelevantSequenceId);
    return;
  }
  const cellCount = gridWidth * gridDepth;
  if (chunksData.length < cellCount) {
    postEmptyBatchResult(jobId, 0);
    return;
  }

  if (lightOps.removals.length === 0 && lightOps.floods.length === 0) {
    postEmptyBatchResult(jobId, lastRelevantSequenceId);
    return;
  }

  let lastSequenceId = 0;
  const serializedChunks = reusableSerializedChunks;
  const hasPotentialRelevantDelta = relevantDeltas.length > 0;
  const chunkGrid = hasPotentialRelevantDelta ? reusableChunkGrid : emptyChunkGrid;

  if (!hasPotentialRelevantDelta) {
    const hasAnyChunk = serializeChunksData(
      chunksData,
      gridWidth,
      gridDepth,
      serializedChunks
    );
    if (!hasAnyChunk) {
      serializedChunks.length = 0;
      postEmptyBatchResult(jobId, 0);
      return;
    }
  } else {
    const hasAnyChunk = deserializeChunkGrid(
      chunksData,
      gridWidth,
      gridDepth,
      chunkGrid
    );
    if (!hasAnyChunk) {
      chunkGrid.length = 0;
      postEmptyBatchResult(jobId, 0);
      return;
    }
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
      serializedChunks
    );
    chunkGrid.length = 0;
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
  if (modifiedChunkCount === 0) {
    postEmptyBatchResult(jobId, lastSequenceId);
    return;
  }

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
  const appliedDeltas = getAppliedDeltasPayload(lastSequenceId);
  reusableBatchResultMessage.jobId = jobId;
  reusableBatchResultMessage.modifiedChunks = modifiedChunks;
  reusableBatchResultMessage.appliedDeltas = appliedDeltas;
  postMessage(reusableBatchResultMessage, reusablePostMessageOptions);
  modifiedChunks.length = 0;
  transferBuffers.length = 0;
  chunkGrid.length = 0;
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
