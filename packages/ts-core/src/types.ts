import { AABB } from "./aabb";
import { BlockRotation } from "./rotation";
import { FaceTransparency, Vec2, Vec3 } from "./vectors";

export interface UV {
  startU: number;
  endU: number;
  startV: number;
  endV: number;
}

export const createUV = (
  startU = 0,
  endU = 0,
  startV = 0,
  endV = 0
): UV => ({
  startU,
  endU,
  startV,
  endV,
});

export interface CornerData {
  pos: Vec3;
  uv: Vec2;
}

export const createCornerData = (pos: Vec3, uv: Vec2): CornerData => ({
  pos: [...pos],
  uv: [...uv],
});

const createDefaultCorner = (): CornerData => ({
  pos: [0, 0, 0],
  uv: [0, 0],
});

const createDefaultCorners = (): [
  CornerData,
  CornerData,
  CornerData,
  CornerData,
] => [
  createDefaultCorner(),
  createDefaultCorner(),
  createDefaultCorner(),
  createDefaultCorner(),
];

export interface BlockFaceInit {
  name: string;
  independent?: boolean;
  isolated?: boolean;
  textureGroup?: string | null;
  dir?: Vec3;
  corners?: [CornerData, CornerData, CornerData, CornerData];
  range?: UV;
}

export class BlockFace {
  public name: string;
  public nameLower: string;
  public independent: boolean;
  public isolated: boolean;
  public textureGroup: string | null;
  public dir: Vec3;
  public corners: [CornerData, CornerData, CornerData, CornerData];
  public range: UV;

  constructor({
    name,
    independent = false,
    isolated = false,
    textureGroup = null,
    dir = [0, 0, 0],
    corners = createDefaultCorners(),
    range = createUV(),
  }: BlockFaceInit) {
    this.name = name;
    this.nameLower = name.toLowerCase();
    this.independent = independent;
    this.isolated = isolated;
    this.textureGroup = textureGroup;
    this.dir = [...dir];
    this.corners = corners.map((corner) => createCornerData(corner.pos, corner.uv)) as [
      CornerData,
      CornerData,
      CornerData,
      CornerData,
    ];
    this.range = { ...range };
  }

  computeNameLower(): void {
    this.nameLower = this.name.toLowerCase();
  }

  getNameLower(): string {
    if (this.nameLower.length === 0) {
      return this.name;
    }

    return this.nameLower;
  }
}

const DEFAULT_BLOCK_FACE_INIT: BlockFaceInit = {
  name: "Face",
};

export const createBlockFace = (
  init: BlockFaceInput | null | undefined = DEFAULT_BLOCK_FACE_INIT
): BlockFace => {
  if (init === null || init === undefined) {
    return new BlockFace(DEFAULT_BLOCK_FACE_INIT);
  }

  const normalizedFace = toBlockFaceInit(init);
  return new BlockFace(normalizedFace ?? DEFAULT_BLOCK_FACE_INIT);
};

export type OptionalRuleValue<T> = T | null | undefined;

export type BlockSimpleRule = {
  offset: Vec3;
  id?: OptionalRuleValue<number>;
  rotation?: OptionalRuleValue<BlockRotation>;
  stage?: OptionalRuleValue<number>;
};

export enum BlockRuleLogic {
  And = "and",
  Or = "or",
  Not = "not",
}

export type BlockRule =
  | { type: "none" }
  | ({ type: "simple" } & BlockSimpleRule)
  | { type: "combination"; logic: BlockRuleLogic; rules: BlockRule[] };

export interface BlockRotationInput {
  readonly value: number;
  readonly yRotation: number;
}

export type BlockSimpleRuleInput = {
  type: "simple";
  offset: readonly [number, number, number];
  id?: OptionalRuleValue<number>;
  rotation?: OptionalRuleValue<BlockRotation | BlockRotationInput>;
  stage?: OptionalRuleValue<number>;
};

export type BlockRuleInput =
  | { type: "none" }
  | BlockSimpleRuleInput
  | {
      type: "combination";
      logic: BlockRuleLogic;
      rules: readonly (BlockRuleInput | null | undefined)[];
    };

export const BLOCK_RULE_NONE: BlockRule = { type: "none" };

export interface BlockConditionalPart {
  rule: BlockRule;
  faces: BlockFace[];
  aabbs: AABB[];
  isTransparent: FaceTransparency;
  worldSpace: boolean;
}

export interface BlockDynamicPattern {
  parts: BlockConditionalPart[];
}

