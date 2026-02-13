import { VoxelAccess } from "./access";
import { BlockRotation } from "./rotation";
import { BlockRule, BlockRuleLogic } from "./types";
import { Vec3 } from "./vectors";

const rotateOffsetY = (offset: Vec3, rotation: BlockRotation): Vec3 => {
  const rot = rotation.yRotation;

  if (Math.abs(rot) <= Number.EPSILON) {
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
    const {
      rotation = BlockRotation.py(0),
      yRotatable = false,
      worldSpace = false,
    } = options;

    if (rule.type === "none") {
      return true;
    }

    if (rule.type === "simple") {
      let offset: Vec3 = [...rule.offset];

      if (yRotatable && !worldSpace) {
        offset = rotateOffsetY(offset, rotation);
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
