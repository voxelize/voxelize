import { BlockRotation } from "../libs/block-rotation";

const ROTATION_MASK = 0xfff0ffff;
const STAGE_MASK = 0x000fffff;

/**
 * Utility class to extract voxel data from a single number
 *
 * Bit lineup as such (from right to left):
 * - `1 - 16 bits`: ID (0x0000FFFF)
 * - `17 - 20 bit`: rotation (0x000F0000)
 * - `21 - 32 bit`: stage (0xFFF00000)
 */
class BlockUtils {
  static extractID = (voxel: number) => {
    return voxel & 0xffff;
  };

  static insertId = (voxel: number, id: number) => {
    return (voxel & 0xffff0000) | (id & 0xffff);
  };

  static extractRotation = (voxel: number) => {
    const rotation = (voxel >> 16) & 0xf;
    return BlockRotation.encode(rotation);
  };

  static insertRotation = (voxel: number, rotation: number) => {
    const rot = BlockRotation.decode(rotation);
    return (voxel & ROTATION_MASK) | ((rot & 0xf) << 16);
  };

  static extractStage = (voxel: number) => {
    return (voxel >> 20) & 0xf;
  };

  static insertStage = (voxel: number, stage: number) => {
    return (voxel & STAGE_MASK) | (stage << 20);
  };
}

export { BlockUtils };
