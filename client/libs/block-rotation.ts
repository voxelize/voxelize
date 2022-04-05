import { Coords3 } from "../types";

const PY_ROTATION = 0;
const NY_ROTATION = 1;
const PX_ROTATION = 2;
const NX_ROTATION = 3;
const PZ_ROTATION = 4;
const NZ_ROTATION = 5;

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

  static encode = (value: number) => {
    switch (value) {
      case PX_ROTATION:
        return BlockRotation.PX;
      case NX_ROTATION:
        return BlockRotation.NX;
      case PY_ROTATION:
        return BlockRotation.PY;
      case NY_ROTATION:
        return BlockRotation.NY;
      case PZ_ROTATION:
        return BlockRotation.PZ;
      case NZ_ROTATION:
        return BlockRotation.NZ;
      default:
        throw new Error(`Unknown rotation: ${value}`);
    }
  };

  static decode = (rotation: number) => {
    switch (rotation) {
      case BlockRotation.PX:
        return PX_ROTATION;
      case BlockRotation.NX:
        return NX_ROTATION;
      case BlockRotation.PY:
        return PY_ROTATION;
      case BlockRotation.NY:
        return NY_ROTATION;
      case BlockRotation.PZ:
        return PZ_ROTATION;
      case BlockRotation.NZ:
        return NZ_ROTATION;
    }
  };

  static rotate = (rotation: number, node: Coords3, translate: boolean) => {
    switch (rotation) {
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

  public static rotateInv = (
    rotation: number,
    node: Coords3,
    translate: boolean
  ) => {
    switch (rotation) {
      case BlockRotation.PX: {
        BlockRotation.rotate(BlockRotation.NX, node, translate);
        break;
      }
      case BlockRotation.NX: {
        BlockRotation.rotate(BlockRotation.PX, node, translate);
        break;
      }
      case BlockRotation.PY: {
        BlockRotation.rotate(BlockRotation.NY, node, translate);
        break;
      }
      case BlockRotation.NY: {
        BlockRotation.rotate(BlockRotation.PY, node, translate);
        break;
      }
      case BlockRotation.PZ: {
        BlockRotation.rotate(BlockRotation.NZ, node, translate);
        break;
      }
      case BlockRotation.NZ: {
        BlockRotation.rotate(BlockRotation.PZ, node, translate);
        break;
      }
    }
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
