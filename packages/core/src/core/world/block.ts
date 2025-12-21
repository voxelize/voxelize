import { AABB } from "@voxelize/aabb";

import { Coords3 } from "../../types";

import { UV } from "./uv";

export type BlockSimpleRule = {
  offset: Coords3;
  id?: number;
  rotation?: BlockRotation;
  stage?: number;
};

export enum BlockRuleLogic {
  And = "and",
  Or = "or",
  Not = "not",
  // Add more logic types as needed
}

export type BlockRule =
  | { type: "none" }
  | ({ type: "simple" } & BlockSimpleRule)
  | { type: "combination"; logic: BlockRuleLogic; rules: BlockRule[] };

export interface BlockConditionalPart {
  rule: BlockRule;
  faces: Block["faces"];
  aabbs: Block["aabbs"];
  isTransparent: Block["isTransparent"];
  isPassable?: boolean;
  redLightLevel?: number;
  greenLightLevel?: number;
  blueLightLevel?: number;
}

export interface BlockDynamicPattern {
  parts: BlockConditionalPart[];
}

/**
 * A block type in the world. This is defined by the server.
 */
export type Block = {
  /**
   * The block id.
   */
  id: number;

  /**
   * The name of the block.
   */
  name: string;

  /**
   * The red light level of the block.
   */
  redLightLevel: number;

  /**
   * The green light level of the block.
   */
  greenLightLevel: number;

  /**
   * The blue light level of the block.
   */
  blueLightLevel: number;

  /**
   * Whether or not is the block rotatable.
   */
  rotatable: boolean;

  /**
   * Whether or not the block is rotatable around the y-axis (has to face either PX or NX).
   */
  yRotatable: boolean;

  yRotatableSegments: "All" | "Eight" | "Four";

  /**
   * Whether or not is this block empty. By default, only "air" is empty.
   */
  isEmpty: boolean;

  /**
   * Whether or not is the block a fluid block.
   */
  isFluid: boolean;

  /**
   * The force applied to entities in this fluid, pushing them in the flow direction.
   */
  fluidFlowForce: number;

  /**
   * Whether or not is the block waterlogged (exists inside water).
   */
  isWaterlogged: boolean;

  /**
   * Whether or not is this block a light source.
   */
  isLight: boolean;

  /**
   * Whether or not should physics ignore this block.
   */
  isPassable: boolean;

  /**
   * Whether or not can entities climb this block.
   */
  isClimbable: boolean;

  /**
   * Whether or not is this block opaque (not transparent).
   */
  isOpaque: boolean;

  /**
   * Whether or not is this block see-through (can be opaque and see-through at the same time).
   */
  isSeeThrough: boolean;

  /**
   * Whether or not is this block transparent viewing from all six sides. The sides
   * are defined as PX, PY, PZ, NX, NY, NZ.
   */
  isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean];

  transparentStandalone: boolean;

  /**
   * A list of block face data that this block has.
   */
  faces: {
    corners: { pos: [number, number, number]; uv: number[] }[];
    dir: [number, number, number];
    independent: boolean;
    isolated: boolean;
    textureGroup: string | null;
    range: UV;
    name: string;
  }[];

  /**
   * A list of axis-aligned bounding boxes that this block has.
   */
  aabbs: AABB[];

  /**
   * Whether or not should light reduce by 1 going through this block.
   */
  lightReduce: boolean;

  /**
   * Whether or not does the block generate dynamic faces or AABB's. If this is true, the block will use
   * `dynamicFn` to generate the faces and AABB's.
   */
  isDynamic: boolean;

  dynamicPatterns: BlockDynamicPattern[];

  /**
   * If this block is dynamic, this function will be called to generate the faces and AABB's. By default, this
   * just returns the faces and AABB's that are defined in the block data.
   *
   * @param pos The position of the block.
   * @param world The world instance.
   * @returns The dynamic faces and AABB's of the block.
   */
  dynamicFn: (pos: Coords3) => {
    faces: Block["faces"];
    aabbs: Block["aabbs"];
    isTransparent: Block["isTransparent"];
  };

  /**
   * A set of block face names that are independent (high resolution or animated). This is generated on the client side.
   */
  independentFaces: Set<string>;

  isolatedFaces: Set<string>;

  isEntity: boolean;
};

/**
 * A block update to make on the server.
 */
export type BlockUpdate = {
  /**
   * The voxel x-coordinate.
   */
  vx: number;

  /**
   * The voxel y-coordinate.
   */
  vy: number;

  /**
   * The voxel z-coordinate.
   */
  vz: number;

  /**
   * The voxel type.
   */
  type: number;

  /**
   * The optional rotation of the updated block.
   */
  rotation?: number;

  /**
   * The optional y-rotation of the updated block.
   */
  yRotation?: number;

  /**
   * The optional stage of the updated block.
   */
  stage?: number;
};

export type BlockUpdateWithSource = {
  update: BlockUpdate;
  source: "client" | "server";
};

/**
 * The numerical representation of the positive Y rotation.
 */
export const PY_ROTATION = 0;

