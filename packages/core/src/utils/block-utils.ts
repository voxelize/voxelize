import {
  BlockRotation as TSCoreBlockRotation,
  BlockUtils as TSCoreBlockUtils,
} from "@voxelize/ts-core";

import {
  Block,
  BlockRotation,
  BlockRule,
  BlockRuleLogic,
} from "../core/world/block";
import { Coords3 } from "../types";

import { LightColor } from "./light-utils";

/**
 * A utility class for extracting and inserting voxel data from and into numbers.
 *
 * The voxel data is stored in the following format:
 * - Voxel type: `0x0000ffff`
 * - Rotation: `0x000f0000`
 * - Y-rotation: `0x00f00000`
 * - Stage: `0x0f000000`
 *
 * # Example
 * ```ts
 * // Insert a voxel type 13 into zero.
 * const number = VoxelUtils.insertID(0, 13);
 * ```
 *
 * @category Utils
 */
export class BlockUtils {
  /**
   * Extract the voxel id from a number.
   *
   * @param voxel The voxel value to extract from.
   * @returns The extracted voxel id.
   */
  static extractID = (voxel: number) => {
    return TSCoreBlockUtils.extractID(voxel);
  };

  /**
   * Insert a voxel id into a number.
   *
   * @param voxel The voxel value to insert the id into.
   * @param id The voxel id to insert.
   * @returns The inserted voxel value.
   */
  static insertID = (voxel: number, id: number) => {
    return TSCoreBlockUtils.insertID(voxel, id);
  };

  /**
   * Extract the voxel rotation from a number.
   *
   * @param voxel The voxel value to extract from.
   * @returns The extracted voxel rotation.
   */
  static extractRotation = (voxel: number) => {
    const rotation = TSCoreBlockUtils.extractRotation(voxel);
    return new BlockRotation(rotation.value, rotation.yRotation);
  };

  /**
   * Insert a voxel rotation into a number.
   *
   * @param voxel The voxel value to insert the rotation into.
   * @param rotation The voxel rotation to insert.
   * @returns The inserted voxel value.
   */
  static insertRotation = (voxel: number, rotation: BlockRotation) => {
    return TSCoreBlockUtils.insertRotation(
      voxel,
      new TSCoreBlockRotation(rotation.value, rotation.yRotation)
    );
  };

  /**
   * Extract the voxel stage from a number.
   *
   * @param voxel The voxel value to extract from.
   * @returns The extracted voxel stage.
   */
  static extractStage = (voxel: number) => {
    return TSCoreBlockUtils.extractStage(voxel);
  };

  /**
   * Insert a voxel stage into a number.
   *
   * @param voxel The voxel value to insert the stage into.
   * @param stage The voxel stage to insert.
   * @returns The inserted voxel value.
   */
  static insertStage = (voxel: number, stage: number) => {
    return TSCoreBlockUtils.insertStage(voxel, stage);
  };

  static insertAll = (id: number, rotation?: BlockRotation, stage?: number) => {
    let value = 0;
    value = BlockUtils.insertID(value, id);
    if (rotation) value = BlockUtils.insertRotation(value, rotation);
    if (stage !== undefined) value = BlockUtils.insertStage(value, stage);
    return value;
  };

  static getBlockTorchLightLevel = (block: Block, color: LightColor) => {
    switch (color) {
      case "RED":
        return block.redLightLevel;
      case "GREEN":
        return block.greenLightLevel;
      case "BLUE":
        return block.blueLightLevel;
    }

    return 0;
  };

  static getBlockRotatedTransparency(block: Block, rotation: BlockRotation) {
    return rotation.rotateTransparency(block.isTransparent);
  }

  static evaluateBlockRule = (
    rule: BlockRule,
    voxel: Coords3,
    functions: {
      getVoxelAt: (x: number, y: number, z: number) => number;
      getVoxelRotationAt: (x: number, y: number, z: number) => BlockRotation;
      getVoxelStageAt: (x: number, y: number, z: number) => number;
    },
    options: {
      rotation?: BlockRotation;
      yRotatable?: boolean;
      worldSpace?: boolean;
    } = {}
  ): boolean => {
    const { yRotatable = false, worldSpace = false } = options;

    if (rule.type === "none") {
      return true;
    }

    if (rule.type === "simple") {
      const { offset, id, rotation: ruleRotation, stage } = rule;
      const [vx, vy, vz] = voxel;
      let [offsetX, offsetY, offsetZ] = offset;

      if (yRotatable && !worldSpace && options.rotation) {
        const rot = options.rotation.yRotation;
        if (Math.abs(rot) > Number.EPSILON) {
          const cosRot = Math.cos(rot);
          const sinRot = Math.sin(rot);
          const x = offsetX;
          const z = offsetZ;
          offsetX = x * cosRot - z * sinRot;
          offsetZ = x * sinRot + z * cosRot;
        }
      }

      const ox = Math.round(offsetX) + vx;
      const oy = Math.round(offsetY) + vy;
      const oz = Math.round(offsetZ) + vz;

      if (id != null) {
        const voxelId = functions.getVoxelAt(ox, oy, oz);
        if (voxelId !== id) return false;
      }

      if (ruleRotation != null) {
        const voxelRotation = functions.getVoxelRotationAt(ox, oy, oz);
        if (!voxelRotation.equals(ruleRotation))
          return false;
      }

      if (stage != null) {
        const voxelStage = functions.getVoxelStageAt(ox, oy, oz);
        if (voxelStage !== stage) return false;
      }

      return true;
    }

    if (rule.type === "combination") {
      const { logic, rules } = rule;

      switch (logic) {
        case BlockRuleLogic.And:
          return rules.every((subRule) =>
            BlockUtils.evaluateBlockRule(subRule, voxel, functions, options)
          );
        case BlockRuleLogic.Or:
          return rules.some((subRule) =>
            BlockUtils.evaluateBlockRule(subRule, voxel, functions, options)
          );
        case BlockRuleLogic.Not: {
          const [firstRule] = rules;
          return firstRule
            ? !BlockUtils.evaluateBlockRule(firstRule, voxel, functions, options)
            : true;
        }
        default:
          return false;
      }
    }

    return false;
  };

  static getBlockEntityId(id: string, voxel: Coords3) {
    const [vx, vy, vz] = voxel;
    return `block::${id}::${vx}::${vy}::${vz}`;
  }

  private constructor() {
    // NOTHING
  }
}
