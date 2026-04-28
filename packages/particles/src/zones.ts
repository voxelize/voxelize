import { Vector3 } from "three";

export interface Zone {
  sample(out: Vector3): Vector3;
}

export class BoxZone implements Zone {
  readonly halfX: number;
  readonly halfY: number;
  readonly halfZ: number;

  constructor(size: number);
  constructor(sizeX: number, sizeY: number, sizeZ: number);
  constructor(sizeX: number, sizeY?: number, sizeZ?: number) {
    const sx = sizeX;
    const sy = sizeY ?? sizeX;
    const sz = sizeZ ?? sizeX;
    this.halfX = sx * 0.5;
    this.halfY = sy * 0.5;
    this.halfZ = sz * 0.5;
  }

  sample(out: Vector3): Vector3 {
    out.set(
      (Math.random() * 2 - 1) * this.halfX,
      (Math.random() * 2 - 1) * this.halfY,
      (Math.random() * 2 - 1) * this.halfZ,
    );
    return out;
  }
}

export class SphereZone implements Zone {
  constructor(public readonly radius: number) {}

  sample(out: Vector3): Vector3 {
    const u = Math.random();
    const v = Math.random();
    const theta = u * 2 * Math.PI;
    const phi = Math.acos(2 * v - 1);
    const r = Math.cbrt(Math.random()) * this.radius;
    const sinPhi = Math.sin(phi);
    out.set(
      r * sinPhi * Math.cos(theta),
      r * sinPhi * Math.sin(theta),
      r * Math.cos(phi),
    );
    return out;
  }
}

export class PointZone implements Zone {
  sample(out: Vector3): Vector3 {
    out.set(0, 0, 0);
    return out;
  }
}
