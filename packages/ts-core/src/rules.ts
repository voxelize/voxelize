import { VoxelAccess } from "./access";
import { Y_ROT_SEGMENTS } from "./constants";
import { BlockRotation } from "./rotation";
import { BlockRule, BlockRuleLogic } from "./types";
import { Vec3 } from "./vectors";

const TWO_PI = Math.PI * 2.0;
const ANGLE_EPSILON = 1e-12;
const SEGMENT_ANGLE = TWO_PI / Y_ROT_SEGMENTS;
const MAX_PRECISION_SNAP_EPSILON = SEGMENT_ANGLE / 8;
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

    activeCombinationRules.add(rule);
    try {
      switch (rule.logic) {
        case BlockRuleLogic.And:
          return rule.rules.every((subRule) =>
            BlockRuleEvaluator.evaluateWithNormalizedOptions(
              subRule,
              position,
              access,
              options,
              activeCombinationRules
            )
          );
        case BlockRuleLogic.Or:
          return rule.rules.some((subRule) =>
            BlockRuleEvaluator.evaluateWithNormalizedOptions(
              subRule,
              position,
              access,
              options,
              activeCombinationRules
            )
          );
        case BlockRuleLogic.Not: {
          const [firstRule] = rule.rules;
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
