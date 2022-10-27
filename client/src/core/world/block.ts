import { AABB } from "@voxelize/aabb";

import { Coords3 } from "../../types";

export type Block = {
  id: number;
  name: string;
  redLightLevel: number;
  greenLightLevel: number;
  blueLightLevel: number;
  rotatable: boolean;
  yRotatable: boolean;
  isBlock: boolean;
  isEmpty: boolean;
  isFluid: boolean;
  isLight: boolean;
  isPassable: boolean;
  isOpaque: boolean;
  isSeeThrough: boolean;
  isPxTransparent: boolean;
  isNxTransparent: boolean;
  isPyTransparent: boolean;
  isNyTransparent: boolean;
  isPzTransparent: boolean;
  isNzTransparent: boolean;
  transparentStandalone: boolean;
  faces: {
    corners: { pos: number[]; uv: number[] }[];
    dir: number[];
    name: string;
  }[];
  aabbs: AABB[];
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
};

export const PY_ROTATION = 0;
export const NY_ROTATION = 1;
export const PX_ROTATION = 2;
export const NX_ROTATION = 3;
export const PZ_ROTATION = 4;
export const NZ_ROTATION = 5;

export const Y_000_ROTATION = 0;
export const Y_045_ROTATION = 1;
export const Y_090_ROTATION = 2;
export const Y_135_ROTATION = 3;
export const Y_180_ROTATION = 4;
export const Y_225_ROTATION = 5;
export const Y_270_ROTATION = 6;
export const Y_315_ROTATION = 7;

export const Y_ROT_SEGMENTS = 16;

export const Y_ROT_MAP = [];

for (let i = 0; i < Y_ROT_SEGMENTS; i++) {
  Y_ROT_MAP.push([(i / Y_ROT_SEGMENTS) * Math.PI * 2, i]);
  Y_ROT_MAP.push([(i / Y_ROT_SEGMENTS) * Math.PI * 2 - Math.PI * 2, i]);
}

const PI = Math.PI;
const PI_2 = Math.PI / 2.0;

/**
 * 6 possible rotations: (px, nx, py, ny, pz, nz)
 * Default rotation is PY
 */
export class BlockRotation {
  static PX = 0;
  static NX = 1;
  static PY = 2;
  static NY = 3;
  static PZ = 4;
  static NZ = 5;

  constructor(public value: number, public yRotation: number) {}

  static encode = (value: number, yRotation = 0) => {
    const yEncoded = (yRotation * Math.PI * 2.0) / Y_ROT_SEGMENTS;

    switch (value) {
      case PX_ROTATION:
        return new BlockRotation(BlockRotation.PX, yEncoded);
      case NX_ROTATION:
        return new BlockRotation(BlockRotation.NX, yEncoded);
      case PY_ROTATION:
        return new BlockRotation(BlockRotation.PY, yEncoded);
      case NY_ROTATION:
        return new BlockRotation(BlockRotation.NY, yEncoded);
      case PZ_ROTATION:
        return new BlockRotation(BlockRotation.PZ, yEncoded);
      case NZ_ROTATION:
        return new BlockRotation(BlockRotation.NZ, yEncoded);
      default:
        throw new Error(`Unknown rotation: ${value}`);
    }
  };

  static decode = (rotation: BlockRotation) => {
    let value = 0;
    switch (rotation.value) {
      case BlockRotation.PX:
        value = PX_ROTATION;
        break;
      case BlockRotation.NX:
        value = NX_ROTATION;
        break;
      case BlockRotation.PY:
        value = PY_ROTATION;
        break;
      case BlockRotation.NY:
        value = NY_ROTATION;
        break;
      case BlockRotation.PZ:
        value = PZ_ROTATION;
        break;
      case BlockRotation.NZ:
        value = NZ_ROTATION;
        break;
    }

    const yDecoded =
      Math.round((rotation.yRotation * Y_ROT_SEGMENTS) / (Math.PI * 2.0)) %
      Y_ROT_SEGMENTS;

    return [value, yDecoded];
  };

  public rotateNode = (node: Coords3, yRotate = true, translate = true) => {
    if (yRotate && this.yRotation !== 0) {
      node[0] -= 0.5;
      node[2] -= 0.5;
      BlockRotation.rotateY(node, this.yRotation);
      node[0] += 0.5;
      node[2] += 0.5;
    }

    switch (this.value) {
      case BlockRotation.PX: {
        BlockRotation.rotateZ(node, -PI_2);
        if (translate) node[1] += 1;
        break;
      }
      case BlockRotation.NX: {
        BlockRotation.rotateZ(node, PI_2);
        if (translate) node[0] += 1;
        break;
      }
      case BlockRotation.PY: {
        break;
      }
      case BlockRotation.NY: {
        BlockRotation.rotateX(node, PI);
        if (translate) {
          node[1] += 1;
          node[2] += 1;
        }
        break;
      }
      case BlockRotation.PZ: {
        BlockRotation.rotateX(node, PI_2);
        if (translate) node[1] += 1;
        break;
      }
      case BlockRotation.NZ: {
        BlockRotation.rotateX(node, -PI_2);
        if (translate) node[2] += 1;
        break;
      }
    }
  };

  public rotateAABB = (aabb: AABB, yRotate = true, translate = true) => {
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
        this.rotateNode(min as Coords3, true, false);
        minX = minX === null ? min[0] : Math.min(minX, min[0]);
        minZ = minZ === null ? min[2] : Math.min(minZ, min[2]);
      });

      const max1 = [aabb.minX, aabb.maxY, aabb.minZ];
      const max2 = [aabb.minX, aabb.maxY, aabb.maxZ];
      const max3 = [aabb.maxX, aabb.maxY, aabb.minZ];
      const max4 = [aabb.maxX, aabb.maxY, aabb.maxZ];

      [max1, max2, max3, max4].forEach((max) => {
        this.rotateNode(max as Coords3, true, false);
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

  // Reference:
  // https://www.khanacademy.org/computer-programming/cube-rotated-around-x-y-and-z/4930679668473856

  private static rotateX = (node: Coords3, theta: number) => {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const [, y, z] = node;

    node[1] = y * cosTheta - z * sinTheta;
    node[2] = z * cosTheta + y * sinTheta;
  };

  private static rotateY = (node: Coords3, theta: number) => {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const [x, , z] = node;

    node[0] = x * cosTheta + z * sinTheta;
    node[2] = z * cosTheta - x * sinTheta;
  };

  private static rotateZ = (node: Coords3, theta: number) => {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    const [x, y] = node;

    node[0] = x * cosTheta - y * sinTheta;
    node[1] = y * cosTheta + x * sinTheta;
  };
}
