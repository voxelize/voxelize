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
    return new AABB(
      Math.min(this.minX, other.minX),
      Math.min(this.minY, other.minY),
      Math.min(this.minZ, other.minZ),
      Math.max(this.maxX, other.maxX),
      Math.max(this.maxY, other.maxY),
      Math.max(this.maxZ, other.maxZ)
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
    this.minX = other.minX;
    this.minY = other.minY;
    this.minZ = other.minZ;
    this.maxX = other.maxX;
    this.maxY = other.maxY;
    this.maxZ = other.maxZ;
  }

  intersection(other: AABB): AABB {
    return new AABB(
      Math.max(this.minX, other.minX),
      Math.max(this.minY, other.minY),
      Math.max(this.minZ, other.minZ),
      Math.min(this.maxX, other.maxX),
      Math.min(this.maxY, other.maxY),
      Math.min(this.maxZ, other.maxZ)
    );
  }

  touches(other: AABB): boolean {
    const epsilon = 0.0001;
    return (
      Math.abs(this.maxX - other.minX) < epsilon ||
      Math.abs(this.minX - other.maxX) < epsilon ||
      Math.abs(this.maxY - other.minY) < epsilon ||
      Math.abs(this.minY - other.maxY) < epsilon ||
      Math.abs(this.maxZ - other.minZ) < epsilon ||
      Math.abs(this.minZ - other.maxZ) < epsilon
    );
  }

  intersects(other: AABB): boolean {
    return (
      this.minX < other.maxX &&
      this.maxX > other.minX &&
      this.minY < other.maxY &&
      this.maxY > other.minY &&
      this.minZ < other.maxZ &&
      this.maxZ > other.minZ
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
