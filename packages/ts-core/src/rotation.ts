import { AABB } from "./aabb";
import {
  NX_ROTATION,
  NY_ROTATION,
  NZ_ROTATION,
  PI_2,
  PX_ROTATION,
  PY_ROTATION,
  PZ_ROTATION,
  Y_ROT_SEGMENTS,
  toSaturatedUint32,
} from "./constants";
import { FaceTransparency, Vec3 } from "./vectors";

const TWO_PI = Math.PI * 2.0;

const mapTransparencyValue = (
  value: number,
  [px, py, pz, nx, ny, nz]: FaceTransparency
): boolean => {
  if (value === 1.0) {
    return px;
  }

  if (value === 2.0) {
    return py;
  }

  if (value === 3.0) {
    return pz;
  }

  if (value === 4.0) {
    return nx;
  }

  if (value === 5.0) {
    return ny;
  }

  return nz;
};

export class BlockRotation {
  constructor(
    public axis = PY_ROTATION,
    public yRotation = 0
  ) {}

  static px(yRotation = 0): BlockRotation {
    return new BlockRotation(PX_ROTATION, yRotation);
  }

  static nx(yRotation = 0): BlockRotation {
    return new BlockRotation(NX_ROTATION, yRotation);
  }

  static py(yRotation = 0): BlockRotation {
    return new BlockRotation(PY_ROTATION, yRotation);
  }

  static ny(yRotation = 0): BlockRotation {
    return new BlockRotation(NY_ROTATION, yRotation);
  }

  static pz(yRotation = 0): BlockRotation {
    return new BlockRotation(PZ_ROTATION, yRotation);
  }

  static nz(yRotation = 0): BlockRotation {
    return new BlockRotation(NZ_ROTATION, yRotation);
  }

  static encode(value: number, yRotation = 0): BlockRotation {
    const encodedYRotation = (yRotation * TWO_PI) / Y_ROT_SEGMENTS;

    switch (value) {
      case PX_ROTATION:
        return BlockRotation.px(encodedYRotation);
      case NX_ROTATION:
        return BlockRotation.nx(encodedYRotation);
      case PY_ROTATION:
        return BlockRotation.py(encodedYRotation);
      case NY_ROTATION:
        return BlockRotation.ny(encodedYRotation);
      case PZ_ROTATION:
        return BlockRotation.pz(encodedYRotation);
      case NZ_ROTATION:
        return BlockRotation.nz(encodedYRotation);
      default:
        return BlockRotation.py(encodedYRotation);
    }
  }

  static decode(rotation: BlockRotation): [number, number] {
    const converted = (rotation.yRotation * Y_ROT_SEGMENTS) / TWO_PI;
    const yRotation = toSaturatedUint32(Math.round(converted)) % Y_ROT_SEGMENTS;

    switch (rotation.axis) {
      case PX_ROTATION:
        return [PX_ROTATION, yRotation];
      case NX_ROTATION:
        return [NX_ROTATION, yRotation];
      case PY_ROTATION:
        return [PY_ROTATION, yRotation];
      case NY_ROTATION:
        return [NY_ROTATION, yRotation];
      case PZ_ROTATION:
        return [PZ_ROTATION, yRotation];
      case NZ_ROTATION:
        return [NZ_ROTATION, yRotation];
      default:
        return [PY_ROTATION, yRotation];
    }
  }

  rotateNode(node: Vec3, yRotate = true, translate = true): void {
    if (yRotate && Math.abs(this.yRotation) > Number.EPSILON) {
      node[0] -= 0.5;
      node[2] -= 0.5;
      this.rotateY(node, this.yRotation);
      node[0] += 0.5;
      node[2] += 0.5;
    }

    switch (this.axis) {
      case PX_ROTATION: {
        this.rotateZ(node, -PI_2);
        if (translate) {
          node[1] += 1.0;
        }
        break;
      }
      case NX_ROTATION: {
        this.rotateZ(node, PI_2);
        if (translate) {
          node[0] += 1.0;
        }
        break;
      }
      case PY_ROTATION: {
        break;
      }
      case NY_ROTATION: {
        this.rotateX(node, PI_2 * 2.0);
        if (translate) {
          node[1] += 1.0;
          node[2] += 1.0;
        }
        break;
      }
      case PZ_ROTATION: {
        this.rotateX(node, PI_2);
        if (translate) {
          node[1] += 1.0;
        }
        break;
      }
      case NZ_ROTATION: {
        this.rotateX(node, -PI_2);
        if (translate) {
          node[2] += 1.0;
        }
        break;
      }
      default:
        break;
    }
  }

