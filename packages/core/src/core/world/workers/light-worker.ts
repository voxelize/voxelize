import init, {
  process_light_batch_fast,
  set_registry,
} from "@voxelize/wasm-lighter";

import { Coords2, Coords3 } from "../../../types";
import { BlockUtils } from "../../../utils/block-utils";
import { LightColor } from "../../../utils/light-utils";
import { BlockRule, BlockRuleLogic } from "../block";
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
let wasmInitializationPromise: Promise<void> | null = null;
let registryInitialized = false;
let registryInitializationFailed = false;
const pendingBatchMessages: LightBatchMessage[] = [];
let pendingBatchMessagesHead = 0;
const MAX_PENDING_BATCH_MESSAGES = 512;
const reusableBoundsMin = new Int32Array(3);
const reusableBoundsShape = new Uint32Array(3);
const emptyBoundsMin = new Int32Array(0);
const emptyBoundsShape = new Uint32Array(0);
const emptyTransferList: Transferable[] = [];
const reusableModifiedChunks: WorkerModifiedChunk[] = [];
const reusableTransferBuffers: ArrayBuffer[] = [];
const reusableSerializedChunks: SerializedWasmChunk[] = [];
const reusableChunkGrid: (RawChunk | null)[] = [];
let reusableChunkValidityDense = new Int8Array(0);
const reusableChunkValidityTouched: number[] = [];
const reusableChunkValiditySparse = new Map<number, boolean>();
const emptyModifiedChunks: WorkerModifiedChunk[] = [];
const emptyChunkGrid: (RawChunk | null)[] = [];
const emptyDeltaBatches: DeltaBatch[] = [];
const emptyRemovalNodes: Coords3[] = [];
const emptyFloodNodes: LightNode[] = [];
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

const isArrayBuffer = (
  value: ArrayBuffer | null | undefined
): value is ArrayBuffer => value instanceof ArrayBuffer;

const isInteger = (value: number) => Number.isSafeInteger(value);
const isPositiveInteger = (value: number) => isInteger(value) && value > 0;
const normalizeStartIndex = (startIndexValue: number | undefined) =>
  startIndexValue !== undefined &&
  isInteger(startIndexValue) &&
  startIndexValue > 0
    ? startIndexValue
    : 0;
const MIN_INT32 = -0x80000000;
const MAX_INT32 = 0x7fffffff;
const MAX_TYPED_ARRAY_LENGTH = 0x7fffffff;
const MAX_LIGHT_BATCH_CELL_COUNT = 0x01000000;
const MAX_CHUNK_VALIDITY_MEMO_LENGTH = MAX_LIGHT_BATCH_CELL_COUNT;
const MAX_UINT32 = 0xffffffff;
const isI32 = (value: number) =>
  isInteger(value) && value >= MIN_INT32 && value <= MAX_INT32;
const isPositiveI32 = (value: number) => isI32(value) && value > 0;
const isPositiveU32 = (value: number) =>
  isInteger(value) && value > 0 && value <= MAX_UINT32;
const getChunkShiftIfPowerOfTwo = (chunkSize: number) => {
  if (chunkSize <= 0 || chunkSize > MAX_INT32) {
    return -1;
  }
  if ((chunkSize & (chunkSize - 1)) !== 0) {
    return -1;
  }
  return 31 - Math.clz32(chunkSize);
};
const getChunkValidityMemo = (cellCount: number) => {
  if (reusableChunkValidityDense.length < cellCount) {
    reusableChunkValidityDense = new Int8Array(cellCount);
  }
  return reusableChunkValidityDense;
};
const resetChunkValidityMemo = (chunkValidity: Int8Array, touched: number[]) => {
  for (let index = 0; index < touched.length; index++) {
    chunkValidity[touched[index]] = 0;
  }
  touched.length = 0;
};
const isValidVoxelId = (value: number) =>
  isInteger(value) && value >= 0 && value <= 0xffff;
const isValidRotationValue = (value: number) =>
  isInteger(value) && value >= 0 && value <= 15;
const isValidStage = (value: number) =>
  isInteger(value) && value >= 0 && value <= 15;
const DELTA_WRITE_VOXEL = 1;
const DELTA_WRITE_ROTATION = 2;
const DELTA_WRITE_STAGE = 4;
const getDeltaWriteIntentMask = (delta: VoxelDelta) => {
  let mask = 0;
  const oldVoxel = delta.oldVoxel;
  const newVoxel = delta.newVoxel;
  if (
    isValidVoxelId(oldVoxel) &&
    isValidVoxelId(newVoxel) &&
    oldVoxel !== newVoxel
  ) {
    mask |= DELTA_WRITE_VOXEL;
  }
  const newRotation = delta.newRotation;
  if (hasFiniteRotation(newRotation)) {
    const oldRotation = delta.oldRotation;
    if (
      !hasFiniteRotationValues(oldRotation) ||
      oldRotation.value !== newRotation.value ||
      oldRotation.yRotation !== newRotation.yRotation
    ) {
      mask |= DELTA_WRITE_ROTATION;
    }
  }
  const newStage = delta.newStage;
  if (newStage !== undefined && isValidStage(newStage)) {
    const oldStage = delta.oldStage;
    if (oldStage === undefined || !isValidStage(oldStage) || oldStage !== newStage) {
      mask |= DELTA_WRITE_STAGE;
    }
  }
  return mask;
};
const isValidMaxLightLevel = (value: number) =>
  isValidStage(value);
