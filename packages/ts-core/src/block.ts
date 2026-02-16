import {
  PY_ROTATION,
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

type NumericLikeValue = number | string | boolean | object | null | undefined;

const toFiniteNumberOrZero = (value: NumericLikeValue): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  try {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
  } catch {
    return 0;
  }
};

const toUint32WordOrZero = (value: NumericLikeValue): number => {
  return toFiniteNumberOrZero(value) >>> 0;
};

type RotationLikeRecord = {
  value?: number;
  yRotation?: number;
};

const toRotationLikeRecordOrNull = (
  rotation: RotationLike | null | undefined
): RotationLikeRecord | null => {
  return rotation !== null && typeof rotation === "object"
    ? (rotation as RotationLikeRecord)
    : null;
};

const safeReadRotationLikeField = (
  rotation: RotationLikeRecord | null,
  key: "value" | "yRotation",
  fallbackValue: number
): number => {
  if (rotation === null) {
    return fallbackValue;
  }

  try {
    const fieldValue = rotation[key];
    return typeof fieldValue === "number" ? fieldValue : fallbackValue;
  } catch {
    return fallbackValue;
  }
};

type VoxelPackFieldRecord = {
  id?: number;
  rotation?: RotationLike;
  stage?: number;
};

const toVoxelPackFieldRecordOrNull = (
  fields: { id: number; rotation?: RotationLike; stage?: number } | null | undefined
): VoxelPackFieldRecord | null => {
  return fields !== null && typeof fields === "object"
    ? (fields as VoxelPackFieldRecord)
    : null;
};

const safeReadVoxelPackId = (fields: VoxelPackFieldRecord | null): number => {
  if (fields === null) {
    return 0;
  }

  try {
    return fields.id ?? 0;
  } catch {
    return 0;
  }
};

const safeReadVoxelPackRotation = (
  fields: VoxelPackFieldRecord | null
): RotationLike | undefined => {
  if (fields === null) {
    return undefined;
  }

  try {
    return fields.rotation;
  } catch {
    return undefined;
  }
};

const safeReadVoxelPackStage = (
  fields: VoxelPackFieldRecord | null
): number | undefined => {
  if (fields === null) {
    return undefined;
  }

  try {
    return fields.stage;
  } catch {
    return undefined;
  }
};

export class BlockUtils {
  static extractId(voxel: number): number {
    return toUint32WordOrZero(voxel) & 0xffff;
  }

  static insertId(voxel: number, id: number): number {
    const voxelWord = toUint32WordOrZero(voxel);
    const normalizedId = toFiniteNumberOrZero(id);
    return toUint32((voxelWord & 0xffff0000) | (normalizedId & 0xffff));
  }

  static extractRotation(voxel: number): BlockRotation {
    const voxelWord = toUint32WordOrZero(voxel);
    const rotation = (voxelWord >>> 16) & 0xf;
    const yRotation = (voxelWord >>> 20) & 0xf;
    return BlockRotation.encode(rotation, yRotation);
  }

  static insertRotation(voxel: number, rotation: RotationLike): number {
    const voxelWord = toUint32WordOrZero(voxel);
    const normalizedRotation = toRotationLikeRecordOrNull(rotation);
    const normalizedRotationValue = safeReadRotationLikeField(
      normalizedRotation,
      "value",
      PY_ROTATION
    );
    const normalizedYRotation = safeReadRotationLikeField(
      normalizedRotation,
      "yRotation",
      0
    );
    const [rotationValue, yRotation] = BlockRotation.decode(
      new BlockRotation(normalizedRotationValue, normalizedYRotation)
    );
    const value = (voxelWord & ROTATION_MASK) | ((rotationValue & 0xf) << 16);
    return toUint32((value & Y_ROTATION_MASK) | ((yRotation & 0xf) << 20));
  }

  static extractStage(voxel: number): number {
    return (toUint32WordOrZero(voxel) >>> 24) & 0xf;
  }

  static insertStage(voxel: number, stage: number): number {
    assertStage(stage);
    const voxelWord = toUint32WordOrZero(voxel);
    return toUint32((voxelWord & STAGE_MASK) | ((stage & 0xf) << 24));
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
    const normalizedFields = toVoxelPackFieldRecordOrNull(fields);
    return BlockUtils.insertAll(
      safeReadVoxelPackId(normalizedFields),
      safeReadVoxelPackRotation(normalizedFields),
      safeReadVoxelPackStage(normalizedFields)
    );
  }

  static unpack(voxel: number): VoxelFields {
    return {
      id: Voxel.id(voxel),
      rotation: Voxel.rotation(voxel),
      stage: Voxel.stage(voxel),
    };
  }
}
