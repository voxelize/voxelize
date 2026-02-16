export class AABBBuilder {
  private scaleXValue = 1;
  private scaleYValue = 1;
  private scaleZValue = 1;
  private offsetXValue = 0;
  private offsetYValue = 0;
  private offsetZValue = 0;

  scaleX(scaleX: number): this {
    this.scaleXValue = scaleX;
    return this;
  }

  scaleY(scaleY: number): this {
    this.scaleYValue = scaleY;
    return this;
  }

  scaleZ(scaleZ: number): this {
    this.scaleZValue = scaleZ;
    return this;
  }

  offsetX(offsetX: number): this {
    this.offsetXValue = offsetX;
    return this;
  }

  offsetY(offsetY: number): this {
    this.offsetYValue = offsetY;
    return this;
  }

  offsetZ(offsetZ: number): this {
    this.offsetZValue = offsetZ;
    return this;
  }

  build(): AABB {
    return new AABB(
      this.offsetXValue,
      this.offsetYValue,
      this.offsetZValue,
      this.offsetXValue + this.scaleXValue,
      this.offsetYValue + this.scaleYValue,
      this.offsetZValue + this.scaleZValue
    );
  }
}

const isArrayValue = (value: readonly AABB[] | null | undefined): value is readonly AABB[] => {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
};

type AabbSnapshot = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

const readAabbSnapshotSafely = (
  value: AABB | null | undefined
): AabbSnapshot | null => {
  if (value === null || value === undefined || typeof value !== "object") {
    return null;
  }

  try {
    const minX = value.minX;
    const minY = value.minY;
    const minZ = value.minZ;
    const maxX = value.maxX;
    const maxY = value.maxY;
    const maxZ = value.maxZ;
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(minZ) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY) ||
      !Number.isFinite(maxZ)
    ) {
      return null;
    }

    return {
      minX,
      minY,
      minZ,
      maxX,
      maxY,
      maxZ,
    };
  } catch {
    return null;
  }
};

export class AABB {
  constructor(
    public minX = 0,
    public minY = 0,
    public minZ = 0,
    public maxX = 0,
    public maxY = 0,
    public maxZ = 0
  ) {}

  static new(): AABBBuilder {
    return new AABBBuilder();
  }

  static create(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number
  ): AABB {
    return new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  }

  static empty(): AABB {
    return new AABB();
  }

  static unionAll(all: readonly AABB[]): AABB {
    if (!isArrayValue(all)) {
      return AABB.empty();
    }

    let length = 0;
    try {
      length = all.length;
    } catch {
      return AABB.empty();
    }
    if (!Number.isSafeInteger(length) || length <= 0) {
      return AABB.empty();
    }

    let unionSnapshot: AabbSnapshot | null = null;

    for (let index = 0; index < length; index += 1) {
      let entry: AABB | null = null;
      try {
        entry = all[index] ?? null;
      } catch {
        continue;
      }
      const snapshot = readAabbSnapshotSafely(entry);
      if (snapshot === null) {
        continue;
      }

      if (unionSnapshot === null) {
        unionSnapshot = {
          minX: snapshot.minX,
          minY: snapshot.minY,
          minZ: snapshot.minZ,
          maxX: snapshot.maxX,
          maxY: snapshot.maxY,
          maxZ: snapshot.maxZ,
        };
        continue;
      }

      if (snapshot.minX < unionSnapshot.minX) {
        unionSnapshot.minX = snapshot.minX;
      }

      if (snapshot.minY < unionSnapshot.minY) {
        unionSnapshot.minY = snapshot.minY;
      }

      if (snapshot.minZ < unionSnapshot.minZ) {
        unionSnapshot.minZ = snapshot.minZ;
      }

      if (snapshot.maxX > unionSnapshot.maxX) {
        unionSnapshot.maxX = snapshot.maxX;
      }

      if (snapshot.maxY > unionSnapshot.maxY) {
        unionSnapshot.maxY = snapshot.maxY;
      }

      if (snapshot.maxZ > unionSnapshot.maxZ) {
        unionSnapshot.maxZ = snapshot.maxZ;
      }
    }

    if (unionSnapshot === null) {
      return AABB.empty();
    }

    return new AABB(
      unionSnapshot.minX,
      unionSnapshot.minY,
      unionSnapshot.minZ,
      unionSnapshot.maxX,
      unionSnapshot.maxY,
      unionSnapshot.maxZ
    );
  }

