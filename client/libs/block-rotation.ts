import { AABB } from "@voxelize/aabb";

import { Coords3 } from "../types";

const PY_ROTATION = 0;
const NY_ROTATION = 1;
const PX_ROTATION = 2;
const NX_ROTATION = 3;
const PZ_ROTATION = 4;
const NZ_ROTATION = 5;

const Y_000_ROTATION = 0;
const Y_045_ROTATION = 1;
const Y_090_ROTATION = 2;
const Y_135_ROTATION = 3;
const Y_180_ROTATION = 4;
const Y_225_ROTATION = 5;
const Y_270_ROTATION = 6;
const Y_315_ROTATION = 7;

const PI = Math.PI;
const PI_2 = Math.PI / 2.0;

/**
 * 6 possible rotations: (px, nx, py, ny, pz, nz)
 * Default rotation is PY
 */
class BlockRotation {
  static PX = 0;
  static NX = 1;
  static PY = 2;
  static NY = 3;
  static PZ = 4;
  static NZ = 5;

  constructor(public value: number, public yRotation: number) {}

  static encode = (value: number, yRotation: number) => {
    let yEncoded = 0;
    switch (yRotation) {
      case Y_000_ROTATION:
        yEncoded = 0;
        break;
      case Y_045_ROTATION:
        yEncoded = 45;
        break;
      case Y_090_ROTATION:
        yEncoded = 90;
        break;
      case Y_135_ROTATION:
        yEncoded = 135;
        break;
      case Y_180_ROTATION:
        yEncoded = 180;
        break;
      case Y_225_ROTATION:
        yEncoded = 225;
        break;
      case Y_270_ROTATION:
        yEncoded = 270;
        break;
      case Y_315_ROTATION:
        yEncoded = 315;
        break;
      default:
        throw new Error(`Unknown y-rotation: ${yRotation}`);
    }

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

    let yDecoded = 0;
    switch (rotation.yRotation) {
      case 0:
        yDecoded = Y_000_ROTATION;
        break;
      case 45:
        yDecoded = Y_045_ROTATION;
        break;
      case 90:
        yDecoded = Y_090_ROTATION;
        break;
      case 135:
        yDecoded = Y_135_ROTATION;
        break;
      case 180:
        yDecoded = Y_180_ROTATION;
        break;
      case 225:
        yDecoded = Y_225_ROTATION;
        break;
      case 270:
        yDecoded = Y_270_ROTATION;
        break;
      case 315:
        yDecoded = Y_315_ROTATION;
        break;
    }

    return [value, yDecoded];
  };

  public rotateNode = (node: Coords3, translate = true) => {
    switch (this.value) {
      case BlockRotation.PX: {
        if (this.yRotation !== 0) {
          BlockRotation.rotateY(node, this.yRotation);
        }

        BlockRotation.rotateZ(node, -PI_2);
        if (translate) node[1] += 1;
        break;
      }
      case BlockRotation.NX: {
        if (this.yRotation !== 0) {
          BlockRotation.rotateY(node, this.yRotation);
        }

        BlockRotation.rotateZ(node, PI_2);
        if (translate) node[0] += 1;
        break;
      }
      case BlockRotation.PY: {
        if (this.yRotation !== 0) {
          BlockRotation.rotateY(node, this.yRotation);
        }

        break;
      }
      case BlockRotation.NY: {
        if (this.yRotation !== 0) {
          BlockRotation.rotateY(node, this.yRotation);
        }

        BlockRotation.rotateX(node, PI);
        if (translate) {
          node[1] += 1;
          node[2] += 1;
        }
        break;
      }
      case BlockRotation.PZ: {
        if (this.yRotation !== 0) {
          BlockRotation.rotateY(node, this.yRotation);
        }

        BlockRotation.rotateX(node, PI_2);
        if (translate) node[1] += 1;
        break;
      }
      case BlockRotation.NZ: {
        if (this.yRotation !== 0) {
          BlockRotation.rotateY(node, this.yRotation);
        }

        BlockRotation.rotateX(node, -PI_2);
        if (translate) node[2] += 1;
        break;
      }
    }
  };

  public rotateAABB = (aabb: AABB, translate = true) => {
    const min = [aabb.minX, aabb.minY, aabb.minZ] as Coords3;
    const max = [aabb.maxX, aabb.maxY, aabb.maxZ] as Coords3;

    this.rotateNode(min, translate);
    this.rotateNode(max, translate);

    const EPSILON = 0.0001;
    const justify = (num: number) => (num < EPSILON ? 0 : num);

    min[0] = justify(min[0]);
    min[1] = justify(min[1]);
    min[2] = justify(min[2]);
    max[0] = justify(max[0]);
    max[1] = justify(max[1]);
    max[2] = justify(max[2]);

    const realMin = [
      Math.min(min[0], max[0]),
      Math.min(min[1], max[1]),
      Math.min(min[2], max[2]),
    ];

    const realMax = [
      Math.max(min[0], max[0]),
      Math.max(min[1], max[1]),
      Math.max(min[2], max[2]),
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

export { BlockRotation };
