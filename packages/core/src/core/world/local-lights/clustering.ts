import {
  DataTexture,
  FloatType,
  NearestFilter,
  RedIntegerFormat,
  RGBAFormat,
  UnsignedShortType,
  Vector3,
  Vector4,
} from "three";

import { localLightFalloff } from "../block-light-transfer";

import {
  LIGHT_FLAG_FLICKER,
  LIGHT_FLAG_MASKED,
  LIGHT_FLAG_SHADOW_REQUEST,
  LIGHT_FLAG_STATIC,
  LIGHT_SHAPE_CAPSULE,
  LIGHT_SHAPE_SPOT,
  LightSourceRegistry,
  lightHandleIndex,
} from "./registry";
import type { ShadowTexelRecord } from "./shadow-scheduler";
import {
  defaultLocalLightsOptions,
  LocalLightSample,
  LocalLightsOptions,
  LocalLightStats,
} from "./types";

/**
 * Compile-time slot count of the shader loop. Quality tiers cap how many
 * slots the CPU fills, never this constant, so no tier change recompiles.
 */
export const MAX_LIGHTS_PER_CELL = 8;

/** Grid cells per texture row; with 8 slots each, rows are 256 texels wide. */
export const GRID_CELLS_PER_ROW = 32;

/** Hard ceiling of the packed set: a grid slot holds `row + 1` in a byte. */
export const MAX_CLUSTERED_LIGHTS = 255;

/**
 * A grid slot (R16UI): the light's packed data row + 1 in the low byte (0 is
 * an empty slot and ends the cell's list) and the slot's fade weight 0..255
 * in the high byte. Mirrored by `localLightSlot` in shader.ts.
 */
export const SLOT_ROW_MASK = 0xff;
export const SLOT_WEIGHT_SHIFT = 8;
const SLOT_WEIGHT_SCALE = 255;

/**
 * Texels per packed light record: position/range, color/flags, aux, flicker,
 * plus two shadow texels (slot/masks/near, far/tanHalf/weight) that stay zero
 * for unshadowed lights. Widening the record keeps shadow parameters inside
 * the one existing data texture instead of spending another texture unit.
 */
const DATA_TEXELS_PER_LIGHT = 6;

/** Shader-facing flag bits packed into texel 1's `w` (mirrored in shader.ts). */
export const PACKED_FLAG_MASKED = 1;
export const PACKED_FLAG_FLICKER = 2;
export const PACKED_FLAG_SHADOWED = 4;

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

const positiveMod = (value: number, modulus: number) =>
  ((value % modulus) + modulus) % modulus;

/**
 * Storage cell along one axis of a point `rel` cells into the window, the
 * way `localLightCell` computes it: in-window cell plus the origin's storage
 * offset, wrapped once.
 */
const wrapCell = (rel: number, offset: number, dim: number) => {
  const cell = Math.floor(rel) + offset;
  return cell >= dim ? cell - dim : cell;
};

/** Distance from `p` to the span `[lo, lo + size]`, 0 inside it. */
const spanDistance = (p: number, lo: number, size: number) =>
  p < lo ? lo - p : p > lo + size ? p - lo - size : 0;

type LightClusterGridOptions = Pick<
  LocalLightsOptions,
  | "gridCellSize"
  | "gridDims"
  | "maxClusteredLights"
  | "maxLightsPerCell"
  | "analyticRadius"
  | "selectionHysteresis"
  | "maskKnee"
  | "fluidSpecularStrength"
> &
  Partial<
    Pick<
      LocalLightsOptions,
      | "temporalStability"
      | "slotFadeMs"
      | "fadingRowReserve"
      | "windowFadeBlocks"
      | "highResolutionPixels"
      | "highResolutionLightsPerCell"
      | "highResolutionHysteresis"
    >
  >;

/**
 * The world-space clustered light layer: selects the highest-importance
 * registered lights around the camera (deterministically, with hysteresis),
 * bins them into a camera-centered world-aligned cell grid, and packs both
 * into two small data textures every chunk material samples.
 *
 * A cell keeps the lights that light *it* best — ranked by their falloff at
 * the cell, not by distance to the camera — so walking around never changes
 * which lights a corner is lit by. Whatever does change a cell's lights (a
 * light entering or leaving the selection, a rival winning its slot, the
 * resolution gate) fades per slot over `slotFadeMs` instead of popping. Cells
 * live in toroidal storage (world cell mod dims), so a cell keeps its slots
 * and their fades while the window scrolls around it.
 *
 * All per-frame work runs on preallocated scratch; a frame in which neither
 * the registry nor the camera cell changed and nothing is fading does
 * nothing at all.
 */
export class LightClusterGrid {
  readonly uniforms = {
    lightGrid: { value: null as DataTexture | null },
    lightData: { value: null as DataTexture | null },
    gridOrigin: { value: new Vector3() },
    gridCellSize: { value: 8 },
    gridDims: { value: new Vector3() },
    /** The window origin's cell mod the dims: its storage cell, per axis. */
    gridStorageOffset: { value: new Vector3() },
    /**
     * The point the window is centred on (xyz), written every frame, and
     * the rim fade width in blocks (w). The rim fade is continuous in it, so
     * a world point's analytic light never steps when the window scrolls.
     */
    gridCenter: { value: new Vector4() },
    /** Half extent the window covers around its centre on every frame. */
    gridHalf: { value: new Vector3() },
    /** 1: the temporally stable layer. 0: the legacy frame, for A/B. */
    stable: { value: 1 },
    clusteredCount: { value: 0 },
    maskKnee: { value: 2 / 15 },
    specularStrength: { value: 1 },
    /** 0..1: how strongly analytic claims suppress the baked flood term. */
    ownership: { value: 1 },
    debugMode: { value: 0 },
    emissiveLevels: { value: new Vector4(1.0, 1.75, 2.5, 3.5) },
  };

  /** Selected registry slot per rank; `selectedCount` entries are live. */
  readonly selectedIndices: Uint32Array;
  selectedCount = 0;

  /**
   * Registry slot per packed data row: the selection in rank order, then
   * the lights that left it but are still fading out of their cells.
   */
  readonly packedIndices: Uint32Array;
  packedCount = 0;

  /**
   * Shadow-slot data source, wired by the facade once the shadow scheduler
   * exists. Null keeps every record unshadowed (Engine PR A behavior).
   */
  shadowProvider: ((index: number) => ShadowTexelRecord | null) | null = null;

  private readonly registry: LightSourceRegistry;
  private readonly gridDims: [number, number, number];
  private readonly cellCount: number;
  private readonly gridTexture: DataTexture;
  private readonly dataTexture: DataTexture;
  private readonly gridData: Uint16Array;
  private readonly lightData: Float32Array;

  private readonly heapScores: Float64Array;
  private readonly heapIndices: Uint32Array;
  private readonly sortedScores: Float64Array;
  /**
   * Generation of the light selected in the previous pass, per slot; `0` is
   * never a live generation. Keying hysteresis to the generation (not the
   * slot) keeps a freshly added light from inheriting the boost of a removed
   * one that happened to reuse its slot.
   */
  private readonly selectedGenerations: Uint16Array;
  /** Pass stamp per registry slot: the light joined the selection then. */
  private readonly entryStamps: Uint32Array;
  /** Packed row per registry slot for the current pass; -1 unpacked. */
  private readonly rowOf: Int16Array;
  /** Where each light stood when last packed, to tell motion from rivalry. */
  private readonly packedPositions: Float32Array;

