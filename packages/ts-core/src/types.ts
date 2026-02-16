import { AABB } from "./aabb";
import { BlockRotation } from "./rotation";
import { FaceTransparency, Vec2, Vec3 } from "./vectors";

export interface UV {
  startU: number;
  endU: number;
  startV: number;
  endV: number;
}

export const createUV = (
  startU = 0,
  endU = 0,
  startV = 0,
  endV = 0
): UV => ({
  startU,
  endU,
  startV,
  endV,
});

export interface CornerData {
  pos: Vec3;
  uv: Vec2;
}

const cloneCornerVec3Safely = (value: Vec3): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  try {
    x = value[0];
    y = value[1];
    z = value[2];
  } catch {
    return [0, 0, 0];
  }

  return [
    Number.isFinite(x) ? x : 0,
    Number.isFinite(y) ? y : 0,
    Number.isFinite(z) ? z : 0,
  ];
};

const cloneCornerVec2Safely = (value: Vec2): Vec2 => {
  let x = 0;
  let y = 0;
  try {
    x = value[0];
    y = value[1];
  } catch {
    return [0, 0];
  }

  return [Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0];
};

export const createCornerData = (pos: Vec3, uv: Vec2): CornerData => ({
  pos: cloneCornerVec3Safely(pos),
  uv: cloneCornerVec2Safely(uv),
});

const createDefaultCorner = (): CornerData => ({
  pos: [0, 0, 0],
  uv: [0, 0],
});

const createDefaultCorners = (): [
  CornerData,
  CornerData,
  CornerData,
  CornerData,
] => [
  createDefaultCorner(),
  createDefaultCorner(),
  createDefaultCorner(),
  createDefaultCorner(),
];

export interface BlockFaceInit {
  name: string;
  independent?: boolean;
  isolated?: boolean;
  textureGroup?: string | null;
  dir?: Vec3;
  corners?: [CornerData, CornerData, CornerData, CornerData];
  range?: UV;
}

type BlockFaceNameLike = string | number | boolean | object | null | undefined;

const toBlockFaceNameOrFallback = (
  value: BlockFaceNameLike,
  fallback: string
): string => {
  return typeof value === "string" ? value : fallback;
};

const toBlockFaceNameLowerOrFallback = (
  value: BlockFaceNameLike,
  fallback: string
): string => {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return value.toLowerCase();
  } catch {
    return fallback;
  }
};

export class BlockFace {
  public name: string;
  public nameLower: string;
  public independent: boolean;
  public isolated: boolean;
  public textureGroup: string | null;
  public dir: Vec3;
  public corners: [CornerData, CornerData, CornerData, CornerData];
  public range: UV;

  constructor({
    name,
    independent = false,
    isolated = false,
    textureGroup = null,
    dir = [0, 0, 0],
    corners = createDefaultCorners(),
    range = createUV(),
  }: BlockFaceInit) {
    const normalizedName = toBlockFaceNameOrFallback(name, "Face");
    this.name = normalizedName;
    this.nameLower = toBlockFaceNameLowerOrFallback(normalizedName, "face");
    this.independent = independent;
    this.isolated = isolated;
    this.textureGroup = textureGroup;
    this.dir = [...dir];
    this.corners = corners.map((corner) => createCornerData(corner.pos, corner.uv)) as [
      CornerData,
      CornerData,
      CornerData,
      CornerData,
    ];
    this.range = { ...range };
  }

  computeNameLower(): void {
    let fallbackNameLower = "face";
    try {
      fallbackNameLower = typeof this.nameLower === "string"
        ? this.nameLower
        : "face";
    } catch {
      fallbackNameLower = "face";
    }

    let nextNameLower = fallbackNameLower;
    try {
      nextNameLower = toBlockFaceNameLowerOrFallback(
        this.name,
        fallbackNameLower
      );
    } catch {
      nextNameLower = fallbackNameLower;
    }

    try {
      this.nameLower = nextNameLower;
    } catch {
      // no-op when context is not writable
    }
  }