  rotateAABB(aabb: AABB, yRotate = true, translate = true): AABB {
    const min: Vec3 = [aabb.minX, aabb.minY, aabb.minZ];
    const max: Vec3 = [aabb.maxX, aabb.maxY, aabb.maxZ];

    let minX: number | null = null;
    let minZ: number | null = null;
    let maxX: number | null = null;
    let maxZ: number | null = null;

    if (
      yRotate &&
      (this.axis === PY_ROTATION || this.axis === NY_ROTATION)
    ) {
      const minNodes: Vec3[] = [
        [aabb.minX, aabb.minY, aabb.minZ],
        [aabb.minX, aabb.minY, aabb.maxZ],
        [aabb.maxX, aabb.minY, aabb.minZ],
        [aabb.maxX, aabb.minY, aabb.maxZ],
      ];

      for (const node of minNodes) {
        this.rotateNode(node, true, true);

        if (minX === null || node[0] < minX) {
          minX = node[0];
        }

        if (minZ === null || node[2] < minZ) {
          minZ = node[2];
        }
      }

      const maxNodes: Vec3[] = [
        [aabb.minX, aabb.maxY, aabb.minZ],
        [aabb.minX, aabb.maxY, aabb.maxZ],
        [aabb.maxX, aabb.maxY, aabb.minZ],
        [aabb.maxX, aabb.maxY, aabb.maxZ],
      ];

      for (const node of maxNodes) {
        this.rotateNode(node, true, true);

        if (maxX === null || node[0] > maxX) {
          maxX = node[0];
        }

        if (maxZ === null || node[2] > maxZ) {
          maxZ = node[2];
        }
      }
    }

    this.rotateNode(min, false, translate);
    this.rotateNode(max, false, translate);

    return new AABB(
      minX ?? Math.min(min[0], max[0]),
      Math.min(min[1], max[1]),
      minZ ?? Math.min(min[2], max[2]),
      maxX ?? Math.max(min[0], max[0]),
      Math.max(max[1], min[1]),
      maxZ ?? Math.max(min[2], max[2])
    );
  }

  rotateTransparency(
    [px, py, pz, nx, ny, nz]: FaceTransparency
  ): FaceTransparency {
    if (this.axis === PY_ROTATION && Math.abs(this.yRotation) < Number.EPSILON) {
      return [px, py, pz, nx, ny, nz];
    }

    const positive: Vec3 = [1.0, 2.0, 3.0];
    const negative: Vec3 = [4.0, 5.0, 6.0];

    this.rotateNode(positive, true, false);
    this.rotateNode(negative, true, false);

    const transparency: FaceTransparency = [px, py, pz, nx, ny, nz];
    const p = positive.map((value) => mapTransparencyValue(value, transparency));
    const n = negative.map((value) => mapTransparencyValue(value, transparency));

    return [p[0], p[1], p[2], n[0], n[1], n[2]];
  }

  equals(other: BlockRotation): boolean {
    const [thisAxis, thisYRotation] = BlockRotation.decode(this);
    const [otherAxis, otherYRotation] = BlockRotation.decode(other);

    return thisAxis === otherAxis && thisYRotation === otherYRotation;
  }

  private rotateX(node: Vec3, theta: number): void {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const y = node[1];
    const z = node[2];
    node[1] = y * cosTheta - z * sinTheta;
    node[2] = z * cosTheta + y * sinTheta;
  }

  private rotateY(node: Vec3, theta: number): void {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const x = node[0];
    const z = node[2];
    node[0] = z * sinTheta + x * cosTheta;
    node[2] = z * cosTheta - x * sinTheta;
  }

  private rotateZ(node: Vec3, theta: number): void {
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    const x = node[0];
    const y = node[1];
    node[0] = x * cosTheta - y * sinTheta;
    node[1] = y * cosTheta + x * sinTheta;
  }
}
