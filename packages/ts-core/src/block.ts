import {
  ROTATION_MASK,
  STAGE_MASK,
  Y_ROTATION_MASK,
  assertStage,
  toUint32,
} from "./constants";
import { BlockRotation } from "./rotation";

export interface RotationLike {
  value: number;
  yRotation: number;
}

export interface VoxelFields {
  id: number;
  rotation: BlockRotation;
  stage: number;
}

export class BlockUtils {
  static extractId(voxel: number): number {
    return voxel & 0xffff;
  }

  static insertId(voxel: number, id: number): number {
    return toUint32((voxel & 0xffff0000) | (id & 0xffff));
  }

  static extractRotation(voxel: number): BlockRotation {
    const rotation = (voxel >>> 16) & 0xf;
    const yRotation = (voxel >>> 20) & 0xf;
    return BlockRotation.encode(rotation, yRotation);
  }

  static insertRotation(voxel: number, rotation: RotationLike): number {
    const [rotationValue, yRotation] = BlockRotation.decode(
      new BlockRotation(rotation.value, rotation.yRotation)
    );
    const value = (voxel & ROTATION_MASK) | ((rotationValue & 0xf) << 16);
    return toUint32((value & Y_ROTATION_MASK) | ((yRotation & 0xf) << 20));
  }

  static extractStage(voxel: number): number {
    return (voxel >>> 24) & 0xf;
  }

  static insertStage(voxel: number, stage: number): number {
    assertStage(stage);
    return toUint32((voxel & STAGE_MASK) | ((stage & 0xf) << 24));
  }

  static insertAll(
    id: number,
    rotation?: RotationLike,
    stage?: number
  ): number {
    let value = 0;
    value = BlockUtils.insertId(value, id);

    if (rotation !== undefined) {
      value = BlockUtils.insertRotation(value, rotation);
    }

    if (stage !== undefined) {
      value = BlockUtils.insertStage(value, stage);
    }

    return value;
  }

  static extractID(voxel: number): number {
    return BlockUtils.extractId(voxel);
  }

  static insertID(voxel: number, id: number): number {
    return BlockUtils.insertId(voxel, id);
  }
}

export class Voxel {
  static id(voxel: number): number {
    return BlockUtils.extractId(voxel);
  }

  static rotation(voxel: number): BlockRotation {
    return BlockUtils.extractRotation(voxel);
  }

  static stage(voxel: number): number {
    return BlockUtils.extractStage(voxel);
  }

  static withId(voxel: number, id: number): number {
    return BlockUtils.insertId(voxel, id);
  }

  static withRotation(voxel: number, rotation: RotationLike): number {
    return BlockUtils.insertRotation(voxel, rotation);
  }

  static withStage(voxel: number, stage: number): number {
    return BlockUtils.insertStage(voxel, stage);
  }

  static pack(fields: {
    id: number;
    rotation?: RotationLike;
    stage?: number;
  }): number {
    return BlockUtils.insertAll(fields.id, fields.rotation, fields.stage);
  }

  static unpack(voxel: number): VoxelFields {
    return {
      id: Voxel.id(voxel),
      rotation: Voxel.rotation(voxel),
      stage: Voxel.stage(voxel),
    };
  }
}