  getNameLower(): string {
    let normalizedNameLower = "";
    try {
      normalizedNameLower = typeof this.nameLower === "string"
        ? this.nameLower
        : "";
    } catch {
      normalizedNameLower = "";
    }

    if (normalizedNameLower.length === 0) {
      try {
        return toBlockFaceNameOrFallback(this.name, "");
      } catch {
        return "";
      }
    }

    return normalizedNameLower;
  }
}

const DEFAULT_BLOCK_FACE_INIT: BlockFaceInit = {
  name: "Face",
};

export const createBlockFace = (
  init: BlockFaceInput | null | undefined = DEFAULT_BLOCK_FACE_INIT
): BlockFace => {
  if (init === null || init === undefined) {
    return new BlockFace(DEFAULT_BLOCK_FACE_INIT);
  }

  const normalizedFace = toBlockFaceInit(init);
  return new BlockFace(normalizedFace ?? DEFAULT_BLOCK_FACE_INIT);
};

export type OptionalRuleValue<T> = T | null | undefined;

export type BlockSimpleRule = {
  offset: Vec3;
  id?: OptionalRuleValue<number>;
  rotation?: OptionalRuleValue<BlockRotation>;
  stage?: OptionalRuleValue<number>;
};

export enum BlockRuleLogic {
  And = "and",
  Or = "or",
  Not = "not",
}

export type BlockRule =
  | { type: "none" }
  | ({ type: "simple" } & BlockSimpleRule)
  | { type: "combination"; logic: BlockRuleLogic; rules: BlockRule[] };

export interface BlockRotationInput {
  readonly value: number;
  readonly yRotation: number;
}

export type BlockSimpleRuleInput = {
  type: "simple";
  offset: readonly [number, number, number];
  id?: OptionalRuleValue<number>;
  rotation?: OptionalRuleValue<BlockRotation | BlockRotationInput>;
  stage?: OptionalRuleValue<number>;
};

export type BlockRuleInput =
  | { type: "none" }
  | BlockSimpleRuleInput
  | {
      type: "combination";
      logic: BlockRuleLogic;
      rules: readonly (BlockRuleInput | null | undefined)[];
    };

export const BLOCK_RULE_NONE: BlockRule = { type: "none" };

export interface BlockConditionalPart {
  rule: BlockRule;
  faces: BlockFace[];
  aabbs: AABB[];
  isTransparent: FaceTransparency;
  worldSpace: boolean;
}

export interface BlockDynamicPattern {
  parts: BlockConditionalPart[];
}