type RotationWithScalarFields = { value: number; yRotation: number };
const hasFiniteRotationValues = (
  rotation: RotationWithScalarFields | null | undefined
): rotation is RotationWithScalarFields =>
  rotation !== undefined &&
  rotation !== null &&
  isValidRotationValue(rotation.value) &&
  isValidRotationValue(rotation.yRotation);
const hasFiniteRotation = (
  rotation: VoxelDelta["newRotation"] | null | undefined
): rotation is NonNullable<VoxelDelta["newRotation"]> =>
  hasFiniteRotationValues(rotation);
const normalizeSequenceId = (sequenceId: number) =>
  isPositiveInteger(sequenceId) ? sequenceId : 0;
type RuntimeJobId =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  | object;
const sanitizeJobId = (jobId: RuntimeJobId) =>
  typeof jobId === "string" ? jobId : "";
const isValidRuleType = (
  type: BlockRule["type"] | string | undefined
): type is BlockRule["type"] =>
  type === "none" || type === "simple" || type === "combination";
const isValidRuleLogic = (
  logic: BlockRuleLogic | string | undefined
): logic is BlockRuleLogic =>
  logic === BlockRuleLogic.And ||
  logic === BlockRuleLogic.Or ||
  logic === BlockRuleLogic.Not;
const hasFiniteRuleRotation = (
  rotation: { value: number; yRotation: number } | null | undefined
): rotation is { value: number; yRotation: number } =>
  hasFiniteRotationValues(rotation);
const normalizeOptionalLightLevel = (
  value: number | null | undefined
): number | undefined => {
  if (value === null || value === undefined || !isValidStage(value)) {
    return undefined;
  }
  return value;
};
const normalizeRequiredLightLevel = (value: number): number =>
  normalizeOptionalLightLevel(value) ?? 0;
const isBoolean = (value: boolean | null | undefined): value is boolean =>
  value === true || value === false;
const normalizeTransparencyFaces = (
  faces: SerializedBlock["isTransparent"] | boolean[] | null | undefined
): [boolean, boolean, boolean, boolean, boolean, boolean] | null => {
  if (!Array.isArray(faces) || faces.length < 6) {
    return null;
  }
  const f0 = faces[0];
  const f1 = faces[1];
  const f2 = faces[2];
  const f3 = faces[3];
  const f4 = faces[4];
  const f5 = faces[5];
  if (
    !isBoolean(f0) ||
    !isBoolean(f1) ||
    !isBoolean(f2) ||
    !isBoolean(f3) ||
    !isBoolean(f4) ||
    !isBoolean(f5)
  ) {
    return null;
  }
  return [f0, f1, f2, f3, f4, f5];
};
const MAX_RULE_SANITIZE_DEPTH = 32;
const normalizeRule = (
  rule: BlockRule,
  depth = 0
): BlockRule | null => {
  if (!rule || !isValidRuleType(rule.type)) {
    return null;
  }
  if (depth > MAX_RULE_SANITIZE_DEPTH) {
    return null;
  }

  if (rule.type === "none") {
    return rule;
  }
  if (rule.type === "simple") {
    const offset = rule.offset;
    if (
      !Array.isArray(offset) ||
      offset.length < 3 ||
      !isInteger(offset[0]) ||
      !isInteger(offset[1]) ||
      !isInteger(offset[2])
    ) {
      return null;
    }

    const normalized: BlockRule = {
      type: "simple",
      offset: [offset[0], offset[1], offset[2]],
    };
    if (rule.id !== undefined && rule.id !== null) {
      if (!isValidVoxelId(rule.id)) {
        return null;
      }
      normalized.id = rule.id;
    }
    if (rule.rotation !== undefined && rule.rotation !== null) {
      if (!hasFiniteRuleRotation(rule.rotation)) {
        return null;
      }
      normalized.rotation = rule.rotation;
    }
    if (rule.stage !== undefined && rule.stage !== null) {
      if (!isValidStage(rule.stage)) {
        return null;
      }
      normalized.stage = rule.stage;
    }
    return normalized;
  }

  if (!isValidRuleLogic(rule.logic) || !Array.isArray(rule.rules)) {
    return null;
  }
  const normalizedRules: BlockRule[] = [];
  for (let index = 0; index < rule.rules.length; index++) {
    const normalized = normalizeRule(rule.rules[index], depth + 1);
    if (normalized) {
      normalizedRules.push(normalized);
    }
  }
  if (normalizedRules.length === 0) {
    return null;
  }
  return {
    type: "combination",
    logic: rule.logic,
    rules: normalizedRules,
  };
};