/**
 * The numerical representation of the negative Y rotation.
 */
export const NY_ROTATION = 1;

/**
 * The numerical representation of the positive X rotation.
 */
export const PX_ROTATION = 2;

/**
 * The numerical representation of the negative X rotation.
 */
export const NX_ROTATION = 3;

/**
 * The numerical representation of the positive Z rotation.
 */
export const PZ_ROTATION = 4;

/**
 * The numerical representation of the negative Z rotation.
 */
export const NZ_ROTATION = 5;

/**
 * The amount of Y-rotation segments should be allowed for y-rotatable blocks. In other words,
 * the amount of times the block can be rotated around the y-axis within 360 degrees.
 *
 * The accepted Y-rotation values will be from `0` to `Y_ROTATION_SEGMENTS - 1`.
 */
export const Y_ROT_SEGMENTS = 16;

/**
 * A rotational map used to get the closest y-rotation representation to a y-rotation value.
 *
 * Rotation value -> index
 */
export const Y_ROT_MAP: [number, number][] = [];
export const Y_ROT_MAP_EIGHT: [number, number][] = [];
export const Y_ROT_MAP_FOUR: [number, number][] = [];

for (let i = 0; i < Y_ROT_SEGMENTS; i++) {
  const toPush: [number, number][] = [
    [(i / Y_ROT_SEGMENTS) * Math.PI * 2, i],
    [(i / Y_ROT_SEGMENTS) * Math.PI * 2 - Math.PI * 2, i],
  ];
  Y_ROT_MAP.push(...toPush);
  if (i % 2 === 0) {
    Y_ROT_MAP_EIGHT.push(...toPush);
  }
  if (i % 4 === 0) {
    Y_ROT_MAP_FOUR.push(...toPush);
  }
}

const PI = Math.PI;
const PI_2 = Math.PI / 2.0;

/**
 * A block rotation consists of two rotations: one is the axis this block is pointing towards,
 * and the other is the rotation around that axis (y-rotation). Y-rotation is only applicable
 * to the positive and negative x-axis.
 */
export class BlockRotation {
  /**
   * The axis this block is pointing towards.
   */
  public value: number;

  /**
   * The rotation around the axis this block is pointing towards, rounded to the nearest
   * (360 / 16) degrees.
   */
  public yRotation: number;

  /**
   * Create a new block rotation.
   *
   * @param value The axis this block is pointing towards.
   * @param yRotation The rotation around the axis this block is pointing towards, rounded to the nearest (360 / 16) degrees.
   */
  constructor(value = PY_ROTATION, yRotation = 0) {
    this.value = value;
    this.yRotation = yRotation;
  }

  /**
   * Encode two rotations into a new block rotation instance.
   *
   * @param value The axis this block is pointing towards.
   * @param yRotation The rotation around the axis this block is pointing towards.
   * @returns A new block rotation.
   */
  static encode = (value: number, yRotation = 0) => {
    const yEncoded = (yRotation * Math.PI * 2.0) / Y_ROT_SEGMENTS;
    return new BlockRotation(value, yEncoded);
  };

  /**
   * Decode a block rotation into two rotations.
   *
   * @param rotation The block rotation to decode.
   * @returns Two values, the first is the axis this block is pointing towards, and
   *   the second is the rotation around that axis.
   */
  static decode = (rotation: BlockRotation) => {
    const value = rotation.value;
    const yDecoded =
      Math.round((rotation.yRotation * Y_ROT_SEGMENTS) / (Math.PI * 2.0)) %
      Y_ROT_SEGMENTS;

    return [value, yDecoded];
  };

  /**
   * Rotate a 3D coordinate by this block rotation.
   *
   * @param node A 3D coordinate in the form of [x, y, z] to be rotated by this block rotation.
   * @param yRotate Whether or not should the y-rotation be applied.
   * @param translate Whether or not should the translation be applied.
   */
  public rotateNode = (node: Coords3, yRotate = true, translate = true) => {
    if (yRotate && this.yRotation !== 0) {
      node[0] -= 0.5;
      node[2] -= 0.5;
      BlockRotation.rotateY(node, this.yRotation);
      node[0] += 0.5;
      node[2] += 0.5;
    }

    switch (this.value) {
      case PX_ROTATION: {
        BlockRotation.rotateZ(node, -PI_2);
        if (translate) node[1] += 1;
        break;
      }
      case NX_ROTATION: {
        BlockRotation.rotateZ(node, PI_2);
        if (translate) node[0] += 1;
        break;
      }
      case PY_ROTATION: {
        break;
      }
      case NY_ROTATION: {
        BlockRotation.rotateX(node, PI);
        if (translate) {
          node[1] += 1;
          node[2] += 1;
        }
        break;
      }
      case PZ_ROTATION: {
        BlockRotation.rotateX(node, PI_2);
        if (translate) node[1] += 1;
        break;
      }
      case NZ_ROTATION: {
        BlockRotation.rotateX(node, -PI_2);
        if (translate) node[2] += 1;
        break;
      }
    }
  };