  // Persistent per-slot state, `cell * MAX_LIGHTS_PER_CELL + slot`.
  private readonly slotHandles: Uint32Array;
  private readonly slotWeights: Float32Array;
  /** 1: the slot is (fading into) steady; 0: it is fading out. */
  private readonly slotTargets: Uint8Array;
  private readonly cellSlotCounts: Uint8Array;
  /** World cell each storage cell last held, to spot a scroll's new cells. */
  private readonly cellTags: Int32Array;
  private readonly isCellTagged: Uint8Array;

  // Per-pass desired membership, same layout.
  private readonly desiredLights: Int32Array;
  private readonly desiredImportances: Float32Array;
  private readonly desiredCounts: Uint8Array;
  private readonly cellStamps: Uint32Array;
  private readonly cellVisits: Uint32Array;
  private readonly touchedCells: Int32Array;
  private readonly visitedCells: Int32Array;
  private readonly occupiedCells: Int32Array;
  private occupiedCount = 0;
  private readonly activeCells: Int32Array;
  private readonly isCellActive: Uint8Array;
  private activeCount = 0;

  // One cell's reconcile scratch.
  private readonly mergeHandles = new Uint32Array(MAX_LIGHTS_PER_CELL);
  private readonly mergeWeights = new Float32Array(MAX_LIGHTS_PER_CELL);
  private readonly mergeTargets = new Uint8Array(MAX_LIGHTS_PER_CELL);
  private readonly isPreviousMatched = new Uint8Array(MAX_LIGHTS_PER_CELL);

  private maxClusteredLights: number;
  private maxLightsPerCell: number;
  private analyticRadius: number;
  private readonly selectionHysteresis: number;
  private readonly slotFadeMs: number;
  private readonly fadingRowReserve: number;
  private readonly windowFadeBlocks: number;
  private readonly highResolutionPixels: number;
  private readonly highResolutionLightsPerCell: number;
  private readonly highResolutionHysteresis: number;
  private isStable: boolean;
  private isHighResolution = false;
  /** The next pack starts every cell fresh: its lights at full weight. */
  private isResetPending = true;
  private passStamp = 0;
  private lastFadeAt = Number.NaN;

  private lastRegistryRevision = 0;
  private lastCameraCellX = Number.NaN;
  private lastCameraCellY = Number.NaN;
  private lastCameraCellZ = Number.NaN;
  private isForceDirty = true;

  constructor(registry: LightSourceRegistry, options: LightClusterGridOptions) {
    const settings = { ...defaultLocalLightsOptions, ...options };
    this.registry = registry;
    this.gridDims = [...settings.gridDims];
    this.cellCount = this.gridDims[0] * this.gridDims[1] * this.gridDims[2];
    this.maxClusteredLights = Math.min(
      settings.maxClusteredLights,
      MAX_CLUSTERED_LIGHTS,
    );
    this.maxLightsPerCell = Math.min(
      settings.maxLightsPerCell,
      MAX_LIGHTS_PER_CELL,
    );
    this.analyticRadius = settings.analyticRadius;
    this.selectionHysteresis = settings.selectionHysteresis;
    this.slotFadeMs = settings.slotFadeMs;
    this.fadingRowReserve = Math.min(
      Math.max(settings.fadingRowReserve, 0),
      MAX_CLUSTERED_LIGHTS,
    );
    this.windowFadeBlocks = Math.max(settings.windowFadeBlocks, 1e-3);
    this.highResolutionPixels = settings.highResolutionPixels;
    this.highResolutionLightsPerCell = settings.highResolutionLightsPerCell;
    this.highResolutionHysteresis = settings.highResolutionHysteresis;
    this.isStable = settings.temporalStability;

    const gridWidth = GRID_CELLS_PER_ROW * MAX_LIGHTS_PER_CELL;
    const gridHeight = Math.ceil(this.cellCount / GRID_CELLS_PER_ROW);
    this.gridData = new Uint16Array(gridWidth * gridHeight);
    this.gridTexture = new DataTexture(
      this.gridData,
      gridWidth,
      gridHeight,
      RedIntegerFormat,
      UnsignedShortType,
    );
    this.gridTexture.internalFormat = "R16UI";
    this.gridTexture.minFilter = NearestFilter;
    this.gridTexture.magFilter = NearestFilter;
    this.gridTexture.generateMipmaps = false;
    this.gridTexture.flipY = false;
    this.gridTexture.unpackAlignment = 2;

    this.lightData = new Float32Array(
      DATA_TEXELS_PER_LIGHT * 4 * MAX_CLUSTERED_LIGHTS,
    );
    this.dataTexture = new DataTexture(
      this.lightData,
      DATA_TEXELS_PER_LIGHT,
      MAX_CLUSTERED_LIGHTS,
      RGBAFormat,
      FloatType,
    );
    this.dataTexture.minFilter = NearestFilter;
    this.dataTexture.magFilter = NearestFilter;
    this.dataTexture.generateMipmaps = false;
    this.dataTexture.flipY = false;

    const cellSize = settings.gridCellSize;
    this.uniforms.lightGrid.value = this.gridTexture;
    this.uniforms.lightData.value = this.dataTexture;
    this.uniforms.gridCellSize.value = cellSize;
    this.uniforms.gridDims.value.set(...this.gridDims);
    // The window's low edge sits `dim >> 1` cells below the camera cell and
    // its high edge `dim - (dim >> 1)` above it, so whatever the camera's
    // offset inside its cell, the smaller of the two minus one cell is
    // always covered.
    const guaranteedHalf = (dim: number) =>
      Math.min(dim >> 1, dim - (dim >> 1) - 1) * cellSize;
    this.uniforms.gridHalf.value.set(
      guaranteedHalf(this.gridDims[0]),
      guaranteedHalf(this.gridDims[1]),
      guaranteedHalf(this.gridDims[2]),
    );
    this.uniforms.gridCenter.value.w = this.windowFadeBlocks;
    this.uniforms.stable.value = this.isStable ? 1 : 0;
    this.uniforms.maskKnee.value = settings.maskKnee;
    this.uniforms.specularStrength.value = settings.fluidSpecularStrength;

    this.selectedIndices = new Uint32Array(MAX_CLUSTERED_LIGHTS);
    this.packedIndices = new Uint32Array(MAX_CLUSTERED_LIGHTS);
    this.heapScores = new Float64Array(MAX_CLUSTERED_LIGHTS);
    this.heapIndices = new Uint32Array(MAX_CLUSTERED_LIGHTS);
    this.sortedScores = new Float64Array(MAX_CLUSTERED_LIGHTS);
    this.selectedGenerations = new Uint16Array(registry.capacity);
    this.entryStamps = new Uint32Array(registry.capacity);
    this.rowOf = new Int16Array(registry.capacity).fill(-1);
    this.packedPositions = new Float32Array(registry.capacity * 3);

    const slotCount = this.cellCount * MAX_LIGHTS_PER_CELL;
    this.slotHandles = new Uint32Array(slotCount);
    this.slotWeights = new Float32Array(slotCount);
    this.slotTargets = new Uint8Array(slotCount);
    this.cellSlotCounts = new Uint8Array(this.cellCount);
    this.cellTags = new Int32Array(this.cellCount * 3);
    this.isCellTagged = new Uint8Array(this.cellCount);
    this.desiredLights = new Int32Array(slotCount);
    this.desiredImportances = new Float32Array(slotCount);
    this.desiredCounts = new Uint8Array(this.cellCount);
    this.cellStamps = new Uint32Array(this.cellCount);
    this.cellVisits = new Uint32Array(this.cellCount);
    this.touchedCells = new Int32Array(this.cellCount);
    this.visitedCells = new Int32Array(this.cellCount);
    this.occupiedCells = new Int32Array(this.cellCount);
    this.activeCells = new Int32Array(this.cellCount);
    this.isCellActive = new Uint8Array(this.cellCount);
  }

