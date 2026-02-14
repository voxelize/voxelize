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

export const createBlockFace = (init: BlockFaceInit): BlockFace =>
  new BlockFace(init);

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

export type BlockFaceInput = BlockFace | BlockFaceInit;
export type FaceTransparencyInput = readonly [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean
];

export interface BlockConditionalPartInput {
  rule?: BlockRule;
  faces?: readonly BlockFaceInput[];
  aabbs?: readonly AABB[];
  isTransparent?: FaceTransparencyInput;
  worldSpace?: boolean;
}

export interface BlockDynamicPatternInput {
  parts?: readonly BlockConditionalPartInput[];
}

const cloneBlockFace = (face: BlockFaceInput): BlockFace => {
  const corners:
    | [CornerData, CornerData, CornerData, CornerData]
    | undefined =
    face.corners === undefined
      ? undefined
      : [
          createCornerData(face.corners[0].pos, face.corners[0].uv),
          createCornerData(face.corners[1].pos, face.corners[1].uv),
          createCornerData(face.corners[2].pos, face.corners[2].uv),
          createCornerData(face.corners[3].pos, face.corners[3].uv),
        ];
  return new BlockFace({
    name: face.name,
    independent: face.independent,
    isolated: face.isolated,
    textureGroup: face.textureGroup,
    dir: face.dir === undefined ? undefined : [...face.dir],
    corners,
    range: face.range === undefined ? undefined : { ...face.range },
  });
};

const cloneBlockRule = (rule: BlockRule): BlockRule => {
  if (rule.type === "none") {
    return { type: "none" };
  }

  if (rule.type === "simple") {
    return {
      type: "simple",
      offset: [...rule.offset],
      id: rule.id,
      stage: rule.stage,
      rotation:
        rule.rotation === undefined || rule.rotation === null
          ? rule.rotation
          : new BlockRotation(rule.rotation.value, rule.rotation.yRotation),
    };
  }

  return {
    type: "combination",
    logic: rule.logic,
    rules: rule.rules.map((nestedRule) => cloneBlockRule(nestedRule)),
  };
};

export const createBlockConditionalPart = (
  part: BlockConditionalPartInput = {}
): BlockConditionalPart => {
  const normalizedPart =
    part !== null && typeof part === "object" && !Array.isArray(part)
      ? part
      : {};
  const faces = Array.isArray(normalizedPart.faces)
    ? normalizedPart.faces.map((face) => cloneBlockFace(face))
    : [];
  const aabbs = Array.isArray(normalizedPart.aabbs)
    ? normalizedPart.aabbs.map((aabb) => aabb.clone())
    : [];
  const isTransparent: FaceTransparency =
    normalizedPart.isTransparent === undefined
      ? [false, false, false, false, false, false]
      : [
          normalizedPart.isTransparent[0],
          normalizedPart.isTransparent[1],
          normalizedPart.isTransparent[2],
          normalizedPart.isTransparent[3],
          normalizedPart.isTransparent[4],
          normalizedPart.isTransparent[5],
        ];
  const rule =
    normalizedPart.rule === undefined
      ? cloneBlockRule(BLOCK_RULE_NONE)
      : cloneBlockRule(normalizedPart.rule);

  return {
    rule,
    faces,
    aabbs,
    isTransparent,
    worldSpace: normalizedPart.worldSpace ?? false,
  };
};

export const createBlockDynamicPattern = (
  pattern: BlockDynamicPatternInput = {}
): BlockDynamicPattern => {
  const normalizedPattern =
    pattern !== null && typeof pattern === "object" && !Array.isArray(pattern)
      ? pattern
      : {};
  const parts = Array.isArray(normalizedPattern.parts)
    ? normalizedPattern.parts.map((part) => createBlockConditionalPart(part))
    : [];

  return {
    parts,
  };
};