export interface AABBInit {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export type BlockFaceInput = BlockFace | BlockFaceInit;
export type AABBInput = AABB | AABBInit;
export type FaceTransparencyInput = readonly [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
];
export type FaceTransparencyLike =
  | FaceTransparencyInput
  | readonly (boolean | null | undefined)[]
  | null;

export interface BlockConditionalPartInput {
  rule?: BlockRuleInput | null;
  faces?: readonly (BlockFaceInput | null | undefined)[];
  aabbs?: readonly (AABBInput | null | undefined)[];
  isTransparent?: FaceTransparencyLike;
  worldSpace?: boolean | null;
}

export interface BlockDynamicPatternInput {
  parts?: readonly (BlockConditionalPartInput | null | undefined)[];
}

type DynamicValue =
  | object
  | string
  | number
  | boolean
  | null
  | undefined;

const isFiniteNumberValue = (value: DynamicValue): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const isNonNegativeIntegerValue = (value: DynamicValue): value is number => {
  return isFiniteNumberValue(value) && Number.isInteger(value) && value >= 0;
};

const isRotationValue = (value: DynamicValue): value is number => {
  return isNonNegativeIntegerValue(value) && value <= 0x0f;
};

const isBooleanValue = (value: DynamicValue): value is boolean => {
  return typeof value === "boolean";
};

const hasPlainObjectPrototype = (value: object): boolean => {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
};

const isPlainObjectValue = (
  value: DynamicValue
): value is Record<string, DynamicValue> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return hasPlainObjectPrototype(value);
};

const isBlockRotationInstance = (
  value: DynamicValue
): value is BlockRotation => {
  try {
    return value instanceof BlockRotation;
  } catch {
    return false;
  }
};

const isBlockFaceInstance = (value: DynamicValue): value is BlockFace => {
  try {
    return value instanceof BlockFace;
  } catch {
    return false;
  }
};

const isAabbInstance = (value: DynamicValue): value is AABB => {
  try {
    return value instanceof AABB;
  } catch {
    return false;
  }
};

export const createFaceTransparency = (
  value: FaceTransparencyLike = null
): FaceTransparency => {
  if (!Array.isArray(value)) {
    return [false, false, false, false, false, false];
  }

  return [
    isBooleanValue(value[0]) ? value[0] : false,
    isBooleanValue(value[1]) ? value[1] : false,
    isBooleanValue(value[2]) ? value[2] : false,
    isBooleanValue(value[3]) ? value[3] : false,
    isBooleanValue(value[4]) ? value[4] : false,
    isBooleanValue(value[5]) ? value[5] : false,
  ];
};

const isVec2Value = (value: DynamicValue): value is Vec2 => {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumberValue(value[0]) &&
    isFiniteNumberValue(value[1])
  );
};

const isVec3Value = (value: DynamicValue): value is Vec3 => {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    isFiniteNumberValue(value[0]) &&
    isFiniteNumberValue(value[1]) &&
    isFiniteNumberValue(value[2])
  );
};

const isUvValue = (value: DynamicValue): value is UV => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const maybeUv = value as {
    startU?: DynamicValue;
    endU?: DynamicValue;
    startV?: DynamicValue;
    endV?: DynamicValue;
  };
  return (
    isFiniteNumberValue(maybeUv.startU) &&
    isFiniteNumberValue(maybeUv.endU) &&
    isFiniteNumberValue(maybeUv.startV) &&
    isFiniteNumberValue(maybeUv.endV)
  );
};

const isCornerDataValue = (value: DynamicValue): value is CornerData => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const maybeCorner = value as {
    pos?: DynamicValue;
    uv?: DynamicValue;
  };
  return isVec3Value(maybeCorner.pos) && isVec2Value(maybeCorner.uv);
};

const toCornerTuple = (
  value: DynamicValue
): [CornerData, CornerData, CornerData, CornerData] | undefined => {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }

  if (
    !isCornerDataValue(value[0]) ||
    !isCornerDataValue(value[1]) ||
    !isCornerDataValue(value[2]) ||
    !isCornerDataValue(value[3])
  ) {
    return undefined;
  }

  return [
    createCornerData(value[0].pos, value[0].uv),
    createCornerData(value[1].pos, value[1].uv),
    createCornerData(value[2].pos, value[2].uv),
    createCornerData(value[3].pos, value[3].uv),
  ];
};

const toOptionalRuleNumber = (
  value: DynamicValue,
  maximum: number
): number | undefined => {
  return isNonNegativeIntegerValue(value) && value <= maximum
    ? value
    : undefined;
};

