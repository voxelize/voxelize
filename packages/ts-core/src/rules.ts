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
): {
  rotationY: number;
  yRotatable: boolean;
  worldSpace: boolean;
} => {
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

export interface BlockRuleEvaluationOptions {
  rotation?: BlockRotation;
  yRotatable?: boolean;
  worldSpace?: boolean;
}

type RuleAccess = Pick<
  VoxelAccess,
  "getVoxel" | "getVoxelRotation" | "getVoxelStage"
>;

export class BlockRuleEvaluator {
  static evaluate(
    rule: BlockRule,
    position: Vec3,
    access: RuleAccess,
    options: BlockRuleEvaluationOptions = {}
  ): boolean {
    const { rotationY, yRotatable, worldSpace } =
      normalizeRuleEvaluationOptions(options);

    if (rule.type === "none") {
      return true;
    }

    if (rule.type === "simple") {
      let offset: Vec3 = [...rule.offset];

      if (yRotatable && !worldSpace) {
        offset = rotateOffsetY(offset, rotationY);
      }

      const checkPosition: Vec3 = [
        position[0] + Math.round(offset[0]),
        position[1] + Math.round(offset[1]),
        position[2] + Math.round(offset[2]),
      ];

      if (rule.id !== undefined && rule.id !== null) {
        const actualId = access.getVoxel(
          checkPosition[0],
          checkPosition[1],
          checkPosition[2]
        );
        if (actualId !== rule.id) {
          return false;
        }
      }

      if (rule.rotation !== undefined && rule.rotation !== null) {
        const actualRotation = access.getVoxelRotation(
          checkPosition[0],
          checkPosition[1],
          checkPosition[2]
        );
        if (!actualRotation.equals(rule.rotation)) {
          return false;
        }
      }

      if (rule.stage !== undefined && rule.stage !== null) {
        const actualStage = access.getVoxelStage(
          checkPosition[0],
          checkPosition[1],
          checkPosition[2]
        );
        if (actualStage !== rule.stage) {
          return false;
        }
      }

      return true;
    }

    switch (rule.logic) {
      case BlockRuleLogic.And:
        return rule.rules.every((subRule) =>
          BlockRuleEvaluator.evaluate(subRule, position, access, options)
        );
      case BlockRuleLogic.Or:
        return rule.rules.some((subRule) =>
          BlockRuleEvaluator.evaluate(subRule, position, access, options)
        );
      case BlockRuleLogic.Not: {
        const [firstRule] = rule.rules;
        if (firstRule === undefined) {
          return true;
        }

        return !BlockRuleEvaluator.evaluate(firstRule, position, access, options);
      }
      default:
        return false;
    }
  }
}