const getAppliedDeltasPayload = (lastSequenceId: number) => {
  const normalizedSequenceId = normalizeSequenceId(lastSequenceId);
  if (normalizedSequenceId === 0) {
    return emptyAppliedDeltas;
  }
  reusableAppliedDeltas.lastSequenceId = normalizedSequenceId;
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

const hasMatchingChunkOptions = (
  chunkOptions: SerializedRawChunk["options"] | null | undefined,
  expectedChunkSize: number,
  expectedMaxHeight: number,
  expectedMaxLightLevel: number
) =>
  chunkOptions !== null &&
  chunkOptions !== undefined &&
  isPositiveI32(chunkOptions.size) &&
  isPositiveI32(chunkOptions.maxHeight) &&
  isValidMaxLightLevel(chunkOptions.maxLightLevel) &&
  chunkOptions.size === expectedChunkSize &&
  chunkOptions.maxHeight === expectedMaxHeight &&
  chunkOptions.maxLightLevel === expectedMaxLightLevel;

type CompatibleSerializedChunk = SerializedRawChunk & {
  voxels: ArrayBuffer;
  lights: ArrayBuffer;
};

const isCompatibleSerializedChunk = (
  chunkData: SerializedRawChunk | null | undefined,
  expectedChunkX: number,
  expectedChunkZ: number,
  expectedChunkSize: number,
  expectedMaxHeight: number,
  expectedMaxLightLevel: number,
  expectedChunkByteLength: number
): chunkData is CompatibleSerializedChunk => {
  if (!chunkData) {
    return false;
  }
  const chunkOptions = chunkData.options;
  const voxelsBuffer = chunkData.voxels;
  const lightsBuffer = chunkData.lights;
  const chunkX = chunkData.x;
  const chunkZ = chunkData.z;
  return (
    typeof chunkData.id === "string" &&
    isI32(chunkX) &&
    isI32(chunkZ) &&
    chunkX === expectedChunkX &&
    chunkZ === expectedChunkZ &&
    isArrayBuffer(voxelsBuffer) &&
    isArrayBuffer(lightsBuffer) &&
    voxelsBuffer.byteLength === expectedChunkByteLength &&
    lightsBuffer.byteLength === expectedChunkByteLength &&
    hasMatchingChunkOptions(
      chunkOptions,
      expectedChunkSize,
      expectedMaxHeight,
      expectedMaxLightLevel
    )
  );
};

const drainPendingBatchMessagesAsEmptyResults = () => {
  if (!hasPendingBatchMessages()) {
    return;
  }
  const start = pendingBatchMessagesHead;
  const end = pendingBatchMessages.length;
  for (let i = start; i < end; i++) {
    const pendingMessage = pendingBatchMessages[i];
    postEmptyBatchResult(
      sanitizeJobId(pendingMessage.jobId),
      pendingMessage.lastRelevantSequenceId
    );
  }
  pendingBatchMessages.length = 0;
  pendingBatchMessagesHead = 0;
};

const markRegistryInitializationFailed = () => {
  registryInitialized = false;
  registryInitializationFailed = true;
  drainPendingBatchMessagesAsEmptyResults();
};

const hasPotentialRelevantDeltaBatches = (
  deltaBatches: DeltaBatch[],
  chunksData: (SerializedRawChunk | null)[],
  gridWidth: number,
  gridDepth: number,
  gridOffsetX: number,
  gridOffsetZ: number,
  maxHeight: number,
  maxLightLevel: number,
  chunkSize: number,
  chunkShift: number,
  expectedChunkByteLength: number
) => {
  if (gridWidth <= 0 || gridDepth <= 0) {
    return false;
  }
  const deltaBatchesLength = deltaBatches.length;
  if (deltaBatchesLength === 0) {
    return false;
  }
  const cellCount = gridWidth * gridDepth;
  const hasMultipleDeltaBatches = deltaBatchesLength > 1;
  const chunkValidity =
    hasMultipleDeltaBatches && cellCount <= MAX_CHUNK_VALIDITY_MEMO_LENGTH
      ? getChunkValidityMemo(cellCount)
      : null;
  const chunkValidityTouched = reusableChunkValidityTouched;
  if (chunkValidity) {
    chunkValidityTouched.length = 0;
  }
  const chunkValiditySparse =
    chunkValidity === null && hasMultipleDeltaBatches
      ? reusableChunkValiditySparse
      : null;
  if (chunkValiditySparse) {
    chunkValiditySparse.clear();
  }
  for (let batchIndex = 0; batchIndex < deltaBatchesLength; batchIndex++) {
    const deltaBatch = deltaBatches[batchIndex];
    if (!deltaBatch || typeof deltaBatch !== "object") {
      continue;
    }
    const deltas = deltaBatch.deltas;
    if (!Array.isArray(deltas) || deltas.length === 0) {
      continue;
    }
    const deltasLength = deltas.length;
    const startIndex = normalizeStartIndex(deltaBatch.startIndex);
    if (startIndex >= deltasLength) {
      continue;
    }
    const cx = deltaBatch.cx;
    const cz = deltaBatch.cz;
    if (!isI32(cx) || !isI32(cz)) {
      continue;
    }
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
    const chunkIndex = localX * gridDepth + localZ;
    if (chunkValidity) {
      let chunkValidityState = chunkValidity[chunkIndex];
      if (chunkValidityState === -1) {
        continue;
      }
      if (chunkValidityState === 0) {
        const chunkData = chunksData[chunkIndex];
        chunkValidityState = isCompatibleSerializedChunk(
          chunkData,
          cx,
          cz,
          chunkSize,
          maxHeight,
          maxLightLevel,
          expectedChunkByteLength
        )
          ? 1
          : -1;
        chunkValidity[chunkIndex] = chunkValidityState;
        chunkValidityTouched.push(chunkIndex);
      }
      if (chunkValidityState === -1) {
        continue;
      }
    } else if (chunkValiditySparse) {
      const cachedCompatibility = chunkValiditySparse.get(chunkIndex);
      if (cachedCompatibility === false) {
        continue;
      }
      if (cachedCompatibility !== true) {
        const isCompatible = isCompatibleSerializedChunk(
          chunksData[chunkIndex],
          cx,
          cz,
          chunkSize,
          maxHeight,
          maxLightLevel,
          expectedChunkByteLength
        );
        chunkValiditySparse.set(chunkIndex, isCompatible);
        if (!isCompatible) {
          continue;
        }
      }
    } else if (
      !isCompatibleSerializedChunk(
        chunksData[chunkIndex],
        cx,
        cz,
        chunkSize,
        maxHeight,
        maxLightLevel,
        expectedChunkByteLength
      )
    ) {
      continue;
    }
    for (let deltaIndex = startIndex; deltaIndex < deltasLength; deltaIndex++) {
      const delta = deltas[deltaIndex];
      if (!delta || typeof delta !== "object") {
        continue;
      }
      const writeIntentMask = getDeltaWriteIntentMask(delta);
      if (writeIntentMask === 0) {
        continue;
      }
      const coords = delta.coords;
      if (!isStrictCoords3(coords)) {
        continue;
      }
      const [vx, vy, vz] = coords;
      if (vy < 0 || vy >= maxHeight) {
        continue;
      }
      const deltaChunkX =
        chunkShift >= 0 ? vx >> chunkShift : Math.floor(vx / chunkSize);
      const deltaChunkZ =
        chunkShift >= 0 ? vz >> chunkShift : Math.floor(vz / chunkSize);
      if (deltaChunkX === cx && deltaChunkZ === cz) {
        resetChunkValidityMemo(chunkValidity, chunkValidityTouched);
        if (chunkValiditySparse) {
          chunkValiditySparse.clear();
        }
        return true;
      }
    }
  }
  if (chunkValidity) {
    resetChunkValidityMemo(chunkValidity, chunkValidityTouched);
  }
  if (chunkValiditySparse) {
    chunkValiditySparse.clear();
  }
  return false;
};

const isStrictCoords3 = (
  coords: Coords3 | readonly number[] | null | undefined
): coords is Coords3 =>
  Array.isArray(coords) &&
  coords.length === 3 &&
  isI32(coords[0]) &&
  isI32(coords[1]) &&
  isI32(coords[2]);

const isStrictPositiveCoords3 = (
  coords: Coords3 | readonly number[] | null | undefined
): coords is Coords3 =>
  Array.isArray(coords) &&
  coords.length === 3 &&
  isPositiveU32(coords[0]) &&
  isPositiveU32(coords[1]) &&
  isPositiveU32(coords[2]);

const isValidFloodNode = (
  node: LightNode | null | undefined
): node is LightNode =>
  node !== undefined &&
  node !== null &&
  typeof node === "object" &&
  isPositiveU32(node.level) &&
  isStrictCoords3(node.voxel);

const compactValidRemovalNodesInPlace = (removals: Coords3[]) => {
  let writeIndex = 0;
  const removalsLength = removals.length;
  for (let readIndex = 0; readIndex < removalsLength; readIndex++) {
    const removal = removals[readIndex];
    if (!isStrictCoords3(removal)) {
      continue;
    }
    removals[writeIndex] = removal;
    writeIndex++;
  }
  if (writeIndex < removalsLength) {
    removals.length = writeIndex;
  }
  return writeIndex !== 0;
};

const compactValidFloodNodesInPlace = (floods: LightNode[]) => {
  let writeIndex = 0;
  const floodsLength = floods.length;
  for (let readIndex = 0; readIndex < floodsLength; readIndex++) {
    const flood = floods[readIndex];
    if (!isValidFloodNode(flood)) {
      continue;
    }
    floods[writeIndex] = flood;
    writeIndex++;
  }
  if (writeIndex < floodsLength) {
    floods.length = writeIndex;
  }
  return writeIndex !== 0;
};

const postEmptyBatchResult = (jobId: string, lastSequenceId = 0) => {
  const appliedDeltas = getAppliedDeltasPayload(lastSequenceId);
  reusableBatchResultMessage.jobId = jobId;
  reusableBatchResultMessage.modifiedChunks = emptyModifiedChunks;
  reusableBatchResultMessage.appliedDeltas = appliedDeltas;
  postMessage(reusableBatchResultMessage);
};

const ensureWasmInitialized = () => {
  if (wasmInitialized) {
    return Promise.resolve();
  }
  if (!wasmInitializationPromise) {
    wasmInitializationPromise = init()
      .then(() => {
        wasmInitialized = true;
      })
      .catch((error) => {
        wasmInitializationPromise = null;
        throw error;
      });
  }
  return wasmInitializationPromise;
};

const convertDynamicPatterns = (
  patterns: SerializedDynamicPattern[] | null | undefined
): WasmLightDynamicPattern[] | null => {
  if (!patterns || patterns.length === 0) {
    return null;
  }

  const convertedPatterns: WasmLightDynamicPattern[] = [];
  const patternCount = patterns.length;
  for (let patternIndex = 0; patternIndex < patternCount; patternIndex++) {
    const pattern = patterns[patternIndex];
    if (!pattern || typeof pattern !== "object") {
      continue;
    }
    const patternParts = pattern.parts;
    if (!Array.isArray(patternParts) || patternParts.length === 0) {
      continue;
    }
    const convertedParts: WasmLightConditionalPart[] = [];
    const partCount = patternParts.length;
    for (let partIndex = 0; partIndex < partCount; partIndex++) {
      const part = patternParts[partIndex];
      if (!part || typeof part !== "object") {
        continue;
      }
      const rule = part.rule;
      if (!rule) {
        continue;
      }
      const normalizedRule = normalizeRule(rule);
      if (!normalizedRule) {
        continue;
      }
      convertedParts.push({
        rule: normalizedRule,
        redLightLevel: normalizeOptionalLightLevel(part.redLightLevel),
        greenLightLevel: normalizeOptionalLightLevel(part.greenLightLevel),
        blueLightLevel: normalizeOptionalLightLevel(part.blueLightLevel),
      });
    }
    if (convertedParts.length > 0) {
      convertedPatterns.push({ parts: convertedParts });
    }
  }

  return convertedPatterns.length > 0 ? convertedPatterns : null;
};

const convertRegistryToWasm = (registry: SerializedRegistry): WasmLightRegistry => {
  const blockCount = registry.blocksById.length;
  const blocksById = new Array<[number, WasmLightBlock]>(blockCount);
  let mappedCount = 0;
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
    const [id, block] = registry.blocksById[blockIndex];
    if (!block || !isValidVoxelId(id)) {
      continue;
    }
    const isTransparent = normalizeTransparencyFaces(block.isTransparent);
    if (!isTransparent) {
      continue;
    }
    const blockId = isValidVoxelId(block.id) ? block.id : id;
    const isOpaque =
      !isTransparent[0] &&
      !isTransparent[1] &&
      !isTransparent[2] &&
      !isTransparent[3] &&
      !isTransparent[4] &&
      !isTransparent[5];
    const redLightLevel = normalizeRequiredLightLevel(block.redLightLevel);
    const greenLightLevel = normalizeRequiredLightLevel(block.greenLightLevel);
    const blueLightLevel = normalizeRequiredLightLevel(block.blueLightLevel);
    blocksById[mappedCount] = [
      id,
      {
        id: blockId,
        isTransparent,
        isOpaque,
        isLight: isBoolean(block.isLight)
          ? block.isLight
          : redLightLevel > 0 || greenLightLevel > 0 || blueLightLevel > 0,
        lightReduce: isBoolean(block.lightReduce) ? block.lightReduce : true,
        redLightLevel,
        greenLightLevel,
        blueLightLevel,
        dynamicPatterns: convertDynamicPatterns(block.dynamicPatterns),
      },
    ];
    mappedCount++;
  }
  blocksById.length = mappedCount;

  return { blocksById };
};

