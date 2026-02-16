export class AABBBuilder {
  private scaleXValue = 1;
  private scaleYValue = 1;
  private scaleZValue = 1;
  private offsetXValue = 0;
  private offsetYValue = 0;
  private offsetZValue = 0;

  scaleX(scaleX: number): this {
    try {
      this.scaleXValue = toFiniteNumberOrZero(scaleX);
    } catch {
      // no-op when assignment is unavailable
    }
    return this;
  }

  scaleY(scaleY: number): this {
    try {
      this.scaleYValue = toFiniteNumberOrZero(scaleY);
    } catch {
      // no-op when assignment is unavailable
    }
    return this;
  }

  scaleZ(scaleZ: number): this {
    try {
      this.scaleZValue = toFiniteNumberOrZero(scaleZ);
    } catch {
      // no-op when assignment is unavailable
    }
    return this;
  }

  offsetX(offsetX: number): this {
    try {
      this.offsetXValue = toFiniteNumberOrZero(offsetX);
    } catch {
      // no-op when assignment is unavailable
    }
    return this;
  }

  offsetY(offsetY: number): this {
    try {
      this.offsetYValue = toFiniteNumberOrZero(offsetY);
    } catch {
      // no-op when assignment is unavailable
    }
    return this;
  }

  offsetZ(offsetZ: number): this {
    try {
      this.offsetZValue = toFiniteNumberOrZero(offsetZ);
    } catch {
      // no-op when assignment is unavailable
    }
    return this;
  }

  build(): AABB {
    let scaleXValue = 1;
    let scaleYValue = 1;
    let scaleZValue = 1;
    let offsetXValue = 0;
    let offsetYValue = 0;
    let offsetZValue = 0;

    try {
      scaleXValue = toFiniteNumberOrZero(this.scaleXValue);
      scaleYValue = toFiniteNumberOrZero(this.scaleYValue);
      scaleZValue = toFiniteNumberOrZero(this.scaleZValue);
      offsetXValue = toFiniteNumberOrZero(this.offsetXValue);
      offsetYValue = toFiniteNumberOrZero(this.offsetYValue);
      offsetZValue = toFiniteNumberOrZero(this.offsetZValue);
    } catch {
      return AABB.empty();
    }

    return new AABB(
      offsetXValue,
      offsetYValue,
      offsetZValue,
      offsetXValue + scaleXValue,
      offsetYValue + scaleYValue,
      offsetZValue + scaleZValue
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

type NumericLikeValue = number | string | boolean | object | null | undefined;

const toFiniteNumberOrZero = (value: NumericLikeValue): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  try {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
  } catch {
    return 0;
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
    const snapshot = readAabbSnapshotSafely(this);
    if (snapshot === null) {
      return 0;
    }

    return snapshot.maxX - snapshot.minX;
  }

  height(): number {
    const snapshot = readAabbSnapshotSafely(this);
    if (snapshot === null) {
      return 0;
    }

    return snapshot.maxY - snapshot.minY;
  }

  depth(): number {
    const snapshot = readAabbSnapshotSafely(this);
    if (snapshot === null) {
      return 0;
    }

    return snapshot.maxZ - snapshot.minZ;
  }

  mag(): number {
    const snapshot = readAabbSnapshotSafely(this);
    if (snapshot === null) {
      return 0;
    }

    const width = snapshot.maxX - snapshot.minX;
    const height = snapshot.maxY - snapshot.minY;
    const depth = snapshot.maxZ - snapshot.minZ;

    return Math.sqrt(
      width * width +
        height * height +
        depth * depth
    );
  }

  translate(dx: number, dy: number, dz: number): void {
    const snapshot = readAabbSnapshotSafely(this);
    if (snapshot === null) {
      return;
    }

    const normalizedDx = toFiniteNumberOrZero(dx);
    const normalizedDy = toFiniteNumberOrZero(dy);
    const normalizedDz = toFiniteNumberOrZero(dz);
    try {
      this.minX = snapshot.minX + normalizedDx;
      this.minY = snapshot.minY + normalizedDy;
      this.minZ = snapshot.minZ + normalizedDz;
      this.maxX = snapshot.maxX + normalizedDx;
      this.maxY = snapshot.maxY + normalizedDy;
      this.maxZ = snapshot.maxZ + normalizedDz;
    } catch {
      // no-op when assignment is unavailable
    }
  }

  setPosition(px: number, py: number, pz: number): void {
    const snapshot = readAabbSnapshotSafely(this);
    if (snapshot === null) {
      return;
    }

    const normalizedPx = toFiniteNumberOrZero(px);
    const normalizedPy = toFiniteNumberOrZero(py);
    const normalizedPz = toFiniteNumberOrZero(pz);
    const width = snapshot.maxX - snapshot.minX;
    const height = snapshot.maxY - snapshot.minY;
    const depth = snapshot.maxZ - snapshot.minZ;

    try {
      this.maxX = normalizedPx + width;
      this.maxY = normalizedPy + height;
      this.maxZ = normalizedPz + depth;
      this.minX = normalizedPx;
      this.minY = normalizedPy;
      this.minZ = normalizedPz;
    } catch {
      // no-op when assignment is unavailable
    }
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
    const snapshot = readAabbSnapshotSafely(this);
    if (snapshot === null) {
      return AABB.empty();
    }

    return new AABB(
      snapshot.minX,
      snapshot.minY,
      snapshot.minZ,
      snapshot.maxX,
      snapshot.maxY,
      snapshot.maxZ
    );
  }
}
