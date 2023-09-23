/**
 * Axis-aligned Bounding Box.
 */
export class AABB {
  constructor(
    public minX: number,
    public minY: number,
    public minZ: number,
    public maxX: number,
    public maxY: number,
    public maxZ: number
  ) {}

  /**
   * Width of the AABB, maxX - minX.
   *
   * @readonly
   */
  get width() {
    return this.maxX - this.minX;
  }

  /**
   * Height of the AABB, maxY - minY.
   *
   * @readonly
   */
  get height() {
    return this.maxY - this.minY;
  }

  /**
   * Depth of the AABB, maxZ - minZ.
   *
   * @readonly
   */
  get depth() {
    return this.maxZ - this.minZ;
  }

  /**
   * Magnitude of the AABB.
   *
   * @readonly
   */
  get mag() {
    return Math.sqrt(
      (this.maxX - this.minX) ** 2 +
        (this.maxY - this.minY) ** 2 +
        (this.maxZ - this.minZ) ** 2
    );
  }

  /**
   * Get the minimum coordinate at an axis.
   *
   * @param axis - Which axis to get min coordinate of
   */
  getMin = (axis: number) => {
    if (axis === 0) {
      return this.minX;
    } else if (axis === 1) {
      return this.minY;
    } else if (axis === 2) {
      return this.minZ;
    } else {
      throw new Error("GetMinError: Unknown axis.");
    }
  };

  /**
   * Set the minimum coordinate at an axis.
   *
   * @param axis - Which axis to set min coordinate of
   */
  setMin = (axis: number, value: number) => {
    if (axis === 0) {
      this.minX = value;
    } else if (axis === 1) {
      this.minY = value;
    } else if (axis === 2) {
      this.minZ = value;
    } else {
      throw new Error("SetMinError: Unknown axis.");
    }
  };

  /**
   * Get the maximum coordinate at an axis.
   *
   * @param axis - Which axis to get max coordinate of
   */
  getMax = (axis: number) => {
    if (axis === 0) {
      return this.maxX;
    } else if (axis === 1) {
      return this.maxY;
    } else if (axis === 2) {
      return this.maxZ;
    } else {
      throw new Error("GetMaxError: Unknown axis.");
    }
  };

  /**
   * Set the maximum coordinate at an axis.
   *
   * @param axis - Which axis to set max coordinate of
   */
  setMax = (axis: number, value: number) => {
    if (axis === 0) {
      this.maxX = value;
    } else if (axis === 1) {
      this.maxY = value;
    } else if (axis === 2) {
      this.maxZ = value;
    } else {
      throw new Error("SetMaxError: Unknown axis.");
    }
  };

  /**
   * Translate the AABB by an amount.
   *
   * @param delta - By how much is the AABB moved
   */
  translate = ([dx, dy, dz]: number[]) => {
    this.minX += dx;
    this.minY += dy;
    this.minZ += dz;
    this.maxX += dx;
    this.maxY += dy;
    this.maxZ += dz;
    return this;
  };

  /**
   * Translate the AABB on a certain axis.
   *
   * @param axis - Axis to translate on
   */
  translateAxis = (axis: number, delta: number) => {
    if (axis === 0) {
      this.minX += delta;
      this.maxX += delta;
    } else if (axis === 1) {
      this.minY += delta;
      this.maxY += delta;
    } else if (axis === 2) {
      this.minZ += delta;
      this.maxZ += delta;
    } else {
      throw new Error("TranslateAxisError: Unknown axis.");
    }
    return this;
  };

  /**
   * Move the entire AABB to a coordinate.
   *
   * @param point - Base of which the AABB should be moved to
   */
  setPosition = ([px, py, pz]: number[]) => {
    this.maxX = px + this.width;
    this.maxY = py + this.height;
    this.maxZ = pz + this.depth;
    this.minX = px;
    this.minY = py;
    this.minZ = pz;
    return this;
  };

  /**
   * Check to see if AABB intersects with another AABB.
   *
   * @param aabb - Another AABB to test with
   */
  intersects = (aabb: AABB) => {
    if (aabb.minX >= this.maxX) return false;
    if (aabb.minY >= this.maxY) return false;
    if (aabb.minZ >= this.maxZ) return false;
    if (aabb.maxX <= this.minX) return false;
    if (aabb.maxY <= this.minY) return false;
    if (aabb.maxZ <= this.minZ) return false;
    return true;
  };

  /**
   * Check to see if AABB is touching another AABB.
   *
   * @param aabb - Another AABB to test with
   */
  touches = (aabb: AABB) => {
    const intersection = this.intersection(aabb);

    return (
      intersection !== null &&
      (intersection.width === 0 ||
        intersection.height === 0 ||
        intersection.depth === 0)
    );
  };

