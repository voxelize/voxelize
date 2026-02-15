import { VoxelAccess } from "./access";
import { Y_ROT_SEGMENTS } from "./constants";
import { BlockRotation } from "./rotation";
import { BLOCK_RULE_NONE, BlockRule, BlockRuleLogic } from "./types";
import { Vec3 } from "./vectors";

const TWO_PI = Math.PI * 2.0;
const ANGLE_EPSILON = 1e-12;
const SEGMENT_ANGLE = TWO_PI / Y_ROT_SEGMENTS;
const MAX_PRECISION_SNAP_EPSILON = SEGMENT_ANGLE / 8;
const MAX_RULE_ENTRY_FALLBACK_SCAN = 1_024;
type RuleOptionValue = object | string | number | boolean | null | undefined;
type RuleOptionRecord = Record<string, RuleOptionValue>;
type NormalizedRuleEvaluationOptions = {
  rotationY: number;
  yRotatable: boolean;
  worldSpace: boolean;
};

const normalizeRuleYRotation = (rotation: number): number => {
  if (!Number.isFinite(rotation)) {
    return 0;
  }

  const wrappedRotation = ((rotation % TWO_PI) + TWO_PI) % TWO_PI;
  const precisionEpsilon = Math.max(
    ANGLE_EPSILON,
    Math.abs(rotation) * Number.EPSILON * 4
  );
  const stabilizedPrecisionEpsilon = Math.min(
    precisionEpsilon,
    MAX_PRECISION_SNAP_EPSILON
  );
  const snappedSegment = Math.round(wrappedRotation / SEGMENT_ANGLE);
  const snappedRotation = snappedSegment * SEGMENT_ANGLE;
  const normalizedSnappedRotation =
    ((snappedRotation % TWO_PI) + TWO_PI) % TWO_PI;
  if (
    Math.abs(wrappedRotation - normalizedSnappedRotation) <=
    stabilizedPrecisionEpsilon
  ) {
    if (
      normalizedSnappedRotation <= ANGLE_EPSILON ||
      Math.abs(normalizedSnappedRotation - TWO_PI) <= ANGLE_EPSILON
    ) {
      return 0;
    }

    return normalizedSnappedRotation;
  }

  if (
    wrappedRotation <= stabilizedPrecisionEpsilon ||
    Math.abs(wrappedRotation - TWO_PI) <= stabilizedPrecisionEpsilon
  ) {
    return 0;
  }

  return wrappedRotation;
};

const safeReadRecordValue = (
  value: RuleOptionRecord,
  key: string
): RuleOptionValue => {
  try {
    return value[key];
  } catch {
    return undefined;
  }
};

const toObjectRecordOrNull = (value: RuleOptionValue): RuleOptionRecord | null => {
  return value !== null && typeof value === "object"
    ? (value as RuleOptionRecord)
    : null;
};