  setTierCaps(caps: {
    maxClusteredLights: number;
    maxLightsPerCell: number;
    analyticRadius: number;
    fluidSpecularStrength: number;
    blockLightOwnership: number;
  }) {
    this.maxClusteredLights = Math.min(
      caps.maxClusteredLights,
      MAX_CLUSTERED_LIGHTS,
    );
    this.maxLightsPerCell = Math.min(
      caps.maxLightsPerCell,
      MAX_LIGHTS_PER_CELL,
    );
    this.analyticRadius = caps.analyticRadius;
    this.uniforms.specularStrength.value = caps.fluidSpecularStrength;
    this.uniforms.ownership.value = Math.min(
      Math.max(caps.blockLightOwnership, 0),
      1,
    );
    if (this.maxClusteredLights === 0) {
      // A zero-cap tier (off/potato) takes effect on the frame it is set:
      // the selection and the GPU grid clear synchronously, so a frame
      // rendered between this call and the next update() cannot draw the
      // stale clustered set on top of the just-restored flood term.
      this.selectedCount = 0;
      for (let row = 0; row < this.packedCount; row++) {
        this.rowOf[this.packedIndices[row]] = -1;
      }
      this.packedCount = 0;
      this.uniforms.clusteredCount.value = 0;
      this.gridData.fill(0);
      this.gridTexture.needsUpdate = true;
      this.selectedGenerations.fill(0);
      this.clearCellState();
    }
    this.isForceDirty = true;
  }

  /**
   * A camera jump larger than the analytic radius means the previous
   * selection belongs to somewhere else entirely; hysteresis must not drag
   * it across the map, and nothing there should fade in from black.
   */
  resetHysteresis() {
    this.selectedGenerations.fill(0);
    this.isResetPending = true;
    this.isForceDirty = true;
  }

  /**
   * Stable layer on (default) or the legacy frame, for A/B captures. Either
   * way the next pass rebuilds every cell from scratch.
   */
  setTemporalStability(isStable: boolean) {
    if (this.isStable === isStable) return;
    this.isStable = isStable;
    this.uniforms.stable.value = isStable ? 1 : 0;
    this.clearCellState();
    this.isForceDirty = true;
  }

  get isTemporallyStable(): boolean {
    return this.isStable;
  }

  /**
   * The drawing buffer's pixel count, fed every frame. Crossing the
   * high-resolution gate (with hysteresis) changes how many steady lights a
   * cell keeps; the cells that lose or gain one fade like any other change.
   */
  setRenderPixels(pixels: number) {
    const threshold = this.highResolutionPixels;
    const band = this.highResolutionHysteresis;
    const isHigh = this.isHighResolution
      ? pixels >= threshold * (1 - band)
      : pixels >= threshold * (1 + band);
    if (isHigh === this.isHighResolution) return;
    this.isHighResolution = isHigh;
    this.isForceDirty = true;
  }

  get isHighResolutionGate(): boolean {
    return this.isHighResolution;
  }

  /** Re-upload GPU state after a restored context; CPU data is authoritative. */
  markTexturesDirty() {
    this.gridTexture.needsUpdate = true;
    this.dataTexture.needsUpdate = true;
  }

  dispose() {
    this.gridTexture.dispose();
    this.dataTexture.dispose();
  }

  /**
   * Selection + binning + packing when the registry or the camera's grid
   * cell moved since the last pass, then this frame's slot fades.
   */
  update(
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    stats: LocalLightStats,
    nowMs = performance.now(),
  ) {
    const cellSize = this.uniforms.gridCellSize.value;
    const center = this.uniforms.gridCenter.value;
    center.x = cameraX;
    center.y = cameraY;
    center.z = cameraZ;
    const cameraCellX = Math.floor(cameraX / cellSize);
    const cameraCellY = Math.floor(cameraY / cellSize);
    const cameraCellZ = Math.floor(cameraZ / cellSize);

    const isDirty =
      this.isForceDirty ||
      this.registry.revision !== this.lastRegistryRevision ||
      cameraCellX !== this.lastCameraCellX ||
      cameraCellY !== this.lastCameraCellY ||
      cameraCellZ !== this.lastCameraCellZ;

    stats.registered = this.registry.aliveCount;
    stats.highResolution = this.isHighResolution ? 1 : 0;
    const fadeStepMs = Number.isFinite(this.lastFadeAt)
      ? Math.max(nowMs - this.lastFadeAt, 0)
      : 0;
    this.lastFadeAt = nowMs;

    if (isDirty) {
      this.isForceDirty = false;
      this.lastRegistryRevision = this.registry.revision;
      this.lastCameraCellX = cameraCellX;
      this.lastCameraCellY = cameraCellY;
      this.lastCameraCellZ = cameraCellZ;

      const originCellX = cameraCellX - (this.gridDims[0] >> 1);
      const originCellY = cameraCellY - (this.gridDims[1] >> 1);
      const originCellZ = cameraCellZ - (this.gridDims[2] >> 1);
      this.uniforms.gridOrigin.value.set(
        originCellX * cellSize,
        originCellY * cellSize,
        originCellZ * cellSize,
      );
      this.uniforms.gridStorageOffset.value.set(
        positiveMod(originCellX, this.gridDims[0]),
        positiveMod(originCellY, this.gridDims[1]),
        positiveMod(originCellZ, this.gridDims[2]),
      );

      this.passStamp = (this.passStamp + 1) >>> 0;
      if (this.passStamp === 0) {
        this.cellStamps.fill(0);
        this.cellVisits.fill(0);
        this.entryStamps.fill(0);
        this.passStamp = 1;
      }

      const selectStart = performance.now();
      this.select(cameraX, cameraY, cameraZ, stats);
      const packStart = performance.now();
      this.pack(stats);
      const end = performance.now();

      stats.selectMs = packStart - selectStart;
      stats.packMs = end - packStart;
      if (stats.selectMs > stats.selectMsPeak)
        stats.selectMsPeak = stats.selectMs;
      if (stats.packMs > stats.packMsPeak) stats.packMsPeak = stats.packMs;
      stats.clustered = this.selectedCount;
      this.uniforms.clusteredCount.value = this.packedCount;
    } else {
      stats.selectMs = 0;
      stats.packMs = 0;
    }

    if (this.activeCount > 0) this.stepFades(fadeStepMs, stats, isDirty);
  }

