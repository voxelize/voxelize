import { Block, BlockRotation } from "../core/world/block";

import { LightColor } from "./light-utils";

const ROTATION_MASK = 0xfff0ffff;
const Y_ROTATION_MASK = 0xff0fffff;
const STAGE_MASK = 0xf0ffffff;

/**
 * A utility class for extracting and inserting voxel data from and into numbers.
 *
 * The voxel data is stored in the following format:
 * - Voxel type: `0x0000ffff`
 * - Rotation: `0x000f0000`
 * - Y-rotation: `0x00f00000`
 * - Stage: `0xff000000`
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

  private constructor() {
    // NOTHING
  }
}