  union(other: AABB): AABB {
    const sourceSnapshot = readAabbSnapshotSafely(this);
    if (sourceSnapshot === null) {
      return AABB.empty();
    }
    const otherSnapshot = readAabbSnapshotSafely(other);
    if (otherSnapshot === null) {
      return AABB.create(
        sourceSnapshot.minX,
        sourceSnapshot.minY,
        sourceSnapshot.minZ,
        sourceSnapshot.maxX,
        sourceSnapshot.maxY,
        sourceSnapshot.maxZ
      );
    }

    return new AABB(
      Math.min(sourceSnapshot.minX, otherSnapshot.minX),
      Math.min(sourceSnapshot.minY, otherSnapshot.minY),
      Math.min(sourceSnapshot.minZ, otherSnapshot.minZ),
      Math.max(sourceSnapshot.maxX, otherSnapshot.maxX),
      Math.max(sourceSnapshot.maxY, otherSnapshot.maxY),
      Math.max(sourceSnapshot.maxZ, otherSnapshot.maxZ)
    );
  }

  width(): number {
    return this.maxX - this.minX;
  }

  height(): number {
    return this.maxY - this.minY;
  }

  depth(): number {
    return this.maxZ - this.minZ;
  }

  mag(): number {
    return Math.sqrt(
      this.width() * this.width() +
        this.height() * this.height() +
        this.depth() * this.depth()
    );
  }

  translate(dx: number, dy: number, dz: number): void {
    this.minX += dx;
    this.minY += dy;
    this.minZ += dz;
    this.maxX += dx;
    this.maxY += dy;
    this.maxZ += dz;
  }

  setPosition(px: number, py: number, pz: number): void {
    this.maxX = px + this.width();
    this.maxY = py + this.height();
    this.maxZ = pz + this.depth();
    this.minX = px;
    this.minY = py;
    this.minZ = pz;
  }

  copy(other: AABB): void {
    const otherSnapshot = readAabbSnapshotSafely(other);
    if (otherSnapshot === null) {
      return;
    }

    this.minX = otherSnapshot.minX;
    this.minY = otherSnapshot.minY;
    this.minZ = otherSnapshot.minZ;
    this.maxX = otherSnapshot.maxX;
    this.maxY = otherSnapshot.maxY;
    this.maxZ = otherSnapshot.maxZ;
  }

  intersection(other: AABB): AABB {
    const sourceSnapshot = readAabbSnapshotSafely(this);
    const otherSnapshot = readAabbSnapshotSafely(other);
    if (sourceSnapshot === null || otherSnapshot === null) {
      return AABB.empty();
    }

    return new AABB(
      Math.max(sourceSnapshot.minX, otherSnapshot.minX),
      Math.max(sourceSnapshot.minY, otherSnapshot.minY),
      Math.max(sourceSnapshot.minZ, otherSnapshot.minZ),
      Math.min(sourceSnapshot.maxX, otherSnapshot.maxX),
      Math.min(sourceSnapshot.maxY, otherSnapshot.maxY),
      Math.min(sourceSnapshot.maxZ, otherSnapshot.maxZ)
    );
  }

  touches(other: AABB): boolean {
    const sourceSnapshot = readAabbSnapshotSafely(this);
    const otherSnapshot = readAabbSnapshotSafely(other);
    if (sourceSnapshot === null || otherSnapshot === null) {
      return false;
    }

    const epsilon = 0.0001;
    return (
      Math.abs(sourceSnapshot.maxX - otherSnapshot.minX) < epsilon ||
      Math.abs(sourceSnapshot.minX - otherSnapshot.maxX) < epsilon ||
      Math.abs(sourceSnapshot.maxY - otherSnapshot.minY) < epsilon ||
      Math.abs(sourceSnapshot.minY - otherSnapshot.maxY) < epsilon ||
      Math.abs(sourceSnapshot.maxZ - otherSnapshot.minZ) < epsilon ||
      Math.abs(sourceSnapshot.minZ - otherSnapshot.maxZ) < epsilon
    );
  }

  intersects(other: AABB): boolean {
    const sourceSnapshot = readAabbSnapshotSafely(this);
    const otherSnapshot = readAabbSnapshotSafely(other);
    if (sourceSnapshot === null || otherSnapshot === null) {
      return false;
    }

    return (
      sourceSnapshot.minX < otherSnapshot.maxX &&
      sourceSnapshot.maxX > otherSnapshot.minX &&
      sourceSnapshot.minY < otherSnapshot.maxY &&
      sourceSnapshot.maxY > otherSnapshot.minY &&
      sourceSnapshot.minZ < otherSnapshot.maxZ &&
      sourceSnapshot.maxZ > otherSnapshot.minZ
    );
  }

  clone(): AABB {
    return new AABB(
      this.minX,
      this.minY,
      this.minZ,
      this.maxX,
      this.maxY,
      this.maxZ
    );
  }
}