  /**
   * CPU mirror of the shader's light response, for entities and particles:
   * accumulates the falloff-weighted color of every light the point's cell
   * holds, scaled by each slot's fade, with the same spot/capsule shaping,
   * shader-matched flicker, and — when the caller supplies its local flood
   * level — the same occlusion mask the world surfaces use, so an entity
   * behind a wall stops tinting from the light the wall blocks. Mirrors the
   * chunk shader's per-fragment structure exactly: only lights present in
   * the point's grid cell contribute — color and claim alike — so a point
   * outside the window or in an overflowed cell keeps its flood look on
   * entities just as it does on blocks, and both the color and `out.claim`
   * (the unoccluded luminance claim that drives the flood remainder) carry
   * the same window fade the shader applies, keeping the combined block
   * light continuous across the rim. Zero allocation; the caller owns `out`
   * and may reuse one `options` scratch object across calls (`floodMask` is
   * the knee-mapped local flood level, 1 = fully open; `timeMs` drives the
   * same flicker curve the shader evaluates).
   */
  sampleIrradiance(
    point: [number, number, number],
    out: LocalLightSample,
    options?: { floodMask?: number; timeMs?: number },
  ): number {
    const [x, y, z] = point;
    const floodMask = options?.floodMask ?? 1;
    const timeMs = options?.timeMs ?? 0;
    const outColor = out.color;
    const {
      positions,
      ranges,
      colors,
      intensities,
      shares,
      flags,
      shapes,
      aux,
      flickers,
    } = this.registry;
    let contributors = 0;
    let claim = 0;

    // Cell membership, mirroring localLightCell + the fixed slot list in
    // the shader. -1 = outside the window: nothing lights or claims here.
    const origin = this.uniforms.gridOrigin.value;
    const cellSize = this.uniforms.gridCellSize.value;
    const [dimX, dimY, dimZ] = this.gridDims;
    const relX = (x - origin.x) / cellSize;
    const relY = (y - origin.y) / cellSize;
    const relZ = (z - origin.z) / cellSize;
    let gridBase = -1;
    if (
      relX >= 0 &&
      relY >= 0 &&
      relZ >= 0 &&
      relX < dimX &&
      relY < dimY &&
      relZ < dimZ
    ) {
      const offset = this.uniforms.gridStorageOffset.value;
      gridBase = this.gridBaseOf(
        (wrapCell(relZ, offset.z, dimZ) * dimY +
          wrapCell(relY, offset.y, dimY)) *
          dimX +
          wrapCell(relX, offset.x, dimX),
      );
    }
    const windowFade = this.windowFadeAt(x, y, z, relX, relY, relZ);
    const gridData = this.gridData;
    for (let s = 0; gridBase >= 0 && s < MAX_LIGHTS_PER_CELL; s++) {
      const slot = gridData[gridBase + s];
      const row = slot & SLOT_ROW_MASK;
      if (row === 0) break;
      const slotWeight = (slot >> SLOT_WEIGHT_SHIFT) / SLOT_WEIGHT_SCALE;
      const i = this.packedIndices[row - 1];

      let ox = positions[i * 3];
      let oy = positions[i * 3 + 1];
      let oz = positions[i * 3 + 2];
      if (shapes[i] === LIGHT_SHAPE_CAPSULE) {
        const axx = aux[i * 4];
        const axy = aux[i * 4 + 1];
        const axz = aux[i * 4 + 2];
        const len2 = Math.max(axx * axx + axy * axy + axz * axz, 1e-6);
        const t = Math.min(
          Math.max(
            ((x - ox) * axx + (y - oy) * axy + (z - oz) * axz) / len2,
            0,
          ),
          1,
        );
        ox += axx * t;
        oy += axy * t;
        oz += axz * t;
      }

      const dx = ox - x;
      const dy = oy - y;
      const dz = oz - z;
      const range = ranges[i];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= range * range) continue;
      const dist = Math.sqrt(Math.max(d2, 1e-6));
      const falloff = localLightFalloff(dist, range);

      let angular = 1;
      if (shapes[i] === LIGHT_SHAPE_SPOT) {
        // -L · spotDir against the cone edges, matching the shader.
        const cos =
          (-dx / dist) * aux[i * 4] +
          (-dy / dist) * aux[i * 4 + 1] +
          (-dz / dist) * aux[i * 4 + 2];
        angular = Math.min(
          Math.max((cos - aux[i * 4 + 3]) * flickers[i * 4 + 3], 0),
          1,
        );
        angular *= angular;
        if (angular <= 0) continue;
      }

      // Unoccluded claim: falloff, cone shaping and the slot's fade — no
      // flicker, no occlusion. Accumulated before the occlusion continue,
      // because a wall-blocked light still owns its coverage: the baked
      // flood term must not refill the side the analytic model keeps dark.
      claim +=
        slotWeight *
        intensities[i] *
        shares[i] *
        falloff *
        angular *
        (colors[i * 3] * LUMA_R +
          colors[i * 3 + 1] * LUMA_G +
          colors[i * 3 + 2] * LUMA_B);

      let flicker = 1;
      if (flags[i] & LIGHT_FLAG_FLICKER) {
        const t = timeMs * 0.001 * flickers[i * 4] * 6.28318;
        const phase = flickers[i * 4 + 2];
        const wobble =
          Math.sin(t + phase) * Math.sin(t * 0.531 + phase * 1.7) * 0.5 + 0.5;
        flicker = 1 - flickers[i * 4 + 1] * wobble;
      }

      // Masked lights (and shadow-requesting statics, whose atlas map the
      // CPU cannot read) use the flood mask as their occlusion term.
      let occlusion = 1;
      if (
        flags[i] & LIGHT_FLAG_MASKED ||
        (flags[i] & LIGHT_FLAG_SHADOW_REQUEST && flags[i] & LIGHT_FLAG_STATIC)
      ) {
        occlusion = floodMask;
      }
      if (occlusion <= 0) continue;

      const energy =
        slotWeight *
        intensities[i] *
        shares[i] *
        falloff *
        angular *
        flicker *
        occlusion;
      outColor[0] += colors[i * 3] * energy;
      outColor[1] += colors[i * 3 + 1] * energy;
      outColor[2] += colors[i * 3 + 2] * energy;
      contributors++;
    }
    // The analytic tint rides the same window fade the shader applies to
    // fragments; the claim stays unfaded and the fade is reported alongside
    // it, so consumers reproduce the shader's exact crossfade
    // (blockLightFloodRemainder mixes the owned remainder toward 1 by it)
    // and an entity's combined block light stays continuous across the rim
    // exactly like the ground under it.
    outColor[0] *= windowFade;
    outColor[1] *= windowFade;
    outColor[2] *= windowFade;
    out.count = contributors;
    out.claim = claim;
    out.windowFade = windowFade;
    return contributors;
  }

  /**
   * Rewrite only the shadow-facing data (flags bit 2 + texels 4–5) of every
   * packed record. Runs when shadow slots change on a frame where the main
   * pack did not — a ≤ 32 KB re-upload, counted in stats.
   */
  refreshShadowTexels(stats: LocalLightStats): void {
    for (let row = 0; row < this.packedCount; row++) {
      this.writeShadowTexels(row, this.packedIndices[row]);
    }
    this.dataTexture.needsUpdate = true;
    stats.dataTextureUploads++;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Mirrors `localLightWindowFade` in shader.ts. */
  private windowFadeAt(
    x: number,
    y: number,
    z: number,
    relX: number,
    relY: number,
    relZ: number,
  ): number {
    if (this.isStable) {
      const center = this.uniforms.gridCenter.value;
      const half = this.uniforms.gridHalf.value;
      const edge = Math.min(
        half.x - Math.abs(x - center.x),
        half.y - Math.abs(y - center.y),
        half.z - Math.abs(z - center.z),
      );
      return Math.min(Math.max(edge / center.w, 0), 1);
    }
    // Legacy: the fade steps with the window, which snaps in whole cells.
    const [dimX, dimY, dimZ] = this.gridDims;
    const edgeCells = Math.min(
      Math.min(relX, dimX - relX),
      Math.min(Math.min(relY, dimY - relY), Math.min(relZ, dimZ - relZ)),
    );
    return Math.min(Math.max(edgeCells * 0.5, 0), 1);
  }

  /** Toroidal storage cell of a world cell, mirroring `localLightCell`. */
  private storageIndex(cellX: number, cellY: number, cellZ: number): number {
    const [dimX, dimY, dimZ] = this.gridDims;
    return (
      (positiveMod(cellZ, dimZ) * dimY + positiveMod(cellY, dimY)) * dimX +
      positiveMod(cellX, dimX)
    );
  }

  private gridBaseOf(cell: number): number {
    return (
      (cell >> 5) * (GRID_CELLS_PER_ROW * MAX_LIGHTS_PER_CELL) +
      (cell & 31) * MAX_LIGHTS_PER_CELL
    );
  }

  /** Steady lights a cell may keep this frame. */
  private slotCap(): number {
    if (this.isStable && this.isHighResolution) {
      return Math.min(this.maxLightsPerCell, this.highResolutionLightsPerCell);
    }
    return this.maxLightsPerCell;
  }

  private clearCellState() {
    this.cellSlotCounts.fill(0);
    this.isCellTagged.fill(0);
    this.isCellActive.fill(0);
    this.activeCount = 0;
    // Forgetting which cells are occupied means no pass will revisit them:
    // their texels must go now, or they keep row numbers that the next
    // pass hands to other lights.
    this.occupiedCount = 0;
    this.gridData.fill(0);
    this.gridTexture.needsUpdate = true;
    this.isResetPending = true;
  }

  private encodeWeight(weight: number): number {
    if (!this.isStable) return SLOT_WEIGHT_SCALE;
    // Smoothstep: a fade eases in and out instead of starting and stopping
    // abruptly, and a crossfade's two sides still sum to one.
    const eased = weight * weight * (3 - 2 * weight);
    return Math.round(eased * SLOT_WEIGHT_SCALE);
  }

  private writeShadowTexels(row: number, i: number): void {
    const data = this.lightData;
    const base = row * DATA_TEXELS_PER_LIGHT * 4;
    const registryFlags = this.registry.flags[i];
    const record = this.shadowProvider ? this.shadowProvider(i) : null;
    const hasShadowData =
      record !== null &&
      record.slot >= 0 &&
      (record.staticMask | record.dynamicMask) !== 0;

    let packed =
      (registryFlags & LIGHT_FLAG_FLICKER ? PACKED_FLAG_FLICKER : 0) |
      (this.registry.shapes[i] << 4);
    if (hasShadowData) {
      packed |= PACKED_FLAG_SHADOWED;
    }
    if (
      registryFlags & LIGHT_FLAG_MASKED ||
      (registryFlags & LIGHT_FLAG_SHADOW_REQUEST &&
        registryFlags & LIGHT_FLAG_STATIC)
    ) {
      // A static light that wants (or is still waiting for) a shadow slot
      // leans on the flood mask instead of leaking — and the bit stays set
      // for holders too: passes that cannot afford the atlas sampler (fluid
      // specular) occlude by the mask alone, while the diffuse ladder
      // COMPOSES the per-light atlas on top of it. The mask floor is what
      // keeps a holder's unmapped faces (mount-skipped, or FIFO-pending)
      // from pouring unoccluded light through the very block they are
      // mounted against.
      packed |= PACKED_FLAG_MASKED;
    }
    data[base + 7] = packed;

    if (hasShadowData && record) {
      data[base + 16] = record.slot;
      data[base + 17] = record.staticMask;
      data[base + 18] = record.dynamicMask;
      data[base + 19] = record.near;
      data[base + 20] = record.far;
      data[base + 21] = record.tanHalf;
      data[base + 22] = record.weight;
      data[base + 23] = 0;
    } else {
      data[base + 16] = -1;
      data[base + 17] = 0;
      data[base + 18] = 0;
      data[base + 19] = 0;
      data[base + 20] = 0;
      data[base + 21] = 0;
      data[base + 22] = 0;
      data[base + 23] = 0;
    }
  }

  private select(
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    stats: LocalLightStats,
  ) {
    const {
      aliveIndices,
      aliveCount,
      positions,
      ranges,
      colors,
      intensities,
      priorityBiases,
      shares,
    } = this.registry;
    const radius = this.analyticRadius;
    // The stable layer keeps rows free for lights fading out of the
    // selection; the legacy frame spends every row on the selection.
    const limit = this.isStable
      ? Math.min(
          this.maxClusteredLights,
          MAX_CLUSTERED_LIGHTS - this.fadingRowReserve,
        )
      : this.maxClusteredLights;
    const cellSize = this.uniforms.gridCellSize.value;
    // Candidates must be able to touch both the analytic radius and the
    // exact cell-aligned window the binning and the shader use (the vertical
    // span is deliberately shorter than the horizontal): a light outside it
    // could never be binned, so selecting it would waste a slot.
    const origin = this.uniforms.gridOrigin.value;
    const lowX = Math.max(origin.x, cameraX - radius);
    const lowY = Math.max(origin.y, cameraY - radius);
    const lowZ = Math.max(origin.z, cameraZ - radius);
    const highX = Math.min(
      origin.x + this.gridDims[0] * cellSize,
      cameraX + radius,
    );
    const highY = Math.min(
      origin.y + this.gridDims[1] * cellSize,
      cameraY + radius,
    );
    const highZ = Math.min(
      origin.z + this.gridDims[2] * cellSize,
      cameraZ + radius,
    );
    const heapScores = this.heapScores;
    const heapIndices = this.heapIndices;
    let heapSize = 0;
    let candidates = 0;

    for (let k = 0; k < aliveCount; k++) {
      const i = aliveIndices[k];
      if (!this.registry.isEnabledAt(i)) continue;
      // Inert records (analyticShare 0) stay in the registry so a dense
      // strip field does not fall back to per-block defaults, but they
      // contribute no clustered energy. Selecting them still occupies a
      // cell slot and a shader loop iteration — and a strip proxy's huge
      // range then overflows every nearby cell, crowding out real lights.
      if (shares[i] <= 0) continue;
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const range = ranges[i];
      if (
        px < lowX - range ||
        px > highX + range ||
        py < lowY - range ||
        py > highY + range ||
        pz < lowZ - range ||
        pz > highZ + range
      ) {
        continue;
      }
      const dx = px - cameraX;
      const dy = py - cameraY;
      const dz = pz - cameraZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      candidates++;
      if (limit <= 0) continue;

      const luma =
        intensities[i] *
        (colors[i * 3] * LUMA_R +
          colors[i * 3 + 1] * LUMA_G +
          colors[i * 3 + 2] * LUMA_B);
      let score = (luma * range * range) / Math.max(d2, 1) + priorityBiases[i];
      if (this.selectedGenerations[i] === this.registry.generationAt(i)) {
        score *= this.selectionHysteresis;
      }

      if (heapSize < limit) {
        heapScores[heapSize] = score;
        heapIndices[heapSize] = i;
        heapSize++;
        if (heapSize === limit) {
          // Heapify once when full; cheaper than sift-up per insert.
          for (let n = (heapSize >> 1) - 1; n >= 0; n--) {
            this.siftDown(n, heapSize);
          }
        }
      } else if (
        score > heapScores[0] ||
        (score === heapScores[0] && i < heapIndices[0])
      ) {
        heapScores[0] = score;
        heapIndices[0] = i;
        this.siftDown(0, heapSize);
      }
    }

    stats.candidates = candidates;

    // Rank selected lights by (score desc, slot asc): data rows follow the
    // rank, so it must be deterministic.
    const count = heapSize;
    const selected = this.selectedIndices;
    const sortedScores = this.sortedScores;
    for (let n = 0; n < count; n++) {
      selected[n] = heapIndices[n];
      sortedScores[n] = heapScores[n];
    }
    for (let a = 1; a < count; a++) {
      const index = selected[a];
      const score = sortedScores[a];
      let b = a - 1;
      while (
        b >= 0 &&
        (sortedScores[b] < score ||
          (sortedScores[b] === score && selected[b] > index))
      ) {
        selected[b + 1] = selected[b];
        sortedScores[b + 1] = sortedScores[b];
        b--;
      }
      selected[b + 1] = index;
      sortedScores[b + 1] = score;
    }

    let churn = 0;
    const selectedGenerations = this.selectedGenerations;
    for (let n = 0; n < count; n++) {
      const i = selected[n];
      if (selectedGenerations[i] !== this.registry.generationAt(i)) {
        churn++;
        this.entryStamps[i] = this.passStamp;
      }
    }
    let previousCount = 0;
    for (let k = 0; k < aliveCount; k++) {
      const i = aliveIndices[k];
      if (selectedGenerations[i] === this.registry.generationAt(i)) {
        previousCount++;
      }
    }
    churn += Math.max(previousCount - (count - churn), 0);
    stats.selectionChurn = churn;

    selectedGenerations.fill(0);
    for (let n = 0; n < count; n++) {
      const i = selected[n];
      selectedGenerations[i] = this.registry.generationAt(i);
    }

    this.selectedCount = count;
  }

  private siftDown(node: number, size: number) {
    const scores = this.heapScores;
    const indices = this.heapIndices;
    for (;;) {
      const left = node * 2 + 1;
      if (left >= size) return;
      const right = left + 1;
      // The "smallest" element sits at the root: lower score, or equal
      // score with the higher slot index (so ties evict the later handle).
      let smallest = left;
      if (
        right < size &&
        (scores[right] < scores[left] ||
          (scores[right] === scores[left] && indices[right] > indices[left]))
      ) {
        smallest = right;
      }
      if (
        scores[smallest] > scores[node] ||
        (scores[smallest] === scores[node] && indices[smallest] < indices[node])
      ) {
        return;
      }
      const score = scores[node];
      const index = indices[node];
      scores[node] = scores[smallest];
      indices[node] = indices[smallest];
      scores[smallest] = score;
      indices[smallest] = index;
      node = smallest;
    }
  }

  private pack(stats: LocalLightStats) {
    const registry = this.registry;
    const {
      positions,
      ranges,
      colors,
      intensities,
      shares,
      shapes,
      aux,
      flickers,
    } = registry;
    const [dimX, dimY, dimZ] = this.gridDims;
    const cellSize = this.uniforms.gridCellSize.value;
    const origin = this.uniforms.gridOrigin.value;
    const originX = Math.round(origin.x / cellSize);
    const originY = Math.round(origin.y / cellSize);
    const originZ = Math.round(origin.z / cellSize);
    const isStable = this.isStable;
    // The legacy frame is stateless: every pass rebuilds every cell.
    const isReset = this.isResetPending || !isStable;
    this.isResetPending = false;
    const stamp = this.passStamp;
    const slotCap = this.slotCap();
    const cellStamps = this.cellStamps;
    const desiredCounts = this.desiredCounts;
    let touchedCount = 0;
    let overflowed = 0;

    // 1. Desired membership: each selected light offers itself to every
    // cell it reaches, and each cell keeps its `slotCap` most important
    // offers. Importance is the light's falloff at the cell, independent of
    // the camera, so the camera moving never reorders a cell. The legacy
    // frame ranks by selection score instead (camera distance): its first
    // `slotCap` ranks win.
    for (let rank = 0; rank < this.selectedCount; rank++) {
      const i = this.selectedIndices[rank];
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const range = ranges[i];
      const isCapsule = shapes[i] === LIGHT_SHAPE_CAPSULE;

      let minX = px - range;
      let minY = py - range;
      let minZ = pz - range;
      let maxX = px + range;
      let maxY = py + range;
      let maxZ = pz + range;
      // A capsule reaches from both endpoints; grow the cell AABB to cover
      // the far end as well.
      if (isCapsule) {
        const ex = px + aux[i * 4];
        const ey = py + aux[i * 4 + 1];
        const ez = pz + aux[i * 4 + 2];
        minX = Math.min(minX, ex - range);
        minY = Math.min(minY, ey - range);
        minZ = Math.min(minZ, ez - range);
        maxX = Math.max(maxX, ex + range);
        maxY = Math.max(maxY, ey + range);
        maxZ = Math.max(maxZ, ez + range);
      }
      const cellMinX = Math.max(Math.floor(minX / cellSize), originX);
      const cellMinY = Math.max(Math.floor(minY / cellSize), originY);
      const cellMinZ = Math.max(Math.floor(minZ / cellSize), originZ);
      const cellMaxX = Math.min(
        Math.floor(maxX / cellSize),
        originX + dimX - 1,
      );
      const cellMaxY = Math.min(
        Math.floor(maxY / cellSize),
        originY + dimY - 1,
      );
      const cellMaxZ = Math.min(
        Math.floor(maxZ / cellSize),
        originZ + dimZ - 1,
      );

      const energy =
        intensities[i] *
        shares[i] *
        (colors[i * 3] * LUMA_R +
          colors[i * 3 + 1] * LUMA_G +
          colors[i * 3 + 2] * LUMA_B);
      // Cells the sphere misses entirely are skipped: they would spend a
      // slot on a light that contributes nothing there.
      const isReachTested = isStable && !isCapsule;
      const rangeSq = range * range;
      const legacyImportance = MAX_CLUSTERED_LIGHTS - rank;

      for (let cz = cellMinZ; cz <= cellMaxZ; cz++) {
        const dz = spanDistance(pz, cz * cellSize, cellSize);
        const sz = positiveMod(cz, dimZ);
        for (let cy = cellMinY; cy <= cellMaxY; cy++) {
          const dy = spanDistance(py, cy * cellSize, cellSize);
          const sy = positiveMod(cy, dimY);
          for (let cx = cellMinX; cx <= cellMaxX; cx++) {
            const dx = spanDistance(px, cx * cellSize, cellSize);
            const d2 = dx * dx + dy * dy + dz * dz;
            if (isReachTested && d2 >= rangeSq) continue;
            const cell = (sz * dimY + sy) * dimX + positiveMod(cx, dimX);
            if (cellStamps[cell] !== stamp) {
              cellStamps[cell] = stamp;
              desiredCounts[cell] = 0;
              this.touchedCells[touchedCount++] = cell;
            }
            const importance = isStable
              ? energy * localLightFalloff(Math.sqrt(d2), range)
              : legacyImportance;
            overflowed += this.offerToCell(cell, i, importance, slotCap);
          }
        }
      }
    }

    // 2. Reconcile every cell touched this pass or holding slots from the
    // last one against its desired membership.
    const cellVisits = this.cellVisits;
    let visitedCount = 0;
    for (let t = 0; t < touchedCount; t++) {
      const cell = this.touchedCells[t];
      cellVisits[cell] = stamp;
      this.visitedCells[visitedCount++] = cell;
    }
    for (let o = 0; o < this.occupiedCount; o++) {
      const cell = this.occupiedCells[o];
      if (cellVisits[cell] === stamp) continue;
      cellVisits[cell] = stamp;
      this.visitedCells[visitedCount++] = cell;
    }
    let occupiedCount = 0;
    for (let v = 0; v < visitedCount; v++) {
      const cell = this.visitedCells[v];
      this.reconcileCell(cell, isReset, originX, originY, originZ);
      if (this.cellSlotCounts[cell] > 0) {
        this.occupiedCells[occupiedCount++] = cell;
      }
    }
    this.occupiedCount = occupiedCount;

    // 3. Rows: the selection in rank order, then every light that left it
    // but still fades out of some cell.
    const rowOf = this.rowOf;
    for (let row = 0; row < this.packedCount; row++) {
      rowOf[this.packedIndices[row]] = -1;
    }
    for (let rank = 0; rank < this.selectedCount; rank++) {
      const i = this.selectedIndices[rank];
      rowOf[i] = rank;
      this.packedIndices[rank] = i;
    }
    let packedCount = this.selectedCount;
    let fadingLights = 0;
    let fadingSlots = 0;
    for (let o = 0; o < occupiedCount; o++) {
      const cell = this.occupiedCells[o];
      const base = cell * MAX_LIGHTS_PER_CELL;
      let count = this.cellSlotCounts[cell];
      for (let k = 0; k < count; k++) {
        const target = this.slotTargets[base + k];
        if (this.slotWeights[base + k] !== target) fadingSlots++;
        if (target === 1) continue;
        const i = lightHandleIndex(this.slotHandles[base + k]);
        if (rowOf[i] >= 0) continue;
        if (packedCount < MAX_CLUSTERED_LIGHTS) {
          rowOf[i] = packedCount;
          this.packedIndices[packedCount++] = i;
          fadingLights++;
          continue;
        }
        // Every row is taken: this fade ends here.
        for (let m = k; m < count - 1; m++) {
          this.slotHandles[base + m] = this.slotHandles[base + m + 1];
          this.slotWeights[base + m] = this.slotWeights[base + m + 1];
          this.slotTargets[base + m] = this.slotTargets[base + m + 1];
        }
        count--;
        k--;
      }
      this.cellSlotCounts[cell] = count;
    }
    this.packedCount = packedCount;

    // 4. Grid texels for every visited cell (cleared cells write zeros).
    for (let v = 0; v < visitedCount; v++) {
      this.writeCellSlots(this.visitedCells[v]);
    }

    // 5. Light records.
    const data = this.lightData;
    for (let row = 0; row < packedCount; row++) {
      const i = this.packedIndices[row];
      const base = row * DATA_TEXELS_PER_LIGHT * 4;
      const energy = intensities[i] * shares[i];
      data[base] = positions[i * 3];
      data[base + 1] = positions[i * 3 + 1];
      data[base + 2] = positions[i * 3 + 2];
      data[base + 3] = ranges[i];
      data[base + 4] = colors[i * 3] * energy;
      data[base + 5] = colors[i * 3 + 1] * energy;
      data[base + 6] = colors[i * 3 + 2] * energy;
      data[base + 7] = 0; // flags land in writeShadowTexels below
      data[base + 8] = aux[i * 4];
      data[base + 9] = aux[i * 4 + 1];
      data[base + 10] = aux[i * 4 + 2];
      data[base + 11] = aux[i * 4 + 3];
      data[base + 12] = flickers[i * 4];
      data[base + 13] = flickers[i * 4 + 1];
      data[base + 14] = flickers[i * 4 + 2];
      data[base + 15] = flickers[i * 4 + 3];
      this.writeShadowTexels(row, i);
      this.packedPositions[i * 3] = positions[i * 3];
      this.packedPositions[i * 3 + 1] = positions[i * 3 + 1];
      this.packedPositions[i * 3 + 2] = positions[i * 3 + 2];
    }

    stats.cellsOverflowed = overflowed;
    stats.fadingSlots = fadingSlots;
    stats.fadingLights = fadingLights;
    this.gridTexture.needsUpdate = true;
    this.dataTexture.needsUpdate = true;
    stats.gridTextureUploads++;
    stats.dataTextureUploads++;
  }

  /**
   * Offer a light to a cell's desired list (importance descending, ties to
   * the lower registry slot, so the order never depends on the camera).
   * Returns 1 when a light fell off a full list.
   */
  private offerToCell(
    cell: number,
    i: number,
    importance: number,
    cap: number,
  ): number {
    if (cap <= 0) return 1;
    const base = cell * MAX_LIGHTS_PER_CELL;
    const lights = this.desiredLights;
    const importances = this.desiredImportances;
    const count = this.desiredCounts[cell];
    let at = count;
    while (at > 0) {
      const above = importances[base + at - 1];
      if (
        above > importance ||
        (above === importance && lights[base + at - 1] < i)
      ) {
        break;
      }
      at--;
    }
    if (at >= cap) return 1;
    for (let k = Math.min(count, cap - 1); k > at; k--) {
      lights[base + k] = lights[base + k - 1];
      importances[base + k] = importances[base + k - 1];
    }
    lights[base + at] = i;
    importances[base + at] = importance;
    if (count < cap) {
      this.desiredCounts[cell] = count + 1;
      return 0;
    }
    return 1;
  }

  /**
   * One cell's new slot list: its desired lights (keeping the weight of any
   * it already held), then the lights it held that are still alive and
   * still reach it but lost their place, fading out from where they were.
   */
  private reconcileCell(
    cell: number,
    isReset: boolean,
    originX: number,
    originY: number,
    originZ: number,
  ) {
    const [dimX, dimY, dimZ] = this.gridDims;
    const storageX = cell % dimX;
    const storageY = Math.floor(cell / dimX) % dimY;
    const storageZ = Math.floor(cell / (dimX * dimY));
    const cellX = originX + positiveMod(storageX - originX, dimX);
    const cellY = originY + positiveMod(storageY - originY, dimY);
    const cellZ = originZ + positiveMod(storageZ - originZ, dimZ);
    const tags = this.cellTags;
    const tagBase = cell * 3;
    // A cell the window just scrolled onto (or any cell after a reset)
    // starts fresh: what the storage held belonged to another world cell.
    const isFresh =
      isReset ||
      this.isCellTagged[cell] === 0 ||
      tags[tagBase] !== cellX ||
      tags[tagBase + 1] !== cellY ||
      tags[tagBase + 2] !== cellZ;
    if (isFresh) {
      tags[tagBase] = cellX;
      tags[tagBase + 1] = cellY;
      tags[tagBase + 2] = cellZ;
      this.isCellTagged[cell] = 1;
    }

    const base = cell * MAX_LIGHTS_PER_CELL;
    const previous = isFresh ? 0 : this.cellSlotCounts[cell];
    const desired =
      this.cellStamps[cell] === this.passStamp ? this.desiredCounts[cell] : 0;
    const matched = this.isPreviousMatched;
    matched.fill(0);
    const handles = this.mergeHandles;
    const weights = this.mergeWeights;
    const targets = this.mergeTargets;
    let count = 0;

    for (let d = 0; d < desired; d++) {
      const i = this.desiredLights[base + d];
      const handle = this.registry.handleAt(i);
      let weight = -1;
      for (let k = 0; k < previous; k++) {
        if (matched[k] === 0 && this.slotHandles[base + k] === handle) {
          matched[k] = 1;
          weight = this.slotWeights[base + k];
          break;
        }
      }
      if (weight < 0) weight = this.entryWeight(i, isFresh);
      handles[count] = handle;
      weights[count] = weight;
      targets[count] = 1;
      count++;
    }

    if (this.isStable) {
      const registry = this.registry;
      for (let k = 0; k < previous && count < MAX_LIGHTS_PER_CELL; k++) {
        if (matched[k] === 1) continue;
        const weight = this.slotWeights[base + k];
        if (weight <= 0) continue;
        const handle = this.slotHandles[base + k];
        const i = registry.resolve(handle);
        // Gone or switched off: the source itself vanished, so does its light.
        if (i < 0 || !registry.isEnabledAt(i) || registry.shares[i] <= 0) {
          continue;
        }
        // Moved out of reach: it contributes nothing here any more.
        if (!this.reachesCell(i, cellX, cellY, cellZ)) continue;
        handles[count] = handle;
        weights[count] = weight;
        targets[count] = 0;
        count++;
      }
    }

    let isFading = false;
    for (let k = 0; k < count; k++) {
      this.slotHandles[base + k] = handles[k];
      this.slotWeights[base + k] = weights[k];
      this.slotTargets[base + k] = targets[k];
      if (weights[k] !== targets[k]) isFading = true;
    }
    this.cellSlotCounts[cell] = count;
    if (isFading && this.isCellActive[cell] === 0) {
      this.isCellActive[cell] = 1;
      this.activeCells[this.activeCount++] = cell;
    }
  }

  /** Starting weight of a light new to a cell. */
  private entryWeight(i: number, isFresh: boolean): number {
    if (!this.isStable || isFresh) return 1;
    // New to the selection: fade in.
    if (this.entryStamps[i] === this.passStamp) return 0;
    // A light that moved carries its light with it into the cell.
    if (
      this.packedPositions[i * 3] !== this.registry.positions[i * 3] ||
      this.packedPositions[i * 3 + 1] !== this.registry.positions[i * 3 + 1] ||
      this.packedPositions[i * 3 + 2] !== this.registry.positions[i * 3 + 2]
    ) {
      return 1;
    }
    // Otherwise it already reached this cell and just won its place (a
    // rival left, or the cell's cap grew): fade in.
    return 0;
  }

  private reachesCell(
    i: number,
    cellX: number,
    cellY: number,
    cellZ: number,
  ): boolean {
    const { positions, ranges, shapes } = this.registry;
    if (shapes[i] === LIGHT_SHAPE_CAPSULE) return true;
    const cellSize = this.uniforms.gridCellSize.value;
    const range = ranges[i];
    const dx = spanDistance(positions[i * 3], cellX * cellSize, cellSize);
    const dy = spanDistance(positions[i * 3 + 1], cellY * cellSize, cellSize);
    const dz = spanDistance(positions[i * 3 + 2], cellZ * cellSize, cellSize);
    return dx * dx + dy * dy + dz * dz < range * range;
  }

  private writeCellSlots(cell: number) {
    const gridBase = this.gridBaseOf(cell);
    const base = cell * MAX_LIGHTS_PER_CELL;
    const count = this.cellSlotCounts[cell];
    for (let k = 0; k < MAX_LIGHTS_PER_CELL; k++) {
      if (k >= count) {
        this.gridData[gridBase + k] = 0;
        continue;
      }
      const row = this.rowOf[lightHandleIndex(this.slotHandles[base + k])];
      this.gridData[gridBase + k] =
        (row + 1) |
        (this.encodeWeight(this.slotWeights[base + k]) << SLOT_WEIGHT_SHIFT);
    }
  }

  /** Advance every fading slot by one frame, dropping finished fade-outs. */
  private stepFades(
    dtMs: number,
    stats: LocalLightStats,
    hasUploaded: boolean,
  ) {
    const step = this.slotFadeMs > 0 ? dtMs / this.slotFadeMs : 1;
    let fadingSlots = 0;
    let a = 0;
    while (a < this.activeCount) {
      const cell = this.activeCells[a];
      const base = cell * MAX_LIGHTS_PER_CELL;
      const count = this.cellSlotCounts[cell];
      let kept = 0;
      for (let k = 0; k < count; k++) {
        const target = this.slotTargets[base + k];
        const weight =
          target === 1
            ? Math.min(this.slotWeights[base + k] + step, 1)
            : Math.max(this.slotWeights[base + k] - step, 0);
        if (target === 0 && weight <= 0) continue;
        if (kept !== k) {
          this.slotHandles[base + kept] = this.slotHandles[base + k];
          this.slotTargets[base + kept] = target;
        }
        this.slotWeights[base + kept] = weight;
        if (weight !== target) fadingSlots++;
        kept++;
      }
      this.cellSlotCounts[cell] = kept;
      this.writeCellSlots(cell);
      let isFading = false;
      for (let k = 0; k < kept; k++) {
        if (this.slotWeights[base + k] !== this.slotTargets[base + k]) {
          isFading = true;
          break;
        }
      }
      if (isFading) {
        a++;
      } else {
        this.isCellActive[cell] = 0;
        this.activeCells[a] = this.activeCells[--this.activeCount];
      }
    }
    stats.fadingSlots = fadingSlots;
    this.gridTexture.needsUpdate = true;
    if (!hasUploaded) stats.gridTextureUploads++;
  }
}
