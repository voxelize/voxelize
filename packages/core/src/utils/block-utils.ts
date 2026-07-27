import {
  Block,
  BlockRotation,
  BlockRule,
  BlockRuleLogic,
} from "../core/world/block";
import { Coords3 } from "../types";

import { LightColor } from "./light-utils";

const ROTATION_MASK = 0xfff0ffff;
const Y_ROTATION_MASK = 0xff0fffff;
const STAGE_MASK = 0xf0ffffff;
const WATERLOGGED_BIT = 1 << 28;
const WATERLOGGED_MASK = ~WATERLOGGED_BIT;
const WATERLOG_LEVEL_SHIFT = 29;
const WATERLOG_LEVEL_MASK = 0x7 << WATERLOG_LEVEL_SHIFT;

/**
 * A utility class for extracting and inserting voxel data from and into numbers.
 *
 * The voxel data is stored in the following format:
 * - Voxel type: `0x0000ffff`
 * - Rotation: `0x000f0000`
 * - Y-rotation: `0x00f00000`
 * - Stage: `0x0f000000`
 * - Waterlogged: `0x10000000`
 *
 * TODO-DOCS
 * For more information about voxel data, see [here](/)
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
    return voxel & 0xffff;
  };

  /**
   * Insert a voxel id into a number.
   *
   * @param voxel The voxel value to insert the id into.
   * @param id The voxel id to insert.
   * @returns The inserted voxel value.
   */
  static insertID = (voxel: number, id: number) => {
    return (voxel & 0xffff0000) | (id & 0xffff);
  };

  /**
   * Extract the voxel rotation from a number.
   *
   * @param voxel The voxel value to extract from.
   * @returns The extracted voxel rotation.
   */
  static extractRotation = (voxel: number) => {
    const rotation = (voxel >> 16) & 0xf;
    const yRot = (voxel >> 20) & 0xf;
    return BlockRotation.encode(rotation, yRot);
  };

  /**
   * Insert a voxel rotation into a number.
   *
   * @param voxel The voxel value to insert the rotation into.
   * @param rotation The voxel rotation to insert.
   * @returns The inserted voxel value.
   */
  static insertRotation = (voxel: number, rotation: BlockRotation) => {
    const [rot, yRot] = BlockRotation.decode(rotation);
    const value = (voxel & ROTATION_MASK) | ((rot & 0xf) << 16);
    return (value & Y_ROTATION_MASK) | ((yRot & 0xf) << 20);
  };

  /**
   * Extract the voxel stage from a number.
   *
   * @param voxel The voxel value to extract from.
   * @returns The extracted voxel stage.
   */
  static extractStage = (voxel: number) => {
    return (voxel >> 24) & 0xf;
  };

  /**
   * Insert a voxel stage into a number.
   *
   * @param voxel The voxel value to insert the stage into.
   * @param stage The voxel stage to insert.
   * @returns The inserted voxel value.
   */
  static insertStage = (voxel: number, stage: number) => {
    return (voxel & STAGE_MASK) | (stage << 24);
  };

  /**
   * Whether this voxel holds the world's waterlogging fluid alongside its
   * block. Mirrors `BlockUtils::extract_waterlogged` on the server.
   *
   * @param voxel The voxel value to extract from.
   */
  static extractWaterlogged = (voxel: number) => {
    return (voxel & WATERLOGGED_BIT) !== 0;
  };

  /**
   * Insert the waterlogged flag into a voxel value.
   *
   * @param voxel The voxel value to insert the flag into.
   * @param isWaterlogged Whether the voxel holds the waterlogging fluid.
   */
  static insertWaterlogged = (voxel: number, isWaterlogged: boolean) => {
    return isWaterlogged ? voxel | WATERLOGGED_BIT : voxel & WATERLOGGED_MASK;
  };

  /**
   * The level of fluid a waterlogged voxel holds, in the same 0-7 range as a
   * fluid block's stage.
   *
   * @param voxel The voxel value to extract from.
   */
  static extractWaterlogLevel = (voxel: number) => {
    return (voxel >>> WATERLOG_LEVEL_SHIFT) & 0x7;
  };

  /**
   * Insert the waterlogging fluid's level into a voxel value.
   *
   * The level occupies the top three bits, so the result is normalised back to
   * unsigned: JavaScript's bitwise operators work on signed 32-bit integers
   * and a level of 4 or more would otherwise come back negative.
   *
   * @param voxel The voxel value to insert the level into.
   * @param level The fluid level, 0 through 7.
   */
  static insertWaterlogLevel = (voxel: number, level: number) => {
    return (
      ((voxel & ~WATERLOG_LEVEL_MASK) |
        ((level & 0x7) << WATERLOG_LEVEL_SHIFT)) >>>
      0
    );
  };

  /**
   * The level of fluid standing in this voxel, wherever it is stored: a
   * waterlogged block keeps its water's level in its own field, a fluid block
   * keeps its own in `stage`. Mirrors `BlockUtils::extract_fluid_level`.
   *
   * @param voxel The voxel value to extract from.
   */
  static extractFluidLevel = (voxel: number) => {
    return BlockUtils.extractWaterlogged(voxel)
      ? BlockUtils.extractWaterlogLevel(voxel)
      : BlockUtils.extractStage(voxel);
  };

  static insertAll = (
    id: number,
    rotation?: BlockRotation,
    stage?: number,
    isWaterlogged?: boolean,
    waterlogLevel?: number,
  ) => {
    let value = 0;
    value = BlockUtils.insertID(value, id);
    if (rotation) value = BlockUtils.insertRotation(value, rotation);
    if (stage !== undefined) value = BlockUtils.insertStage(value, stage);
    if (isWaterlogged !== undefined)
      value = BlockUtils.insertWaterlogged(value, isWaterlogged);
    if (waterlogLevel !== undefined)
      value = BlockUtils.insertWaterlogLevel(value, waterlogLevel);
    return value;
  };

  static getBlockTorchLightLevel = (block: Block, color: LightColor) => {
    switch (color) {
      case "RED":
        return block.redLightLevel ?? 0;
      case "GREEN":
        return block.greenLightLevel ?? 0;
      case "BLUE":
        return block.blueLightLevel ?? 0;
    }

    return 0;
  };

  static getBlockTorchLightLevelAt = (
    block: Block,
    color: LightColor,
    voxel: Coords3,
    functions: {
      getVoxelAt: (x: number, y: number, z: number) => number;
      getVoxelRotationAt: (x: number, y: number, z: number) => BlockRotation;
      getVoxelStageAt: (x: number, y: number, z: number) => number;
    },
  ) => {
    if (block.dynamicPatterns?.length) {
      for (const pattern of block.dynamicPatterns) {
        for (const part of pattern.parts) {
          const isMatch = BlockUtils.evaluateBlockRule(
            part.rule,
            voxel,
            functions,
          );

          if (!isMatch) {
            continue;
          }

          switch (color) {
            case "RED":
              if (typeof part.redLightLevel === "number") {
                return part.redLightLevel;
              }
              break;
            case "GREEN":
              if (typeof part.greenLightLevel === "number") {
                return part.greenLightLevel;
              }
              break;
            case "BLUE":
              if (typeof part.blueLightLevel === "number") {
                return part.blueLightLevel;
              }
              break;
          }
        }
      }
    }

    return BlockUtils.getBlockTorchLightLevel(block, color);
  };

  static getBlockRotatedTransparency(
    block: Block | null | undefined,
    rotation: BlockRotation,
  ) {
    // Backstop for callers that resolved a block from an unloaded chunk or an
    // unknown id: treat it as fully opaque (light neither enters nor leaves)
    // instead of throwing, so lighting can never take down the page.
    if (!block) {
      if (!BlockUtils.hasWarnedMissingTransparencyBlock) {
        BlockUtils.hasWarnedMissingTransparencyBlock = true;
        console.warn(
          "[BlockUtils] getBlockRotatedTransparency received a missing block; treating as opaque.",
        );
      }
      return [false, false, false, false, false, false];
    }

    return rotation.rotateTransparency(block.isTransparent);
  }

  private static hasWarnedMissingTransparencyBlock = false;

  static evaluateBlockRule = (
    rule: BlockRule,
    voxel: Coords3,
    functions: {
      getVoxelAt: (x: number, y: number, z: number) => number;
      getVoxelRotationAt: (x: number, y: number, z: number) => BlockRotation;
      getVoxelStageAt: (x: number, y: number, z: number) => number;
    },
  ): boolean => {
    if (rule.type === "none") {
      return true;
    }

    if (rule.type === "simple") {
      const { offset, id, rotation, stage } = rule;
      const [vx, vy, vz] = voxel;
      const ox = offset[0] + vx;
      const oy = offset[1] + vy;
      const oz = offset[2] + vz;

      if (id !== null) {
        const voxelId = functions.getVoxelAt(ox, oy, oz);
        if (voxelId !== id) return false;
      }

      if (rotation !== null && rotation !== undefined) {
        // Rule rotations arrive f32-rounded from the server while voxel
        // rotations are computed in f64, so compare decoded segments rather
        // than raw radians.
        const expected = BlockRotation.fromServerRotation(rotation);
        const voxelRotation = functions.getVoxelRotationAt(ox, oy, oz);
        const [expectedValue, expectedSegment] = BlockRotation.decode(expected);
        const [actualValue, actualSegment] =
          BlockRotation.decode(voxelRotation);
        if (actualValue !== expectedValue || actualSegment !== expectedSegment)
          return false;
      }

      if (stage !== null) {
        const voxelStage = functions.getVoxelStageAt(ox, oy, oz);
        if (voxelStage !== stage) return false;
      }

      // If all conditions pass, return true
      return true;
    }

    if (rule.type === "combination") {
      const { logic, rules } = rule;

      switch (logic) {
        case BlockRuleLogic.And:
          return rules.every((subRule) =>
            BlockUtils.evaluateBlockRule(subRule, voxel, functions),
          );
        case BlockRuleLogic.Or:
          return rules.some((subRule) =>
            BlockUtils.evaluateBlockRule(subRule, voxel, functions),
          );
        case BlockRuleLogic.Not:
          return !rules.some((subRule) =>
            BlockUtils.evaluateBlockRule(subRule, voxel, functions),
          );
        default:
          return false; // Unsupported logic
      }
    }

    return false; // Default case for safety
  };

  static getBlockEntityId(id: string, voxel: Coords3) {
    const [vx, vy, vz] = voxel;
    return `block::${id}::${vx}::${vy}::${vz}`;
  }

  private constructor() {
    // NOTHING
  }
}