const toBlockRotation = (value: DynamicValue): BlockRotation | null => {
  if (isBlockRotationInstance(value)) {
    if (!isRotationValue(value.value) || !isFiniteNumberValue(value.yRotation)) {
      return null;
    }

    return new BlockRotation(value.value, value.yRotation);
  }

  if (!isPlainObjectValue(value)) {
    return null;
  }

  const maybeRotation = value as {
    value?: DynamicValue;
    yRotation?: DynamicValue;
  };
  if (
    !isRotationValue(maybeRotation.value) ||
    !isFiniteNumberValue(maybeRotation.yRotation)
  ) {
    return null;
  }

  return new BlockRotation(maybeRotation.value, maybeRotation.yRotation);
};

export const createBlockRotation = (
  rotation: BlockRotation | BlockRotationInput | null | undefined = BlockRotation.py(0)
): BlockRotation => {
  return toBlockRotation(rotation) ?? BlockRotation.py(0);
};

const toOptionalRuleRotation = (
  value: DynamicValue
): BlockRotation | undefined => {
  return toBlockRotation(value) ?? undefined;
};

const toBlockRule = (
  value: DynamicValue,
  path: Set<object> = new Set<object>()
): BlockRule => {
  if (!isPlainObjectValue(value)) {
    return { type: "none" };
  }
  if (path.has(value)) {
    return { type: "none" };
  }

  path.add(value);
  try {
    const maybeRule = value as {
      type?: DynamicValue;
      logic?: DynamicValue;
      rules?: DynamicValue;
      offset?: DynamicValue;
      id?: DynamicValue;
      rotation?: DynamicValue;
      stage?: DynamicValue;
    };
    if (maybeRule.type === "none") {
      return { type: "none" };
    }

    if (maybeRule.type === "simple") {
      if (!isVec3Value(maybeRule.offset)) {
        return { type: "none" };
      }

      const simpleRule: { type: "simple" } & BlockSimpleRule = {
        type: "simple",
        offset: [...maybeRule.offset],
      };
      const id = toOptionalRuleNumber(maybeRule.id, 0xffff);
      if (id !== undefined) {
        simpleRule.id = id;
      }
      const stage = toOptionalRuleNumber(maybeRule.stage, 0x0f);
      if (stage !== undefined) {
        simpleRule.stage = stage;
      }
      const rotation = toOptionalRuleRotation(maybeRule.rotation);
      if (rotation !== undefined) {
        simpleRule.rotation = rotation;
      }

      return simpleRule;
    }

    if (maybeRule.type === "combination") {
      const logic =
        maybeRule.logic === BlockRuleLogic.And ||
        maybeRule.logic === BlockRuleLogic.Or ||
        maybeRule.logic === BlockRuleLogic.Not
          ? maybeRule.logic
          : null;
      if (logic === null || !Array.isArray(maybeRule.rules)) {
        return { type: "none" };
      }

      return {
        type: "combination",
        logic,
        rules: maybeRule.rules.map((nestedRule) => toBlockRule(nestedRule, path)),
      };
    }

    return { type: "none" };
  } finally {
    path.delete(value);
  }
};

export const createBlockRule = (
  rule: BlockRuleInput | null | undefined = BLOCK_RULE_NONE
): BlockRule => {
  return toBlockRule(rule);
};

const toBlockFaceInit = (face: BlockFaceInput): BlockFaceInit | null => {
  const maybeFace: {
    name?: DynamicValue;
    independent?: DynamicValue;
    isolated?: DynamicValue;
    textureGroup?: DynamicValue;
    dir?: DynamicValue;
    corners?: DynamicValue;
    range?: DynamicValue;
  } | null = isBlockFaceInstance(face)
    ? {
        name: face.name,
        independent: face.independent,
        isolated: face.isolated,
        textureGroup: face.textureGroup,
        dir: face.dir,
        corners: face.corners,
        range: face.range,
      }
    : isPlainObjectValue(face)
      ? face
      : null;
  if (maybeFace === null) {
    return null;
  }

  if (typeof maybeFace.name !== "string") {
    return null;
  }

  const textureGroup =
    maybeFace.textureGroup === undefined ||
    maybeFace.textureGroup === null ||
    typeof maybeFace.textureGroup === "string"
      ? maybeFace.textureGroup
      : undefined;

  return {
    name: maybeFace.name,
    independent:
      typeof maybeFace.independent === "boolean"
        ? maybeFace.independent
        : undefined,
    isolated:
      typeof maybeFace.isolated === "boolean" ? maybeFace.isolated : undefined,
    textureGroup,
    dir: isVec3Value(maybeFace.dir) ? [...maybeFace.dir] : undefined,
    corners: toCornerTuple(maybeFace.corners),
    range: isUvValue(maybeFace.range)
      ? {
          startU: maybeFace.range.startU,
          endU: maybeFace.range.endU,
          startV: maybeFace.range.startV,
          endV: maybeFace.range.endV,
        }
      : undefined,
  };
};