export interface AABBInit {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export type BlockFaceInput = BlockFace | BlockFaceInit;
export type AABBInput = AABB | AABBInit;
export type FaceTransparencyInput = readonly [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
];
export type FaceTransparencyLike =
  | FaceTransparencyInput
  | readonly (boolean | null | undefined)[]
  | null;

export interface BlockConditionalPartInput {
  rule?: BlockRuleInput | null;
  faces?: readonly (BlockFaceInput | null | undefined)[];
  aabbs?: readonly (AABBInput | null | undefined)[];
  isTransparent?: FaceTransparencyLike;
  worldSpace?: boolean | null;
}

export interface BlockDynamicPatternInput {
  parts?: readonly (BlockConditionalPartInput | null | undefined)[];
}

type DynamicValue =
  | object
  | string
  | number
  | boolean
  | null
  | undefined;
const MAX_ARRAY_ENTRY_FALLBACK_SCAN = 1_024;

const isFiniteNumberValue = (value: DynamicValue): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const isNonNegativeIntegerValue = (value: DynamicValue): value is number => {
  return isFiniteNumberValue(value) && Number.isInteger(value) && value >= 0;
};

const isRotationValue = (value: DynamicValue): value is number => {
  return isNonNegativeIntegerValue(value) && value <= 0x0f;
};

const isBooleanValue = (value: DynamicValue): value is boolean => {
  return typeof value === "boolean";
};

const isArrayValue = (value: DynamicValue): value is readonly DynamicValue[] => {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
};

const hasPlainObjectPrototype = (value: object): boolean => {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
};

const isPlainObjectValue = (
  value: DynamicValue
): value is Record<string, DynamicValue> => {
  if (value === null || typeof value !== "object" || isArrayValue(value)) {
    return false;
  }

  return hasPlainObjectPrototype(value);
};

const readArrayEntry = (
  value: readonly DynamicValue[],
  index: number
): DynamicValue => {
  try {
    return value[index];
  } catch {
    return undefined;
  }
};

type IndexedArrayEntry = {
  index: number;
  value: DynamicValue;
};

const cloneArrayFromLengthFallback = (
  value: readonly DynamicValue[]
): IndexedArrayEntry[] | null => {
  let lengthValue = 0;
  try {
    lengthValue = value.length;
  } catch {
    return null;
  }

  if (!Number.isSafeInteger(lengthValue) || lengthValue < 0) {
    return null;
  }

  const boundedLength = Math.min(lengthValue, MAX_ARRAY_ENTRY_FALLBACK_SCAN);
  const recoveredEntries: IndexedArrayEntry[] = [];
  let canProbeOwnProperty = true;
  for (let arrayIndex = 0; arrayIndex < boundedLength; arrayIndex += 1) {
    let indexPresent = false;
    let requiresDirectRead = false;

    if (canProbeOwnProperty) {
      try {
        indexPresent = Object.prototype.hasOwnProperty.call(value, arrayIndex);
      } catch {
        canProbeOwnProperty = false;
        requiresDirectRead = true;
      }
    } else {
      requiresDirectRead = true;
    }

    if (!indexPresent && !requiresDirectRead) {
      continue;
    }

    try {
      const entryValue = value[arrayIndex];
      if (requiresDirectRead && entryValue === undefined) {
        continue;
      }

      recoveredEntries.push({
        index: arrayIndex,
        value: entryValue,
      });
    } catch {
      continue;
    }
  }

  return recoveredEntries;
};

const toNonNegativeSafeArrayIndex = (indexKey: string): number | null => {
  if (!/^(0|[1-9]\d*)$/.test(indexKey)) {
    return null;
  }

  const numericIndex = Number(indexKey);
  return Number.isSafeInteger(numericIndex) ? numericIndex : null;
};

const insertBoundedSortedArrayIndex = (
  indices: number[],
  arrayIndex: number,
  maxCount: number
): void => {
  let low = 0;
  let high = indices.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (indices[mid] < arrayIndex) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const insertPosition = low;

  if (indices[insertPosition] === arrayIndex) {
    return;
  }

  if (indices.length >= maxCount && insertPosition >= maxCount) {
    return;
  }

  indices.splice(insertPosition, 0, arrayIndex);
  if (indices.length > maxCount) {
    indices.pop();
  }
};

const cloneArrayFromKeyFallback = (
  value: readonly DynamicValue[]
): IndexedArrayEntry[] | null => {
  let indexKeys: string[] = [];
  try {
    indexKeys = Object.keys(value);
  } catch {
    return null;
  }

  const boundedIndices: number[] = [];
  for (const indexKey of indexKeys) {
    const numericIndex = toNonNegativeSafeArrayIndex(indexKey);
    if (numericIndex === null) {
      continue;
    }

    insertBoundedSortedArrayIndex(
      boundedIndices,
      numericIndex,
      MAX_ARRAY_ENTRY_FALLBACK_SCAN
    );
  }

  const recoveredEntries: IndexedArrayEntry[] = [];
  for (const arrayIndex of boundedIndices) {
    try {
      recoveredEntries.push({
        index: arrayIndex,
        value: value[arrayIndex],
      });
    } catch {
      continue;
    }
  }

  if (boundedIndices.length > 0 && recoveredEntries.length === 0) {
    return null;
  }

  return recoveredEntries;
};

const toArrayValuesFromIndexedEntries = (
  entries: IndexedArrayEntry[] | null
): DynamicValue[] | null => {
  if (entries === null) {
    return null;
  }

  return entries.map((entry) => entry.value);
};

const mergeIndexedFallbackEntries = (
  primaryEntries: IndexedArrayEntry[],
  supplementalEntries: IndexedArrayEntry[]
): IndexedArrayEntry[] => {
  const isEmptyPlaceholderEntry = (entryValue: DynamicValue): boolean => {
    return entryValue === undefined || entryValue === null;
  };

  const isPrimitivePlaceholderEntry = (entryValue: DynamicValue): boolean => {
    return entryValue !== null && typeof entryValue !== "object";
  };

  const isRecoverableFallbackEntry = (entryValue: DynamicValue): boolean => {
    return entryValue !== undefined && entryValue !== null;
  };

  const isObjectFallbackEntry = (entryValue: DynamicValue): boolean => {
    return entryValue !== null && typeof entryValue === "object";
  };

  const mergedEntries = new Map<number, DynamicValue>();
  for (const entry of primaryEntries) {
    if (!mergedEntries.has(entry.index)) {
      mergedEntries.set(entry.index, entry.value);
    }
  }
  for (const entry of supplementalEntries) {
    if (!mergedEntries.has(entry.index)) {
      mergedEntries.set(entry.index, entry.value);
      continue;
    }

    const existingValue = mergedEntries.get(entry.index);
    if (
      isEmptyPlaceholderEntry(existingValue) &&
      isRecoverableFallbackEntry(entry.value)
    ) {
      mergedEntries.set(entry.index, entry.value);
      continue;
    }
    if (
      isPrimitivePlaceholderEntry(existingValue) &&
      isObjectFallbackEntry(entry.value)
    ) {
      mergedEntries.set(entry.index, entry.value);
    }
  }

  return Array.from(mergedEntries.entries())
    .sort((left, right) => {
      return left[0] - right[0];
    })
    .slice(0, MAX_ARRAY_ENTRY_FALLBACK_SCAN)
    .map(([index, entryValue]) => {
      return {
        index,
        value: entryValue,
      };
    });
};

const cloneArrayFromIndexedAccess = (
  value: readonly DynamicValue[]
): DynamicValue[] | null => {
  const lengthFallbackEntries = cloneArrayFromLengthFallback(value);
  const hasNonUndefinedLengthFallbackEntry =
    lengthFallbackEntries !== null &&
    lengthFallbackEntries.some((entry) => entry.value !== undefined);
  if (
    hasNonUndefinedLengthFallbackEntry &&
    lengthFallbackEntries !== null &&
    lengthFallbackEntries.length >= MAX_ARRAY_ENTRY_FALLBACK_SCAN
  ) {
    return toArrayValuesFromIndexedEntries(lengthFallbackEntries);
  }

  const keyFallbackEntries = cloneArrayFromKeyFallback(value);
  const lengthFallbackEntriesAreEmptyArray =
    lengthFallbackEntries !== null && lengthFallbackEntries.length === 0;
  if (
    keyFallbackEntries === null &&
    !hasNonUndefinedLengthFallbackEntry &&
    lengthFallbackEntriesAreEmptyArray
  ) {
    return null;
  }

  if (keyFallbackEntries !== null && keyFallbackEntries.length > 0) {
    if (hasNonUndefinedLengthFallbackEntry && lengthFallbackEntries !== null) {
      const mergedEntries = mergeIndexedFallbackEntries(
        lengthFallbackEntries,
        keyFallbackEntries
      );
      return toArrayValuesFromIndexedEntries(mergedEntries);
    }

    return toArrayValuesFromIndexedEntries(keyFallbackEntries);
  }

  if (hasNonUndefinedLengthFallbackEntry && lengthFallbackEntries !== null) {
    return toArrayValuesFromIndexedEntries(lengthFallbackEntries);
  }

  return toArrayValuesFromIndexedEntries(lengthFallbackEntries);
};

const cloneArrayEntriesSafely = (value: DynamicValue): DynamicValue[] | null => {
  if (!isArrayValue(value)) {
    return null;
  }

  try {
    const iteratorEntries = Array.from(value);
    if (iteratorEntries.length === 0) {
      const indexedFallbackEntries = cloneArrayFromIndexedAccess(value);
      if (indexedFallbackEntries === null) {
        return null;
      }
      if (indexedFallbackEntries.length > 0) {
        return indexedFallbackEntries;
      }
    }

    return iteratorEntries;
  } catch {
    return cloneArrayFromIndexedAccess(value);
  }
};

const readObjectEntry = (
  value: Record<string, DynamicValue>,
  key: string
): DynamicValue => {
  try {
    return value[key];
  } catch {
    return undefined;
  }
};

const isBlockRotationInstance = (
  value: DynamicValue
): value is BlockRotation => {
  try {
    return value instanceof BlockRotation;
  } catch {
    return false;
  }
};

const isBlockFaceInstance = (value: DynamicValue): value is BlockFace => {
  try {
    return value instanceof BlockFace;
  } catch {
    return false;
  }
};

const isAabbInstance = (value: DynamicValue): value is AABB => {
  try {
    return value instanceof AABB;
  } catch {
    return false;
  }
};

export const createFaceTransparency = (
  value: FaceTransparencyLike = null
): FaceTransparency => {
  if (!isArrayValue(value)) {
    return [false, false, false, false, false, false];
  }

  const transparencyValues = value as readonly DynamicValue[];
  const face0 = readArrayEntry(transparencyValues, 0);
  const face1 = readArrayEntry(transparencyValues, 1);
  const face2 = readArrayEntry(transparencyValues, 2);
  const face3 = readArrayEntry(transparencyValues, 3);
  const face4 = readArrayEntry(transparencyValues, 4);
  const face5 = readArrayEntry(transparencyValues, 5);

  return [
    isBooleanValue(face0) ? face0 : false,
    isBooleanValue(face1) ? face1 : false,
    isBooleanValue(face2) ? face2 : false,
    isBooleanValue(face3) ? face3 : false,
    isBooleanValue(face4) ? face4 : false,
    isBooleanValue(face5) ? face5 : false,
  ];
};

const isVec2Value = (value: DynamicValue): value is Vec2 => {
  if (!isArrayValue(value)) {
    return false;
  }

  let length = 0;
  try {
    length = value.length;
  } catch {
    return false;
  }

  if (length !== 2) {
    return false;
  }

  const x = readArrayEntry(value, 0);
  const y = readArrayEntry(value, 1);
  return isFiniteNumberValue(x) && isFiniteNumberValue(y);
};

const isVec3Value = (value: DynamicValue): value is Vec3 => {
  if (!isArrayValue(value)) {
    return false;
  }

  let length = 0;
  try {
    length = value.length;
  } catch {
    return false;
  }

  if (length !== 3) {
    return false;
  }

  const x = readArrayEntry(value, 0);
  const y = readArrayEntry(value, 1);
  const z = readArrayEntry(value, 2);
  return isFiniteNumberValue(x) && isFiniteNumberValue(y) && isFiniteNumberValue(z);
};

const isUvValue = (value: DynamicValue): value is UV => {
  if (value === null || typeof value !== "object" || isArrayValue(value)) {
    return false;
  }

  const maybeUv = value as {
    startU?: DynamicValue;
    endU?: DynamicValue;
    startV?: DynamicValue;
    endV?: DynamicValue;
  };
  return (
    isFiniteNumberValue(maybeUv.startU) &&
    isFiniteNumberValue(maybeUv.endU) &&
    isFiniteNumberValue(maybeUv.startV) &&
    isFiniteNumberValue(maybeUv.endV)
  );
};

const isCornerDataValue = (value: DynamicValue): value is CornerData => {
  if (value === null || typeof value !== "object" || isArrayValue(value)) {
    return false;
  }

  const maybeCorner = value as {
    pos?: DynamicValue;
    uv?: DynamicValue;
  };
  return isVec3Value(maybeCorner.pos) && isVec2Value(maybeCorner.uv);
};

const toCornerTuple = (
  value: DynamicValue
): [CornerData, CornerData, CornerData, CornerData] | undefined => {
  const cornerEntries = cloneArrayEntriesSafely(value);
  if (cornerEntries === null || cornerEntries.length !== 4) {
    return undefined;
  }

  const corner0 = readArrayEntry(cornerEntries, 0);
  const corner1 = readArrayEntry(cornerEntries, 1);
  const corner2 = readArrayEntry(cornerEntries, 2);
  const corner3 = readArrayEntry(cornerEntries, 3);
  if (
    !isCornerDataValue(corner0) ||
    !isCornerDataValue(corner1) ||
    !isCornerDataValue(corner2) ||
    !isCornerDataValue(corner3)
  ) {
    return undefined;
  }

  return [
    createCornerData(corner0.pos, corner0.uv),
    createCornerData(corner1.pos, corner1.uv),
    createCornerData(corner2.pos, corner2.uv),
    createCornerData(corner3.pos, corner3.uv),
  ];
};

const toOptionalRuleNumber = (
  value: DynamicValue,
  maximum: number
): number | undefined => {
  return isNonNegativeIntegerValue(value) && value <= maximum
    ? value
    : undefined;
};

const toBlockRotation = (value: DynamicValue): BlockRotation | null => {
  try {
    if (isBlockRotationInstance(value)) {
      const axis = value.value;
      const yRotation = value.yRotation;
      if (!isRotationValue(axis) || !isFiniteNumberValue(yRotation)) {
        return null;
      }

      return new BlockRotation(axis, yRotation);
    }

    if (!isPlainObjectValue(value)) {
      return null;
    }

    const axis = readObjectEntry(value, "value");
    const yRotation = readObjectEntry(value, "yRotation");
    if (!isRotationValue(axis) || !isFiniteNumberValue(yRotation)) {
      return null;
    }

    return new BlockRotation(axis, yRotation);
  } catch {
    return null;
  }
};

export const createBlockRotation = (
  rotation: BlockRotation | BlockRotationInput | null | undefined = BlockRotation.py(0)
): BlockRotation => {
  return toBlockRotation(rotation) ?? BlockRotation.py(0);
};

const toOptionalRuleRotation = (
  value: DynamicValue
): BlockRotation | undefined => {
  return toBlockRotation(value) ?? undefined;
};

const toBlockRule = (
  value: DynamicValue,
  path: Set<object> = new Set<object>()
): BlockRule => {
  if (!isPlainObjectValue(value)) {
    return { type: "none" };
  }
  if (path.has(value)) {
    return { type: "none" };
  }

  path.add(value);
  try {
    const maybeRule = value as {
      type?: DynamicValue;
      logic?: DynamicValue;
      rules?: DynamicValue;
      offset?: DynamicValue;
      id?: DynamicValue;
      rotation?: DynamicValue;
      stage?: DynamicValue;
    };
    if (maybeRule.type === "none") {
      return { type: "none" };
    }

    if (maybeRule.type === "simple") {
      if (!isVec3Value(maybeRule.offset)) {
        return { type: "none" };
      }

      const simpleRule: { type: "simple" } & BlockSimpleRule = {
        type: "simple",
        offset: [...maybeRule.offset],
      };
      const id = toOptionalRuleNumber(maybeRule.id, 0xffff);
      if (id !== undefined) {
        simpleRule.id = id;
      }
      const stage = toOptionalRuleNumber(maybeRule.stage, 0x0f);
      if (stage !== undefined) {
        simpleRule.stage = stage;
      }
      const rotation = toOptionalRuleRotation(maybeRule.rotation);
      if (rotation !== undefined) {
        simpleRule.rotation = rotation;
      }

      return simpleRule;
    }

    if (maybeRule.type === "combination") {
      const logic =
        maybeRule.logic === BlockRuleLogic.And ||
        maybeRule.logic === BlockRuleLogic.Or ||
        maybeRule.logic === BlockRuleLogic.Not
          ? maybeRule.logic
          : null;
      const nestedRules = cloneArrayEntriesSafely(maybeRule.rules);
      if (logic === null || nestedRules === null) {
        return { type: "none" };
      }

      return {
        type: "combination",
        logic,
        rules: nestedRules.map((nestedRule) => toBlockRule(nestedRule, path)),
      };
    }

    return { type: "none" };
  } catch {
    return { type: "none" };
  } finally {
    path.delete(value);
  }
};

export const createBlockRule = (
  rule: BlockRuleInput | null | undefined = BLOCK_RULE_NONE
): BlockRule => {
  return toBlockRule(rule);
};

const toBlockFaceInit = (face: BlockFaceInput): BlockFaceInit | null => {
  try {
    const maybeFace: {
      name?: DynamicValue;
      independent?: DynamicValue;
      isolated?: DynamicValue;
      textureGroup?: DynamicValue;
      dir?: DynamicValue;
      corners?: DynamicValue;
      range?: DynamicValue;
    } | null = isBlockFaceInstance(face)
      ? {
          name: face.name,
          independent: face.independent,
          isolated: face.isolated,
          textureGroup: face.textureGroup,
          dir: face.dir,
          corners: face.corners,
          range: face.range,
        }
      : isPlainObjectValue(face)
        ? face
        : null;
    if (maybeFace === null) {
      return null;
    }

    if (typeof maybeFace.name !== "string") {
      return null;
    }

    const textureGroup =
      maybeFace.textureGroup === undefined ||
      maybeFace.textureGroup === null ||
      typeof maybeFace.textureGroup === "string"
        ? maybeFace.textureGroup
        : undefined;

    return {
      name: maybeFace.name,
      independent:
        typeof maybeFace.independent === "boolean"
          ? maybeFace.independent
          : undefined,
      isolated:
        typeof maybeFace.isolated === "boolean" ? maybeFace.isolated : undefined,
      textureGroup,
      dir: isVec3Value(maybeFace.dir) ? [...maybeFace.dir] : undefined,
      corners: toCornerTuple(maybeFace.corners),
      range: isUvValue(maybeFace.range)
        ? {
            startU: maybeFace.range.startU,
            endU: maybeFace.range.endU,
            startV: maybeFace.range.startV,
            endV: maybeFace.range.endV,
          }
        : undefined,
    };
  } catch {
    return null;
  }
};

const cloneBlockFace = (
  face: BlockFaceInput | null | undefined
): BlockFace | null => {
  if (face === null || face === undefined) {
    return null;
  }

  const faceInit = toBlockFaceInit(face);
  if (faceInit === null) {
    return null;
  }

  return new BlockFace(faceInit);
};

type AabbLikeValue = {
  minX?: DynamicValue;
  minY?: DynamicValue;
  minZ?: DynamicValue;
  maxX?: DynamicValue;
  maxY?: DynamicValue;
  maxZ?: DynamicValue;
};

const toFiniteAabbInit = (aabb: AabbLikeValue): AABBInit | null => {
  try {
    if (
      !isFiniteNumberValue(aabb.minX) ||
      !isFiniteNumberValue(aabb.minY) ||
      !isFiniteNumberValue(aabb.minZ) ||
      !isFiniteNumberValue(aabb.maxX) ||
      !isFiniteNumberValue(aabb.maxY) ||
      !isFiniteNumberValue(aabb.maxZ)
    ) {
      return null;
    }

    return {
      minX: aabb.minX,
      minY: aabb.minY,
      minZ: aabb.minZ,
      maxX: aabb.maxX,
      maxY: aabb.maxY,
      maxZ: aabb.maxZ,
    };
  } catch {
    return null;
  }
};

const cloneAabb = (aabb: AABBInput | null | undefined): AABB | null => {
  if (isAabbInstance(aabb)) {
    const finiteAabb = toFiniteAabbInit(aabb);
    if (finiteAabb === null) {
      return null;
    }

    return AABB.create(
      finiteAabb.minX,
      finiteAabb.minY,
      finiteAabb.minZ,
      finiteAabb.maxX,
      finiteAabb.maxY,
      finiteAabb.maxZ
    );
  }

  if (!isPlainObjectValue(aabb)) {
    return null;
  }

  const finiteAabb = toFiniteAabbInit(aabb);
  if (finiteAabb === null) {
    return null;
  }

  return AABB.create(
    finiteAabb.minX,
    finiteAabb.minY,
    finiteAabb.minZ,
    finiteAabb.maxX,
    finiteAabb.maxY,
    finiteAabb.maxZ
  );
};

export const createAABB = (aabb: AABBInput | null | undefined = null): AABB => {
  const clonedAabb = cloneAabb(aabb);
  return clonedAabb ?? AABB.empty();
};

export const createBlockConditionalPart = (
  part: BlockConditionalPartInput | null = {}
): BlockConditionalPart => {
  const normalizedPart: Record<string, DynamicValue> = isPlainObjectValue(part)
    ? part
    : {};
  const facesValue = readObjectEntry(normalizedPart, "faces");
  const aabbsValue = readObjectEntry(normalizedPart, "aabbs");
  const isTransparentValue = readObjectEntry(normalizedPart, "isTransparent");
  const ruleValue = readObjectEntry(normalizedPart, "rule");
  const worldSpaceValue = readObjectEntry(normalizedPart, "worldSpace");
  const faceEntries = cloneArrayEntriesSafely(facesValue);
  const faces = faceEntries === null
    ? []
    : faceEntries.reduce<BlockFace[]>((clonedFaces, face) => {
        const clonedFace = cloneBlockFace(
          face as BlockFaceInput | null | undefined
        );
        if (clonedFace !== null) {
          clonedFaces.push(clonedFace);
        }

        return clonedFaces;
      }, []);
  const aabbEntries = cloneArrayEntriesSafely(aabbsValue);
  const aabbs = aabbEntries === null
    ? []
    : aabbEntries.reduce<AABB[]>((clonedAabbs, aabb) => {
        const clonedAabb = cloneAabb(aabb as AABBInput | null | undefined);
        if (clonedAabb !== null) {
          clonedAabbs.push(clonedAabb);
        }

        return clonedAabbs;
      }, []);
  const isTransparent = createFaceTransparency(
    isTransparentValue as FaceTransparencyLike
  );
  const rule = createBlockRule(ruleValue as BlockRuleInput | null | undefined);

  return {
    rule,
    faces,
    aabbs,
    isTransparent,
    worldSpace: isBooleanValue(worldSpaceValue)
      ? worldSpaceValue
      : false,
  };
};

export const createBlockDynamicPattern = (
  pattern: BlockDynamicPatternInput | null = {}
): BlockDynamicPattern => {
  const normalizedPattern: Record<string, DynamicValue> = isPlainObjectValue(pattern)
    ? pattern
    : {};
  const partsValue = readObjectEntry(normalizedPattern, "parts");
  const partEntries = cloneArrayEntriesSafely(partsValue);
  const parts = partEntries === null
    ? []
    : partEntries.reduce<BlockConditionalPart[]>((clonedParts, part) => {
        if (isPlainObjectValue(part)) {
          clonedParts.push(createBlockConditionalPart(part as BlockConditionalPartInput));
        }

        return clonedParts;
      }, []);

  return {
    parts,
  };
};