const colorToIndex = (color: LightColor): number | null => {
  switch (color) {
    case "SUNLIGHT":
      return 0;
    case "RED":
      return 1;
    case "GREEN":
      return 2;
    case "BLUE":
      return 3;
    default:
      return null;
  }
};

const deserializeChunkGrid = (
  chunksData: (SerializedRawChunk | null)[],
  gridWidth: number,
  gridDepth: number,
  gridOffsetX: number,
  gridOffsetZ: number,
  chunkGrid: (RawChunk | null)[],
  expectedChunkSize: number,
  expectedMaxHeight: number,
  expectedMaxLightLevel: number,
  expectedChunkByteLength: number
): boolean => {
  const cellCount = gridWidth * gridDepth;
  chunkGrid.length = cellCount;
  let hasAnyChunk = false;
  let index = 0;
  for (
    let localX = 0, expectedChunkX = gridOffsetX;
    localX < gridWidth;
    localX++, expectedChunkX++
  ) {
    for (
      let localZ = 0, expectedChunkZ = gridOffsetZ;
      localZ < gridDepth;
      localZ++, expectedChunkZ++, index++
    ) {
      const chunkData = chunksData[index];
      if (
        !isCompatibleSerializedChunk(
          chunkData,
          expectedChunkX,
          expectedChunkZ,
          expectedChunkSize,
          expectedMaxHeight,
          expectedMaxLightLevel,
          expectedChunkByteLength
        )
      ) {
        chunkGrid[index] = null;
        continue;
      }

      hasAnyChunk = true;
      chunkGrid[index] = RawChunk.deserialize(chunkData);
    }
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
  if (gridWidth <= 0 || gridDepth <= 0) {
    return 0;
  }
  if (relevantDeltas.length === 0) {
    return 0;
  }
  let lastSequenceId = 0;

  for (let batchIndex = 0; batchIndex < relevantDeltas.length; batchIndex++) {
    const deltaBatch = relevantDeltas[batchIndex];
    if (!deltaBatch || typeof deltaBatch !== "object") {
      continue;
    }
    const deltas = deltaBatch.deltas;
    if (!Array.isArray(deltas)) {
      continue;
    }
    const deltasLength = deltas.length;
    if (deltasLength === 0) {
      continue;
    }
    const startIndex = normalizeStartIndex(deltaBatch.startIndex);
    if (startIndex >= deltasLength) {
      continue;
    }
    const cx = deltaBatch.cx;
    const cz = deltaBatch.cz;
    if (!isI32(cx) || !isI32(cz)) {
      continue;
    }
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
    const chunkMin = chunk.min;
    const chunkMinX = chunkMin[0];
    const chunkMinY = chunkMin[1];
    const chunkMinZ = chunkMin[2];
    const chunkMaxX = chunkMinX + chunk.options.size;
    const chunkMaxY = chunkMinY + chunk.options.maxHeight;
    const chunkMaxZ = chunkMinZ + chunk.options.size;
    const voxelData = chunk.voxels;
    const voxelValues = voxelData.data;
    const voxelStride = voxelData.stride;
    const voxelStrideX = voxelStride[0];
    const voxelStrideY = voxelStride[1];
    const voxelStrideZ = voxelStride[2];
    const voxelOffset = voxelData.offset;
    let chunkLastSequenceId = 0;

    for (let deltaIndex = startIndex; deltaIndex < deltasLength; deltaIndex++) {
      const delta = deltas[deltaIndex];
      if (!delta || typeof delta !== "object") {
        continue;
      }
      const writeIntentMask = getDeltaWriteIntentMask(delta);
      if (writeIntentMask === 0) {
        continue;
      }
      const coords = delta.coords;
      if (!isStrictCoords3(coords)) {
        continue;
      }
      const [vx, vy, vz] = coords;
      if (
        vx < chunkMinX ||
        vx >= chunkMaxX ||
        vy < chunkMinY ||
        vy >= chunkMaxY ||
        vz < chunkMinZ ||
        vz >= chunkMaxZ
      ) {
        continue;
      }
      const sequenceId = delta.sequenceId;
      if (isInteger(sequenceId) && sequenceId > chunkLastSequenceId) {
        chunkLastSequenceId = sequenceId;
      }
      const lx = vx - chunkMinX;
      const ly = vy - chunkMinY;
      const lz = vz - chunkMinZ;
      const voxelIndex =
        voxelOffset + lx * voxelStrideX + ly * voxelStrideY + lz * voxelStrideZ;
      let nextRaw = voxelValues[voxelIndex];
      const currentRaw = nextRaw;

      if ((writeIntentMask & DELTA_WRITE_VOXEL) !== 0) {
        const newVoxel = delta.newVoxel as number;
        nextRaw = BlockUtils.insertID(nextRaw, newVoxel);
      }
      if ((writeIntentMask & DELTA_WRITE_ROTATION) !== 0) {
        const newRotation = delta.newRotation as NonNullable<VoxelDelta["newRotation"]>;
        nextRaw = BlockUtils.insertRotation(
          nextRaw,
          newRotation
        );
      }
      if ((writeIntentMask & DELTA_WRITE_STAGE) !== 0) {
        const newStage = delta.newStage as number;
        nextRaw = BlockUtils.insertStage(nextRaw, newStage);
      }

      if (nextRaw !== currentRaw) {
        voxelValues[voxelIndex] = nextRaw;
      }
    }
    if (chunkLastSequenceId > lastSequenceId) {
      lastSequenceId = chunkLastSequenceId;
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
  gridOffsetX: number,
  gridOffsetZ: number,
  serialized: SerializedWasmChunk[],
  expectedChunkSize: number,
  expectedMaxHeight: number,
  expectedMaxLightLevel: number,
  expectedChunkByteLength: number
): boolean => {
  const cellCount = gridWidth * gridDepth;
  serialized.length = cellCount;
  let hasAnyChunk = false;
  let index = 0;
  for (
    let localX = 0, expectedChunkX = gridOffsetX;
    localX < gridWidth;
    localX++, expectedChunkX++
  ) {
    for (
      let localZ = 0, expectedChunkZ = gridOffsetZ;
      localZ < gridDepth;
      localZ++, expectedChunkZ++, index++
    ) {
      const chunkData = chunksData[index];
      if (
        !isCompatibleSerializedChunk(
          chunkData,
          expectedChunkX,
          expectedChunkZ,
          expectedChunkSize,
          expectedMaxHeight,
          expectedMaxLightLevel,
          expectedChunkByteLength
        )
      ) {
        serialized[index] = null;
        continue;
      }

      hasAnyChunk = true;
      serialized[index] = {
        voxels: new Uint32Array(chunkData.voxels),
        lights: new Uint32Array(chunkData.lights),
      };
    }
  }

  return hasAnyChunk;
};

const processBatchMessage = (message: LightBatchMessage) => {
  const {
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
  const jobId = sanitizeJobId(message.jobId);

  const normalizedLastRelevantSequenceId = normalizeSequenceId(lastRelevantSequenceId);
  if (
    !Array.isArray(chunkGridDimensions) ||
    chunkGridDimensions.length !== 2 ||
    !Array.isArray(chunkGridOffset) ||
    chunkGridOffset.length !== 2
  ) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  if (!options || typeof options !== "object") {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  if (!Array.isArray(chunksData)) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  const gridWidth = chunkGridDimensions[0];
  const gridDepth = chunkGridDimensions[1];
  const gridOffsetX = chunkGridOffset[0];
  const gridOffsetZ = chunkGridOffset[1];
  const chunkSize = options.chunkSize;
  const maxHeight = options.maxHeight;
  const maxLightLevel = options.maxLightLevel;
  if (
    !isPositiveI32(chunkSize) ||
    !isPositiveI32(maxHeight) ||
    !isValidMaxLightLevel(maxLightLevel)
  ) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  if (
    !isPositiveI32(gridWidth) ||
    !isPositiveI32(gridDepth) ||
    !isI32(gridOffsetX) ||
    !isI32(gridOffsetZ)
  ) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  const cellCount = gridWidth * gridDepth;
  if (!Number.isSafeInteger(cellCount) || cellCount > MAX_LIGHT_BATCH_CELL_COUNT) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  const expectedVoxelCount = chunkSize * maxHeight * chunkSize;
  if (!Number.isSafeInteger(expectedVoxelCount) || expectedVoxelCount <= 0) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  if (expectedVoxelCount > MAX_TYPED_ARRAY_LENGTH) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  const expectedChunkByteLength = expectedVoxelCount * Uint32Array.BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(expectedChunkByteLength) || expectedChunkByteLength <= 0) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  if (chunksData.length < cellCount) {
    postEmptyBatchResult(jobId, 0);
    return;
  }

  if (!lightOps || typeof lightOps !== "object") {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  const removals = lightOps.removals;
  const floods = lightOps.floods;
  if (!Array.isArray(removals) || !Array.isArray(floods)) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  const hasValidRemovalNodes =
    removals.length > 0 && compactValidRemovalNodesInPlace(removals);
  const hasFloods = floods.length > 0 && compactValidFloodNodesInPlace(floods);
  if (!hasValidRemovalNodes && !hasFloods) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  const removalNodesPayload = hasValidRemovalNodes ? removals : emptyRemovalNodes;
  const floodNodesPayload = hasFloods ? floods : emptyFloodNodes;
  const bounds = boundingBox;
  const boundsMin = bounds?.min;
  const boundsShape = bounds?.shape;
  if (hasFloods && (!isStrictCoords3(boundsMin) || !isStrictPositiveCoords3(boundsShape))) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }
  const colorIndex = colorToIndex(color);
  if (colorIndex === null) {
    postEmptyBatchResult(jobId, normalizedLastRelevantSequenceId);
    return;
  }

  let lastSequenceId = 0;
  const serializedChunks = reusableSerializedChunks;
  const deltaBatches = Array.isArray(relevantDeltas)
    ? relevantDeltas
    : emptyDeltaBatches;
  const chunkShift = getChunkShiftIfPowerOfTwo(chunkSize);
  const hasPotentialRelevantDelta =
    deltaBatches.length > 0 &&
    hasPotentialRelevantDeltaBatches(
      deltaBatches,
      chunksData,
      gridWidth,
      gridDepth,
      gridOffsetX,
      gridOffsetZ,
      maxHeight,
      maxLightLevel,
      chunkSize,
      chunkShift,
      expectedChunkByteLength
    );
  const chunkGrid = hasPotentialRelevantDelta ? reusableChunkGrid : emptyChunkGrid;

  if (!hasPotentialRelevantDelta) {
    const hasAnyChunk = serializeChunksData(
      chunksData,
      gridWidth,
      gridDepth,
      gridOffsetX,
      gridOffsetZ,
      serializedChunks,
      chunkSize,
      maxHeight,
      maxLightLevel,
      expectedChunkByteLength
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
      gridOffsetX,
      gridOffsetZ,
      chunkGrid,
      chunkSize,
      maxHeight,
      maxLightLevel,
      expectedChunkByteLength
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
      deltaBatches
    );
    serializeChunkGrid(
      chunkGrid,
      gridWidth,
      gridDepth,
      serializedChunks
    );
    chunkGrid.length = 0;
  }

  let boundsMinPayload: Int32Array;
  let boundsShapePayload: Uint32Array;
  if (hasFloods && boundsMin && boundsShape) {
    reusableBoundsMin[0] = boundsMin[0];
    reusableBoundsMin[1] = boundsMin[1];
    reusableBoundsMin[2] = boundsMin[2];
    reusableBoundsShape[0] = boundsShape[0];
    reusableBoundsShape[1] = boundsShape[1];
    reusableBoundsShape[2] = boundsShape[2];
    boundsMinPayload = reusableBoundsMin;
    boundsShapePayload = reusableBoundsShape;
  } else {
    boundsMinPayload = emptyBoundsMin;
    boundsShapePayload = emptyBoundsShape;
  }
  const wasmResult = process_light_batch_fast(
    serializedChunks,
    gridWidth,
    gridDepth,
    gridOffsetX,
    gridOffsetZ,
    colorIndex,
    removalNodesPayload,
    floodNodesPayload,
    boundsMinPayload,
    boundsShapePayload,
    chunkSize,
    maxHeight,
    maxLightLevel
  ) as WasmLightBatchResult;
  serializedChunks.length = 0;
  const modifiedChunksFromWasm = wasmResult?.modifiedChunks;
  if (!Array.isArray(modifiedChunksFromWasm)) {
    postEmptyBatchResult(jobId, lastSequenceId);
    return;
  }

  const modifiedChunkCount = modifiedChunksFromWasm.length;
  if (modifiedChunkCount === 0) {
    postEmptyBatchResult(jobId, lastSequenceId);
    return;
  }
  if (modifiedChunkCount > cellCount) {
    postEmptyBatchResult(jobId, lastSequenceId);
    return;
  }

  const modifiedChunks = reusableModifiedChunks;
  modifiedChunks.length = modifiedChunkCount;
  const transferBuffers = reusableTransferBuffers;
  transferBuffers.length = modifiedChunkCount;
  const gridMaxChunkXExclusive = gridOffsetX + gridWidth;
  const gridMaxChunkZExclusive = gridOffsetZ + gridDepth;
  if (
    !Number.isSafeInteger(gridMaxChunkXExclusive) ||
    !Number.isSafeInteger(gridMaxChunkZExclusive)
  ) {
    modifiedChunks.length = 0;
    transferBuffers.length = 0;
    postEmptyBatchResult(jobId, lastSequenceId);
    return;
  }
  let validModifiedChunkCount = 0;

  for (let index = 0; index < modifiedChunkCount; index++) {
    const chunk = modifiedChunksFromWasm[index];
    if (!chunk || typeof chunk !== "object") {
      continue;
    }
    const coords = chunk.coords;
    const lights = chunk.lights;
    if (
      !Array.isArray(coords) ||
      coords.length !== 2 ||
      !isI32(coords[0]) ||
      !isI32(coords[1]) ||
      coords[0] < gridOffsetX ||
      coords[0] >= gridMaxChunkXExclusive ||
      coords[1] < gridOffsetZ ||
      coords[1] >= gridMaxChunkZExclusive ||
      !(lights instanceof Uint32Array) ||
      lights.length !== expectedVoxelCount ||
      lights.byteOffset !== 0 ||
      lights.byteLength !== expectedChunkByteLength ||
      !isArrayBuffer(lights.buffer)
    ) {
      continue;
    }
    const existing = modifiedChunks[validModifiedChunkCount];
    if (existing) {
      existing.coords[0] = coords[0];
      existing.coords[1] = coords[1];
      existing.lights = lights;
    } else {
      modifiedChunks[validModifiedChunkCount] = {
        coords: [coords[0], coords[1]],
        lights,
      };
    }
    transferBuffers[validModifiedChunkCount] = lights.buffer;
    validModifiedChunkCount++;
  }

  if (validModifiedChunkCount === 0) {
    modifiedChunks.length = 0;
    transferBuffers.length = 0;
    postEmptyBatchResult(jobId, lastSequenceId);
    return;
  }
  modifiedChunks.length = validModifiedChunkCount;
  transferBuffers.length = validModifiedChunkCount;

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
  if (!message || typeof message !== "object") {
    return;
  }
  const messageType = (message as { type?: string }).type;
  if (messageType !== "init" && messageType !== "batchOperations") {
    return;
  }

  if (messageType === "init") {
    if (!wasmInitialized) {
      try {
        await ensureWasmInitialized();
      } catch {
        registryInitialized = false;
        registryInitializationFailed = true;
        drainPendingBatchMessagesAsEmptyResults();
        return;
      }
    }

    const registryData = (message as InitMessage).registryData;
    if (
      !registryData ||
      typeof registryData !== "object" ||
      !Array.isArray(registryData.blocksById)
    ) {
      markRegistryInitializationFailed();
      return;
    }

    const wasmRegistry = convertRegistryToWasm(registryData);
    registryInitialized = set_registry(wasmRegistry);
    registryInitializationFailed = !registryInitialized;
    if (!registryInitialized) {
      markRegistryInitializationFailed();
      return;
    }

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

  if (!wasmInitialized) {
    try {
      await ensureWasmInitialized();
    } catch {
      const failedBatchMessage = message as LightBatchMessage;
      postEmptyBatchResult(
        sanitizeJobId(failedBatchMessage.jobId),
        failedBatchMessage.lastRelevantSequenceId
      );
      return;
    }
  }

  const batchMessage = message as LightBatchMessage;
  if (!registryInitialized) {
    if (registryInitializationFailed) {
      postEmptyBatchResult(
        sanitizeJobId(batchMessage.jobId),
        batchMessage.lastRelevantSequenceId
      );
      return;
    }
    if (pendingBatchMessageCount() >= MAX_PENDING_BATCH_MESSAGES) {
      const dropped = pendingBatchMessages[pendingBatchMessagesHead];
      pendingBatchMessagesHead++;
      if (dropped) {
        postEmptyBatchResult(
          sanitizeJobId(dropped.jobId),
          dropped.lastRelevantSequenceId
        );
      }
      normalizePendingBatchMessages();
    }
    pendingBatchMessages.push(batchMessage);
    return;
  }

  processBatchMessage(batchMessage);
};