const toFiniteNumberOrDefault = (value: RuleOptionValue, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const normalizeRuleEvaluationOptions = (
  options: BlockRuleEvaluationOptions
): NormalizedRuleEvaluationOptions => {
  const optionRecord = toObjectRecordOrNull(options);
  if (optionRecord === null) {
    return {
      rotationY: 0,
      yRotatable: false,
      worldSpace: false,
    };
  }

  const rotationValue = safeReadRecordValue(optionRecord, "rotation");
  const rotationRecord = toObjectRecordOrNull(rotationValue);
  const rotationY = toFiniteNumberOrDefault(
    rotationRecord === null
      ? undefined
      : safeReadRecordValue(rotationRecord, "yRotation"),
    0
  );

  return {
    rotationY,
    yRotatable: safeReadRecordValue(optionRecord, "yRotatable") === true,
    worldSpace: safeReadRecordValue(optionRecord, "worldSpace") === true,
  };
};

const isBlockRotationInstance = (value: RuleOptionValue): value is BlockRotation => {
  try {
    return value instanceof BlockRotation;
  } catch {
    return false;
  }
};

const readVoxelIdSafely = (
  access: RuleAccess,
  x: number,
  y: number,
  z: number
): number | null => {
  try {
    const voxelId = access.getVoxel(x, y, z);
    return typeof voxelId === "number" && Number.isFinite(voxelId)
      ? voxelId
      : null;
  } catch {
    return null;
  }
};

const readVoxelStageSafely = (
  access: RuleAccess,
  x: number,
  y: number,
  z: number
): number | null => {
  try {
    const voxelStage = access.getVoxelStage(x, y, z);
    return typeof voxelStage === "number" && Number.isFinite(voxelStage)
      ? voxelStage
      : null;
  } catch {
    return null;
  }
};

const readVoxelRotationSafely = (
  access: RuleAccess,
  x: number,
  y: number,
  z: number
): BlockRotation | null => {
  try {
    const voxelRotation = access.getVoxelRotation(x, y, z);
    return isBlockRotationInstance(voxelRotation) ? voxelRotation : null;
  } catch {
    return null;
  }
};

const areRotationsEqualSafely = (
  left: BlockRotation,
  right: BlockRotation
): boolean => {
  try {
    return left.equals(right);
  } catch {
    return false;
  }
};

const toRoundedFiniteCoordinateOrNull = (value: number): number | null => {
  return Number.isFinite(value) ? Math.round(value) : null;
};

const toRoundedCheckPositionOrNull = (
  position: Vec3,
  offset: Vec3
): Vec3 | null => {
  const checkX = toRoundedFiniteCoordinateOrNull(position[0] + offset[0]);
  const checkY = toRoundedFiniteCoordinateOrNull(position[1] + offset[1]);
  const checkZ = toRoundedFiniteCoordinateOrNull(position[2] + offset[2]);
  if (checkX === null || checkY === null || checkZ === null) {
    return null;
  }

  return [checkX, checkY, checkZ];
};

const toRuleEntryOrNone = (value: RuleOptionValue): BlockRule => {
  if (value === null || typeof value !== "object") {
    return BLOCK_RULE_NONE;
  }

  const valueRecord = value as RuleOptionRecord;
  const ruleType = safeReadRecordValue(valueRecord, "type");
  if (ruleType === "none") {
    return BLOCK_RULE_NONE;
  }

  if (ruleType === "simple") {
    const offsetValue = safeReadRecordValue(valueRecord, "offset");
    if (!Array.isArray(offsetValue)) {
      return BLOCK_RULE_NONE;
    }

    let x: RuleOptionValue = null;
    let y: RuleOptionValue = null;
    let z: RuleOptionValue = null;
    try {
      if (offsetValue.length !== 3) {
        return BLOCK_RULE_NONE;
      }

      x = offsetValue[0];
      y = offsetValue[1];
      z = offsetValue[2];
    } catch {
      return BLOCK_RULE_NONE;
    }

    if (
      typeof x !== "number" ||
      !Number.isFinite(x) ||
      typeof y !== "number" ||
      !Number.isFinite(y) ||
      typeof z !== "number" ||
      !Number.isFinite(z)
    ) {
      return BLOCK_RULE_NONE;
    }

    return value as BlockRule;
  }

  if (ruleType === "combination") {
    const logicValue = safeReadRecordValue(valueRecord, "logic");
    const rulesValue = safeReadRecordValue(valueRecord, "rules");
    if (
      logicValue !== BlockRuleLogic.And &&
      logicValue !== BlockRuleLogic.Or &&
      logicValue !== BlockRuleLogic.Not
    ) {
      return BLOCK_RULE_NONE;
    }
    if (!Array.isArray(rulesValue)) {
      return BLOCK_RULE_NONE;
    }

    return value as BlockRule;
  }

  return BLOCK_RULE_NONE;
};

type IndexedRuleEntry = {
  index: number;
  rule: BlockRule;
};

const toRuleEntriesFromLengthFallback = (
  value: RuleOptionValue
): IndexedRuleEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  let lengthValue = 0;
  try {
    lengthValue = value.length;
  } catch {
    return [];
  }

  if (!Number.isSafeInteger(lengthValue) || lengthValue < 0) {
    return [];
  }

  const boundedLength = Math.min(lengthValue, MAX_RULE_ENTRY_FALLBACK_SCAN);
  const recoveredRules: IndexedRuleEntry[] = [];
  let canProbeOwnProperty = true;
  for (let index = 0; index < boundedLength; index += 1) {
    let indexPresent = false;
    let requiresDirectRead = false;

    if (canProbeOwnProperty) {
      try {
        indexPresent = Object.prototype.hasOwnProperty.call(value, index);
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

    let entryValue: RuleOptionValue = undefined;
    try {
      entryValue = value[index] as RuleOptionValue;
      if (requiresDirectRead && entryValue === undefined) {
        continue;
      }
    } catch {
      continue;
    }

    recoveredRules.push({
      index,
      rule: toRuleEntryOrNone(entryValue),
    });
  }

  return recoveredRules;
};

const toNonNegativeSafeArrayIndex = (indexKey: string): number | null => {
  if (!/^(0|[1-9]\d*)$/.test(indexKey)) {
    return null;
  }

  const numericIndex = Number(indexKey);
  return Number.isSafeInteger(numericIndex) ? numericIndex : null;
};

const insertBoundedSortedRuleIndex = (
  indices: number[],
  index: number,
  maxCount: number
): void => {
  let low = 0;
  let high = indices.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (indices[mid] < index) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  const insertPosition = low;

  if (indices[insertPosition] === index) {
    return;
  }

  if (indices.length >= maxCount && insertPosition >= maxCount) {
    return;
  }

  indices.splice(insertPosition, 0, index);
  if (indices.length > maxCount) {
    indices.pop();
  }
};

const toRuleEntriesFromKeyFallback = (
  value: RuleOptionValue
): IndexedRuleEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  let indexKeys: string[] = [];
  try {
    indexKeys = Object.keys(value);
  } catch {
    return [];
  }

  const ruleIndices: number[] = [];
  for (const indexKey of indexKeys) {
    const numericIndex = toNonNegativeSafeArrayIndex(indexKey);
    if (numericIndex === null) {
      continue;
    }

    insertBoundedSortedRuleIndex(
      ruleIndices,
      numericIndex,
      MAX_RULE_ENTRY_FALLBACK_SCAN
    );
  }
  const recoveredRules: IndexedRuleEntry[] = [];

  for (const ruleIndex of ruleIndices) {
    let entryValue: RuleOptionValue = undefined;
    try {
      entryValue = value[ruleIndex] as RuleOptionValue;
    } catch {
      continue;
    }

    recoveredRules.push({
      index: ruleIndex,
      rule: toRuleEntryOrNone(entryValue),
    });
  }

  return recoveredRules;
};

const toRuleEntriesFromIndexedEntries = (
  entries: IndexedRuleEntry[]
): BlockRule[] => {
  return entries.map((entry) => {
    return entry.rule;
  });
};

const mergeIndexedRuleEntries = (
  primaryEntries: IndexedRuleEntry[],
  supplementalEntries: IndexedRuleEntry[]
): IndexedRuleEntry[] => {
  const mergedEntries = new Map<number, BlockRule>();
  for (const entry of primaryEntries) {
    if (!mergedEntries.has(entry.index)) {
      mergedEntries.set(entry.index, entry.rule);
    }
  }

  for (const entry of supplementalEntries) {
    if (!mergedEntries.has(entry.index)) {
      mergedEntries.set(entry.index, entry.rule);
      continue;
    }

    const existingRule = mergedEntries.get(entry.index);
    if (existingRule?.type === "none" && entry.rule.type !== "none") {
      mergedEntries.set(entry.index, entry.rule);
    }
  }

  return Array.from(mergedEntries.entries())
    .sort((left, right) => {
      return left[0] - right[0];
    })
    .slice(0, MAX_RULE_ENTRY_FALLBACK_SCAN)
    .map(([index, rule]) => {
      return {
        index,
        rule,
      };
    });
};

const toRuleEntriesOrEmpty = (
  rule: Extract<BlockRule, { type: "combination" }>
): BlockRule[] => {
  let rawRules: RuleOptionValue = undefined;
  try {
    rawRules = rule.rules as RuleOptionValue;
  } catch {
    return [];
  }

  if (!Array.isArray(rawRules)) {
    return [];
  }

  try {
    return Array.from(rawRules).map((entry) => {
      return toRuleEntryOrNone(entry as RuleOptionValue);
    });
  } catch {
    const lengthFallbackRuleEntries = toRuleEntriesFromLengthFallback(rawRules);
    const hasNonNoneLengthFallbackRule = lengthFallbackRuleEntries.some((entry) => {
      return entry.rule.type !== "none";
    });
    if (lengthFallbackRuleEntries.length >= MAX_RULE_ENTRY_FALLBACK_SCAN) {
      return toRuleEntriesFromIndexedEntries(lengthFallbackRuleEntries);
    }

    const keyFallbackRuleEntries = toRuleEntriesFromKeyFallback(rawRules);
    if (keyFallbackRuleEntries.length > 0) {
      if (hasNonNoneLengthFallbackRule) {
        const mergedRuleEntries = mergeIndexedRuleEntries(
          lengthFallbackRuleEntries,
          keyFallbackRuleEntries
        );
        return toRuleEntriesFromIndexedEntries(mergedRuleEntries);
      }

      return toRuleEntriesFromIndexedEntries(keyFallbackRuleEntries);
    }

    return toRuleEntriesFromIndexedEntries(lengthFallbackRuleEntries);
  }
};

const rotateOffsetY = (offset: Vec3, rotationY: number): Vec3 => {
  const rot = normalizeRuleYRotation(rotationY);

  if (Math.abs(rot) <= ANGLE_EPSILON) {
    return [...offset];
  }

  const cosRot = Math.cos(rot);
  const sinRot = Math.sin(rot);
  const [x, y, z] = offset;

  return [x * cosRot - z * sinRot, y, x * sinRot + z * cosRot];
};

export interface BlockRuleEvaluationRotationInput {
  yRotation: number;
}

export interface BlockRuleEvaluationOptions {
  rotation?: BlockRotation | BlockRuleEvaluationRotationInput | null;
  yRotatable?: boolean | null;
  worldSpace?: boolean | null;
}

type RuleAccess = Pick<
  VoxelAccess,
  "getVoxel" | "getVoxelRotation" | "getVoxelStage"
>;

export class BlockRuleEvaluator {
  private static evaluateWithNormalizedOptions(
    rule: BlockRule,
    position: Vec3,
    access: RuleAccess,
    options: NormalizedRuleEvaluationOptions,
    activeCombinationRules: Set<BlockRule>
  ): boolean {
    const { rotationY, yRotatable, worldSpace } = options;

    if (rule.type === "none") {
      return true;
    }

    if (rule.type === "simple") {
      let offset: Vec3 = [...rule.offset];
      const hasRuleConstraint =
        (rule.id !== undefined && rule.id !== null) ||
        (rule.rotation !== undefined && rule.rotation !== null) ||
        (rule.stage !== undefined && rule.stage !== null);

      if (yRotatable && !worldSpace) {
        offset = rotateOffsetY(offset, rotationY);
      }

      const checkPosition = toRoundedCheckPositionOrNull(position, offset);
      if (checkPosition === null) {
        return !hasRuleConstraint;
      }

      if (rule.id !== undefined && rule.id !== null) {
        const actualId = readVoxelIdSafely(
          access,
          checkPosition[0],
          checkPosition[1],
          checkPosition[2]
        );
        if (actualId === null || actualId !== rule.id) {
          return false;
        }
      }

      if (rule.rotation !== undefined && rule.rotation !== null) {
        const actualRotation = readVoxelRotationSafely(
          access,
          checkPosition[0],
          checkPosition[1],
          checkPosition[2]
        );
        if (
          actualRotation === null ||
          !areRotationsEqualSafely(actualRotation, rule.rotation)
        ) {
          return false;
        }
      }

      if (rule.stage !== undefined && rule.stage !== null) {
        const actualStage = readVoxelStageSafely(
          access,
          checkPosition[0],
          checkPosition[1],
          checkPosition[2]
        );
        if (actualStage === null || actualStage !== rule.stage) {
          return false;
        }
      }

      return true;
    }

    if (activeCombinationRules.has(rule)) {
      return true;
    }

    const ruleEntries = toRuleEntriesOrEmpty(rule);
    activeCombinationRules.add(rule);
    try {
      switch (rule.logic) {
        case BlockRuleLogic.And:
          return ruleEntries.every((subRule) =>
            BlockRuleEvaluator.evaluateWithNormalizedOptions(
              subRule,
              position,
              access,
              options,
              activeCombinationRules
            )
          );
        case BlockRuleLogic.Or:
          return ruleEntries.some((subRule) =>
            BlockRuleEvaluator.evaluateWithNormalizedOptions(
              subRule,
              position,
              access,
              options,
              activeCombinationRules
            )
          );
        case BlockRuleLogic.Not: {
          const [firstRule] = ruleEntries;
          if (firstRule === undefined) {
            return true;
          }

          return !BlockRuleEvaluator.evaluateWithNormalizedOptions(
            firstRule,
            position,
            access,
            options,
            activeCombinationRules
          );
        }
        default:
          return false;
      }
    } finally {
      activeCombinationRules.delete(rule);
    }
  }

  static evaluate(
    rule: BlockRule,
    position: Vec3,
    access: RuleAccess,
    options: BlockRuleEvaluationOptions = {}
  ): boolean {
    const normalizedOptions = normalizeRuleEvaluationOptions(options);
    return BlockRuleEvaluator.evaluateWithNormalizedOptions(
      rule,
      position,
      access,
      normalizedOptions,
      new Set()
    );
  }
}
