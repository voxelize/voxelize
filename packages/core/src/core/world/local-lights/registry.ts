import {
  colorTemperatureToRgb,
  INVALID_LIGHT_HANDLE,
  LightHandle,
  LocalLightDescriptor,
} from "./types";

const GENERATION_BITS = 12;
const GENERATION_MASK = (1 << GENERATION_BITS) - 1;

export const LIGHT_FLAG_STATIC = 1;
export const LIGHT_FLAG_MASKED = 2;
export const LIGHT_FLAG_FLICKER = 4;
export const LIGHT_FLAG_SHADOW_REQUEST = 8;

export const LIGHT_SHAPE_POINT = 0;
export const LIGHT_SHAPE_SPOT = 1;
export const LIGHT_SHAPE_CAPSULE = 2;

const MIN_COS_DELTA = 1e-3;
/** Golden-angle stride keys a deterministic, well-spread flicker phase to the slot. */
const FLICKER_PHASE_STRIDE = 2.399963;

const warnDev = (message: string) => {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[voxelize] local lights: ${message}`);
  }
};

/**
 * Pooled structure-of-arrays storage for every registered local light.
 * Handles are generation-checked packed integers; all mutators are in-place
 * writes with zero allocation. The registry knows nothing about selection,
 * chunks, or the GPU — it is the single source of truth the rest of the
 * system reads.
 */
export class LightSourceRegistry {
  readonly capacity: number;

  readonly positions: Float32Array;
  readonly ranges: Float32Array;
  readonly colors: Float32Array;
  readonly intensities: Float32Array;
  readonly shares: Float32Array;
  readonly shapes: Uint8Array;
  readonly flags: Uint8Array;
  /** Spot: direction xyz + cosOuter. Capsule: end offset xyz + 0. */
  readonly aux: Float32Array;
  /** Flicker speed, amplitude, phase, and the spot's inverse cos delta. */
  readonly flickers: Float32Array;
  readonly priorityBiases: Float32Array;

  /** Dense list of alive slot indices, iteration order = allocation order. */
  readonly aliveIndices: Uint32Array;
  aliveCount = 0;

  /**
   * Bumped on any mutation that can change selection or packed data; the
   * clustering pass compares it to decide whether any work exists at all.
   */
  revision = 1;

  private readonly generations: Uint16Array;
  private readonly isAlive: Uint8Array;
  private readonly isEnabled: Uint8Array;
  private readonly alivePositionOf: Uint32Array;
  private readonly freeIndices: Uint32Array;
  private freeCount: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.ranges = new Float32Array(capacity);
    this.colors = new Float32Array(capacity * 3);
    this.intensities = new Float32Array(capacity);
    this.shares = new Float32Array(capacity);
    this.shapes = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.aux = new Float32Array(capacity * 4);
    this.flickers = new Float32Array(capacity * 4);
    this.priorityBiases = new Float32Array(capacity);
    this.aliveIndices = new Uint32Array(capacity);
    this.generations = new Uint16Array(capacity).fill(1);
    this.isAlive = new Uint8Array(capacity);
    this.isEnabled = new Uint8Array(capacity);
    this.alivePositionOf = new Uint32Array(capacity);
    this.freeIndices = new Uint32Array(capacity);
    // Stacked in reverse so slots allocate in ascending index order, which
    // keeps handle order — and with it every deterministic tie-break —
    // aligned with registration order.
    for (let i = 0; i < capacity; i++) {
      this.freeIndices[i] = capacity - 1 - i;
    }
    this.freeCount = capacity;
  }

  add(
    descriptor: LocalLightDescriptor,
    x: number,
    y: number,
    z: number,
  ): LightHandle {
    if (this.freeCount === 0) {
      warnDev(
        "light pool exhausted; raise options.localLights.maxRegisteredLights",
      );
      return INVALID_LIGHT_HANDLE;
    }

    const color = descriptor.color
      ? descriptor.color
      : colorTemperatureToRgb(descriptor.colorTemperatureK ?? 6500);

    const index = this.freeIndices[--this.freeCount];
    this.isAlive[index] = 1;
    this.isEnabled[index] = 1;
    this.alivePositionOf[index] = this.aliveCount;
    this.aliveIndices[this.aliveCount++] = index;

    this.positions[index * 3] = x;
    this.positions[index * 3 + 1] = y;
    this.positions[index * 3 + 2] = z;
    this.ranges[index] = Math.max(descriptor.range, 1e-3);
    this.colors[index * 3] = color[0];
    this.colors[index * 3 + 1] = color[1];
    this.colors[index * 3 + 2] = color[2];
    this.intensities[index] = Math.max(descriptor.intensity, 0);
    this.shares[index] = descriptor.analyticShare ?? 0.6;
    this.priorityBiases[index] = descriptor.priorityBias ?? 0;

    let flags = 0;
    if (descriptor.isStatic) flags |= LIGHT_FLAG_STATIC;
    if (descriptor.shadowPolicy === "voxelMask") {
      if (descriptor.isStatic) {
        flags |= LIGHT_FLAG_MASKED;
      } else {
        // A dynamic source has no flood field to mask by; treat as unmasked.
        warnDev(
          '"voxelMask" on a dynamic light has no flood to mask by; using "none"',
        );
      }
    }
    if (descriptor.shadowPolicy === "shadowMap") {
      flags |= LIGHT_FLAG_SHADOW_REQUEST;
    }

    const shape =
      descriptor.shape === "spot"
        ? LIGHT_SHAPE_SPOT
        : descriptor.shape === "capsule"
          ? LIGHT_SHAPE_CAPSULE
          : LIGHT_SHAPE_POINT;
    this.shapes[index] = shape;

    const aux = this.aux;
    if (shape === LIGHT_SHAPE_SPOT) {
      const direction = descriptor.direction ?? [0, -1, 0];
      const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
      const halfOuter = ((descriptor.angleDeg ?? 60) * Math.PI) / 360;
      const cosOuter = Math.cos(halfOuter);
      const cosInner = Math.cos(
        halfOuter * Math.min(Math.max(descriptor.innerRatio ?? 0.5, 0), 1),
      );
      aux[index * 4] = direction[0] / length;
      aux[index * 4 + 1] = direction[1] / length;
      aux[index * 4 + 2] = direction[2] / length;
      aux[index * 4 + 3] = cosOuter;
      this.flickers[index * 4 + 3] =
        1 / Math.max(cosInner - cosOuter, MIN_COS_DELTA);
    } else if (shape === LIGHT_SHAPE_CAPSULE) {
      const end = descriptor.endOffset ?? [0, 0, 0];
      aux[index * 4] = end[0];
      aux[index * 4 + 1] = end[1];
      aux[index * 4 + 2] = end[2];
      aux[index * 4 + 3] = 0;
      this.flickers[index * 4 + 3] = 0;
    } else {
      aux[index * 4] = 0;
      aux[index * 4 + 1] = 0;
      aux[index * 4 + 2] = 0;
      aux[index * 4 + 3] = 0;
      this.flickers[index * 4 + 3] = 0;
    }

    const flicker = descriptor.flicker;
    if (flicker && flicker.amplitude > 0) {
      flags |= LIGHT_FLAG_FLICKER;
      this.flickers[index * 4] = flicker.speed;
      this.flickers[index * 4 + 1] = Math.min(
        Math.max(flicker.amplitude, 0),
        1,
      );
      this.flickers[index * 4 + 2] =
        (index * FLICKER_PHASE_STRIDE) % (Math.PI * 2);
    } else {
      this.flickers[index * 4] = 0;
      this.flickers[index * 4 + 1] = 0;
      this.flickers[index * 4 + 2] = 0;
    }

    this.flags[index] = flags;
    this.revision++;
    return ((index << GENERATION_BITS) | this.generations[index]) >>> 0;
  }

  remove(handle: LightHandle): boolean {
    const index = this.resolve(handle);
    if (index < 0) return false;

    this.isAlive[index] = 0;
    // Skipping generation 0 keeps `0` an impossible handle for every slot.
    this.generations[index] =
      (this.generations[index] + 1) & GENERATION_MASK || 1;
    this.freeIndices[this.freeCount++] = index;

    const position = this.alivePositionOf[index];
    const lastIndex = this.aliveIndices[--this.aliveCount];
    this.aliveIndices[position] = lastIndex;
    this.alivePositionOf[lastIndex] = position;

    this.revision++;
    return true;
  }

  /** Slot index for a live handle, or `-1` for stale/invalid ones. */
  resolve(handle: LightHandle): number {
    if (handle === INVALID_LIGHT_HANDLE) return -1;
    const index = handle >>> GENERATION_BITS;
    if (index >= this.capacity) return -1;
    if (this.generations[index] !== (handle & GENERATION_MASK)) return -1;
    return this.isAlive[index] ? index : -1;
  }

  /**
   * Current generation of a slot, for state keyed to a light's lifetime
   * rather than its slot (selection hysteresis must not survive slot reuse).
   */
  generationAt(index: number): number {
    return this.generations[index];
  }

  isEnabledAt(index: number): boolean {
    return this.isEnabled[index] === 1;
  }

  setPosition(handle: LightHandle, x: number, y: number, z: number): boolean {
    const index = this.resolve(handle);
    if (index < 0) return false;
    if (this.flags[index] & LIGHT_FLAG_STATIC) {
      warnDev("setPosition on a static light; register it as dynamic instead");
      return false;
    }
    this.positions[index * 3] = x;
    this.positions[index * 3 + 1] = y;
    this.positions[index * 3 + 2] = z;
    this.revision++;
    return true;
  }

  setDirection(handle: LightHandle, x: number, y: number, z: number): boolean {
    const index = this.resolve(handle);
    if (index < 0 || this.shapes[index] !== LIGHT_SHAPE_SPOT) return false;
    const length = Math.hypot(x, y, z) || 1;
    this.aux[index * 4] = x / length;
    this.aux[index * 4 + 1] = y / length;
    this.aux[index * 4 + 2] = z / length;
    this.revision++;
    return true;
  }

  setIntensity(handle: LightHandle, intensity: number): boolean {
    const index = this.resolve(handle);
    if (index < 0) return false;
    this.intensities[index] = Math.max(intensity, 0);
    this.revision++;
    return true;
  }

  setColor(handle: LightHandle, color: [number, number, number]): boolean {
    const index = this.resolve(handle);
    if (index < 0) return false;
    this.colors[index * 3] = color[0];
    this.colors[index * 3 + 1] = color[1];
    this.colors[index * 3 + 2] = color[2];
    this.revision++;
    return true;
  }

  setRange(handle: LightHandle, range: number): boolean {
    const index = this.resolve(handle);
    if (index < 0) return false;
    this.ranges[index] = Math.max(range, 1e-3);
    this.revision++;
    return true;
  }

  setEnabled(handle: LightHandle, isOn: boolean): boolean {
    const index = this.resolve(handle);
    if (index < 0) return false;
    if (this.isEnabled[index] === (isOn ? 1 : 0)) return true;
    this.isEnabled[index] = isOn ? 1 : 0;
    this.revision++;
    return true;
  }
}