  /**
   * Rotate an axis aligned bounding box by this block rotation, recalculating the new
   * maximum and minimum coordinates to this AABB.
   *
   * @param aabb The axis aligned bounding box to be rotated.
   * @param yRotate Whether or not should the y-rotation be applied.
   * @param translate Whether or not should the translation be applied.
   * @returns A new axis aligned bounding box.
   */
  public rotateAABB = (aabb: AABB, yRotate = true, translate = true) => {
    if (this.value === PY_ROTATION && (this.yRotation === 0 || !yRotate)) {
      return aabb.clone();
    }

    const min = [aabb.minX, aabb.minY, aabb.minZ] as Coords3;
    const max = [aabb.maxX, aabb.maxY, aabb.maxZ] as Coords3;

    let minX = null;
    let minZ = null;
    let maxX = null;
    let maxZ = null;

    if (yRotate && this.yRotation !== 0) {
      const min1 = [aabb.minX, aabb.minY, aabb.minZ];
      const min2 = [aabb.minX, aabb.minY, aabb.maxZ];
      const min3 = [aabb.maxX, aabb.minY, aabb.minZ];
      const min4 = [aabb.maxX, aabb.minY, aabb.maxZ];

      [min1, min2, min3, min4].forEach((min) => {
        this.rotateNode(min as Coords3, true, true);
        minX = minX === null ? min[0] : Math.min(minX, min[0]);
        minZ = minZ === null ? min[2] : Math.min(minZ, min[2]);
      });

      const max1 = [aabb.minX, aabb.maxY, aabb.minZ];
      const max2 = [aabb.minX, aabb.maxY, aabb.maxZ];
      const max3 = [aabb.maxX, aabb.maxY, aabb.minZ];
      const max4 = [aabb.maxX, aabb.maxY, aabb.maxZ];

      [max1, max2, max3, max4].forEach((max) => {
        this.rotateNode(max as Coords3, true, true);
        maxX = maxX === null ? max[0] : Math.max(maxX, max[0]);
        maxZ = maxZ === null ? max[2] : Math.max(maxZ, max[2]);
      });
    }

    this.rotateNode(min, yRotate, translate);
    this.rotateNode(max, yRotate, translate);

    const EPSILON = 0.0001;
    const justify = (num: number) => (num < EPSILON ? 0 : num);

    min[0] = justify(min[0]);
    min[1] = justify(min[1]);
    min[2] = justify(min[2]);
    max[0] = justify(max[0]);
    max[1] = justify(max[1]);
    max[2] = justify(max[2]);

    const realMin = [
      minX !== null ? justify(minX) : Math.min(min[0], max[0]),
      Math.min(min[1], max[1]),
      minZ !== null ? justify(minZ) : Math.min(min[2], max[2]),
    ];

    const realMax = [
      maxX !== null ? justify(maxX) : Math.max(min[0], max[0]),
      Math.max(min[1], max[1]),
      maxZ !== null ? justify(maxZ) : Math.max(min[2], max[2]),
    ];

    return new AABB(
      realMin[0],
      realMin[1],
      realMin[2],
      realMax[0],
      realMax[1],
      realMax[2]
    );
  };

  public rotateTransparency([px, py, pz, nx, ny, nz]: [
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
    boolean
  ]) {
    const rot = this.value;

    if (Math.abs(rot) < Number.EPSILON) {
      return [px, py, pz, nx, ny, nz];
    }

    const positive = [1.0, 2.0, 3.0];
    const negative = [4.0, 5.0, 6.0];

    this.rotateNode(positive as Coords3, true, false);
    this.rotateNode(negative as Coords3, true, false);

    const p = positive.map((n) => {
      if (n === 1.0) return px;
      if (n === 2.0) return py;
      if (n === 3.0) return pz;
      if (n === 4.0) return nx;
      if (n === 5.0) return ny;
      return nz;
    });

    const n = negative.map((n) => {
      if (n === 1.0) return px;
      if (n === 2.0) return py;
      if (n === 3.0) return pz;
      if (n === 4.0) return nx;
      if (n === 5.0) return ny;
      return nz;
    });

    return [p[0], p[1], p[2], n[0], n[1], n[2]];
  }

  // Reference:
  // https://www.khanacademy.org/computer-programming/cube-rotated-around-x-y-and-z/4930679668473856

  /**
   * Rotate a 3D coordinate around the X axis.
   */
  private static rotateX = (node: Coords3, theta: number) => {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const [, y, z] = node;

    node[1] = y * cosTheta - z * sinTheta;
    node[2] = z * cosTheta + y * sinTheta;
  };

  /**
   * Rotate a 3D coordinate around the Y axis.
   */
  private static rotateY = (node: Coords3, theta: number) => {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const [x, , z] = node;

    node[0] = x * cosTheta + z * sinTheta;
    node[2] = z * cosTheta - x * sinTheta;
  };

  /**
   * Rotate a 3D coordinate around the Z axis.
   */
  private static rotateZ = (node: Coords3, theta: number) => {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const [x, y] = node;

    node[0] = x * cosTheta - y * sinTheta;
    node[1] = y * cosTheta + x * sinTheta;
  };
}