const cloneBlockFace = (
  face: BlockFaceInput | null | undefined
): BlockFace | null => {
  if (face === null || face === undefined) {
    return null;
  }

  const faceInit = toBlockFaceInit(face);
  if (faceInit === null) {
    return null;
  }

  return new BlockFace(faceInit);
};

type AabbLikeValue = {
  minX?: DynamicValue;
  minY?: DynamicValue;
  minZ?: DynamicValue;
  maxX?: DynamicValue;
  maxY?: DynamicValue;
  maxZ?: DynamicValue;
};

const toFiniteAabbInit = (aabb: AabbLikeValue): AABBInit | null => {
  if (
    !isFiniteNumberValue(aabb.minX) ||
    !isFiniteNumberValue(aabb.minY) ||
    !isFiniteNumberValue(aabb.minZ) ||
    !isFiniteNumberValue(aabb.maxX) ||
    !isFiniteNumberValue(aabb.maxY) ||
    !isFiniteNumberValue(aabb.maxZ)
  ) {
    return null;
  }

  return {
    minX: aabb.minX,
    minY: aabb.minY,
    minZ: aabb.minZ,
    maxX: aabb.maxX,
    maxY: aabb.maxY,
    maxZ: aabb.maxZ,
  };
};

const cloneAabb = (aabb: AABBInput | null | undefined): AABB | null => {
  if (isAabbInstance(aabb)) {
    const finiteAabb = toFiniteAabbInit(aabb);
    if (finiteAabb === null) {
      return null;
    }

    return AABB.create(
      finiteAabb.minX,
      finiteAabb.minY,
      finiteAabb.minZ,
      finiteAabb.maxX,
      finiteAabb.maxY,
      finiteAabb.maxZ
    );
  }

  if (!isPlainObjectValue(aabb)) {
    return null;
  }

  const finiteAabb = toFiniteAabbInit(aabb);
  if (finiteAabb === null) {
    return null;
  }

  return AABB.create(
    finiteAabb.minX,
    finiteAabb.minY,
    finiteAabb.minZ,
    finiteAabb.maxX,
    finiteAabb.maxY,
    finiteAabb.maxZ
  );
};

export const createAABB = (aabb: AABBInput | null | undefined = null): AABB => {
  const clonedAabb = cloneAabb(aabb);
  return clonedAabb ?? AABB.empty();
};

export const createBlockConditionalPart = (
  part: BlockConditionalPartInput | null = {}
): BlockConditionalPart => {
  const normalizedPart: BlockConditionalPartInput = isPlainObjectValue(part)
    ? part
    : {};
  const faces = Array.isArray(normalizedPart.faces)
    ? normalizedPart.faces.reduce<BlockFace[]>((clonedFaces, face) => {
        const clonedFace = cloneBlockFace(face);
        if (clonedFace !== null) {
          clonedFaces.push(clonedFace);
        }

        return clonedFaces;
      }, [])
    : [];
  const aabbs = Array.isArray(normalizedPart.aabbs)
    ? normalizedPart.aabbs.reduce<AABB[]>((clonedAabbs, aabb) => {
        const clonedAabb = cloneAabb(aabb);
        if (clonedAabb !== null) {
          clonedAabbs.push(clonedAabb);
        }

        return clonedAabbs;
      }, [])
    : [];
  const isTransparent = createFaceTransparency(normalizedPart.isTransparent);
  const rule = createBlockRule(normalizedPart.rule);

  return {
    rule,
    faces,
    aabbs,
    isTransparent,
    worldSpace: isBooleanValue(normalizedPart.worldSpace)
      ? normalizedPart.worldSpace
      : false,
  };
};

export const createBlockDynamicPattern = (
  pattern: BlockDynamicPatternInput | null = {}
): BlockDynamicPattern => {
  const normalizedPattern: BlockDynamicPatternInput = isPlainObjectValue(pattern)
    ? pattern
    : {};
  const parts = Array.isArray(normalizedPattern.parts)
    ? normalizedPattern.parts.reduce<BlockConditionalPart[]>((clonedParts, part) => {
        if (isPlainObjectValue(part)) {
          clonedParts.push(createBlockConditionalPart(part));
        }

        return clonedParts;
      }, [])
    : [];

  return {
    parts,
  };
};