  /**
   * Get a new AABB of the union of the two AABB's.
   *
   * @param aabb - Another AABB to union with
   */
  union = (aabb: AABB) => {
    return new AABB(
      Math.min(this.minX, aabb.minX),
      Math.min(this.minY, aabb.minY),
      Math.min(this.minZ, aabb.minZ),
      Math.max(this.maxX, aabb.maxX),
      Math.max(this.maxY, aabb.maxY),
      Math.max(this.maxZ, aabb.maxZ)
    );
  };

  /**
   * Get a new AABB of the intersection between two AABB's.
   *
   * @param aabb - Another AABB to intersect with
   */
  intersection = (aabb: AABB) => {
    return new AABB(
      Math.max(this.minX, aabb.minX),
      Math.max(this.minY, aabb.minY),
      Math.max(this.minZ, aabb.minZ),
      Math.min(this.maxX, aabb.maxX),
      Math.min(this.maxY, aabb.maxY),
      Math.min(this.maxZ, aabb.maxZ)
    );
  };

  /**
   * Suppose this AABB should move in the X-axis by `deltaX`, check to see
   * the actual distance available to move with another AABB in the way.
   *
   * @param aabb - AABB in the way
   * @param deltaX - How much supposed to move
   */
  computeOffsetX(aabb: AABB, deltaX: number) {
    // See if the aabb not is in the way.
    const intersection = this.intersection(aabb);
    if (intersection.height <= 0 || intersection.depth <= 0) {
      return deltaX;
    }

    // If overlapping
    if (intersection.width >= 0) {
      return 0;
    }

    // Moving positively, and potentially may block.
    if (deltaX > 0.0 && aabb.minX >= this.maxX) {
      return Math.min(aabb.minX - this.maxX, deltaX);
    }

    // Moving negatively, and potentially may block.
    if (deltaX < 0.0 && aabb.maxX <= this.minX) {
      return Math.max(aabb.maxX - this.minX, deltaX);
    }

    return deltaX;
  }

  /**
   * Suppose this AABB should move in the Y-axis by `deltaY`, check to see
   * the actual distance available to move with another AABB in the way.
   *
   * @param aabb - AABB in the way
   * @param deltaY - How much supposed to move
   */
  computeOffsetY(aabb: AABB, deltaY: number) {
    // See if the aabb not is in the way.
    const intersection = this.intersection(aabb);
    if (intersection.width <= 0 || intersection.depth <= 0) {
      return deltaY;
    }

    // If overlapping
    if (intersection.height >= 0) {
      return 0;
    }

    // Moving positively, and potentially may block.
    if (deltaY > 0.0 && aabb.minY >= this.maxY) {
      return Math.min(aabb.minY - this.maxY, deltaY);
    }

    // Moving negatively, and potentially may block.
    if (deltaY < 0.0 && aabb.maxY <= this.minY) {
      return Math.max(aabb.maxY - this.minY, deltaY);
    }

    return deltaY;
  }

  /**
   * Suppose this AABB should move in the Z-axis by `deltaZ`, check to see
   * the actual distance available to move with another AABB in the way.
   *
   * @param aabb - AABB in the way
   * @param deltaZ - How much supposed to move
   */
  computeOffsetZ(aabb: AABB, deltaZ: number) {
    // See if the aabb not is in the way.
    const intersection = this.intersection(aabb);
    if (intersection.width <= 0 || intersection.height <= 0) {
      return deltaZ;
    }

    // If overlapping
    if (intersection.depth >= 0) {
      return 0;
    }

    // Moving positively, and potentially may block.
    if (deltaZ > 0.0 && aabb.minZ >= this.maxZ) {
      return Math.min(aabb.minZ - this.maxZ, deltaZ);
    }

    // Moving negatively, and potentially may block.
    if (deltaZ < 0.0 && aabb.maxZ <= this.minZ) {
      return Math.max(aabb.maxZ - this.minZ, deltaZ);
    }

    return deltaZ;
  }

  /**
   * Create a clone of this AABB instance.
   */
  clone = () => {
    return new AABB(
      this.minX,
      this.minY,
      this.minZ,
      this.maxX,
      this.maxY,
      this.maxZ
    );
  };

  static union = (all: AABB[]) => {
    let minX = all[0].minX;
    let minY = all[0].minY;
    let minZ = all[0].minZ;
    let maxX = all[0].maxX;
    let maxY = all[0].maxY;
    let maxZ = all[0].maxZ;

    for (const aabb of all) {
      minX = Math.min(minX, aabb.minX);
      minY = Math.min(minY, aabb.minY);
      minZ = Math.min(minZ, aabb.minZ);
      maxX = Math.max(maxX, aabb.maxX);
      maxY = Math.max(maxY, aabb.maxY);
      maxZ = Math.max(maxZ, aabb.maxZ);
    }

    return new AABB(minX, minY, minZ, maxX, maxY, maxZ);
  };
}
