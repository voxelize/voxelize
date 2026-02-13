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

export const createBlockConditionalPart = (
  part: Partial<BlockConditionalPart>
): BlockConditionalPart => ({
  rule: part.rule ?? BLOCK_RULE_NONE,
  faces: part.faces ?? [],
  aabbs: part.aabbs ?? [],
  isTransparent: part.isTransparent ?? [false, false, false, false, false, false],
  worldSpace: part.worldSpace ?? false,
});
