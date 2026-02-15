import {
  BlockRule as TSCoreBlockRule,
  BlockRuleEvaluator as TSCoreBlockRuleEvaluator,
  BlockRotation as TSCoreBlockRotation,
  BlockUtils as TSCoreBlockUtils,
} from "@voxelize/ts-core";

import { Block, BlockRotation, BlockRule } from "../core/world/block";
import { Coords3 } from "../types";

import { LightColor } from "./light-utils";

const toTSCoreRotation = (rotation: BlockRotation) => {
  return new TSCoreBlockRotation(rotation.value, rotation.yRotation);
};

const toTSCoreRule = (rule: BlockRule): TSCoreBlockRule => {
  if (rule.type === "none") {
    return { type: "none" };
  }

  if (rule.type === "simple") {
    let mappedRotation: TSCoreBlockRotation | undefined;
    if (rule.rotation !== undefined) {
      mappedRotation = toTSCoreRotation(rule.rotation);
    }

    return {
      type: "simple",
      offset: [...rule.offset],
      id: rule.id,
      stage: rule.stage,
      rotation: mappedRotation,
    };
  }

  return {
    type: "combination",
    logic: rule.logic,
    rules: rule.rules.map((nestedRule) => toTSCoreRule(nestedRule)),
  };
};

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
    return TSCoreBlockUtils.insertRotation(voxel, toTSCoreRotation(rotation));
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
    const mappedRule = toTSCoreRule(rule);
    const mappedOptions = {
      ...options,
      rotation:
        options.rotation === undefined
          ? undefined
          : toTSCoreRotation(options.rotation),
    };

    return TSCoreBlockRuleEvaluator.evaluate(
      mappedRule,
      voxel,
      {
        getVoxel: functions.getVoxelAt,
        getVoxelRotation: (x: number, y: number, z: number) => {
          return toTSCoreRotation(functions.getVoxelRotationAt(x, y, z));
        },
        getVoxelStage: functions.getVoxelStageAt,
      },
      mappedOptions
    );
  };

  static getBlockEntityId(id: string, voxel: Coords3) {
    const [vx, vy, vz] = voxel;
    return `block::${id}::${vx}::${vy}::${vz}`;
  }

  private constructor() {}
}
