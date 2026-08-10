import {
  DataTexture,
  FloatType,
  NearestFilter,
  RedIntegerFormat,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  Vector4,
} from "three";

import {
  LIGHT_FLAG_FLICKER,
  LIGHT_FLAG_MASKED,
  LIGHT_FLAG_SHADOW_REQUEST,
  LIGHT_FLAG_STATIC,
  LIGHT_SHAPE_CAPSULE,
  LIGHT_SHAPE_SPOT,
  LightSourceRegistry,
} from "./registry";
import type { ShadowTexelRecord } from "./shadow-scheduler";
import { LocalLightSample, LocalLightStats } from "./types";

/**
 * Compile-time slot count of the shader loop. Quality tiers cap how many
 * slots the CPU fills, never this constant, so no tier change recompiles.
 */
export const MAX_LIGHTS_PER_CELL = 8;

/** Grid cells per texture row; with 8 slots each, rows are 256 texels wide. */
export const GRID_CELLS_PER_ROW = 32;

/** Hard ceiling of the clustered set: grid slots hold `rank + 1` in a byte. */
export const MAX_CLUSTERED_LIGHTS = 255;

/**
 * Texels per packed light record: position/range, color/flags, aux, flicker,
 * plus two shadow texels (slot/masks/near, far/tanHalf) that stay zero for
 * unshadowed lights. Widening the record keeps shadow parameters inside the
 * one existing data texture instead of spending another texture unit.
 */
const DATA_TEXELS_PER_LIGHT = 6;

/** Shader-facing flag bits packed into texel 1's `w` (mirrored in shader.ts). */
export const PACKED_FLAG_MASKED = 1;
export const PACKED_FLAG_FLICKER = 2;
export const PACKED_FLAG_SHADOWED = 4;

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * The world-space clustered light layer: selects the highest-importance
 * registered lights around the camera (deterministically, with hysteresis),
 * bins them into a camera-centered world-aligned cell grid, and packs both
 * into two small data textures every chunk material samples.
 *
 * All per-frame work runs on preallocated scratch; a frame in which neither
 * the registry nor the camera cell changed does nothing at all.
 */
export class LightClusterGrid {
  readonly uniforms = {
    lightGrid: { value: null as DataTexture | null },
    lightData: { value: null as DataTexture | null },
    gridOrigin: { value: new Vector3() },
    gridCellSize: { value: 8 },
    gridDims: { value: new Vector3() },
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
   * Shadow-slot data source, wired by the facade once the shadow scheduler
   * exists. Null keeps every record unshadowed (Engine PR A behavior).
   */
  shadowProvider: ((index: number) => ShadowTexelRecord | null) | null = null;

  private readonly registry: LightSourceRegistry;
  private readonly gridDims: [number, number, number];
  private readonly cellCount: number;
  private readonly gridTexture: DataTexture;
  private readonly dataTexture: DataTexture;
  private readonly gridData: Uint8Array;
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

  private maxClusteredLights: number;
  private maxLightsPerCell: number;
  private analyticRadius: number;
  private readonly selectionHysteresis: number;

  private lastRegistryRevision = 0;
  private lastCameraCellX = Number.NaN;
  private lastCameraCellY = Number.NaN;
  private lastCameraCellZ = Number.NaN;
  private isForceDirty = true;

  constructor(
    registry: LightSourceRegistry,
    options: {
      gridCellSize: number;
      gridDims: [number, number, number];
      maxClusteredLights: number;
      maxLightsPerCell: number;
      analyticRadius: number;
      selectionHysteresis: number;
      maskKnee: number;
      fluidSpecularStrength: number;
    },
  ) {
    this.registry = registry;
    this.gridDims = [...options.gridDims];
    this.cellCount = this.gridDims[0] * this.gridDims[1] * this.gridDims[2];
    this.maxClusteredLights = Math.min(
      options.maxClusteredLights,
      MAX_CLUSTERED_LIGHTS,
    );
    this.maxLightsPerCell = Math.min(
      options.maxLightsPerCell,
      MAX_LIGHTS_PER_CELL,
    );
    this.analyticRadius = options.analyticRadius;
    this.selectionHysteresis = options.selectionHysteresis;

    const gridWidth = GRID_CELLS_PER_ROW * MAX_LIGHTS_PER_CELL;
    const gridHeight = Math.ceil(this.cellCount / GRID_CELLS_PER_ROW);
    this.gridData = new Uint8Array(gridWidth * gridHeight);
    this.gridTexture = new DataTexture(
      this.gridData,
      gridWidth,
      gridHeight,
      RedIntegerFormat,
      UnsignedByteType,
    );
    this.gridTexture.internalFormat = "R8UI";
    this.gridTexture.minFilter = NearestFilter;
    this.gridTexture.magFilter = NearestFilter;
    this.gridTexture.generateMipmaps = false;
    this.gridTexture.flipY = false;
    this.gridTexture.unpackAlignment = 1;

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

    this.uniforms.lightGrid.value = this.gridTexture;
    this.uniforms.lightData.value = this.dataTexture;
    this.uniforms.gridCellSize.value = options.gridCellSize;
    this.uniforms.gridDims.value.set(...this.gridDims);
    this.uniforms.maskKnee.value = options.maskKnee;
    this.uniforms.specularStrength.value = options.fluidSpecularStrength;

    this.selectedIndices = new Uint32Array(MAX_CLUSTERED_LIGHTS);
    this.heapScores = new Float64Array(MAX_CLUSTERED_LIGHTS);
    this.heapIndices = new Uint32Array(MAX_CLUSTERED_LIGHTS);
    this.sortedScores = new Float64Array(MAX_CLUSTERED_LIGHTS);
    this.selectedGenerations = new Uint16Array(registry.capacity);
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
      this.uniforms.clusteredCount.value = 0;
      this.gridData.fill(0);
      this.gridTexture.needsUpdate = true;
      this.selectedGenerations.fill(0);
    }
    this.isForceDirty = true;
  }

  /**
   * A camera jump larger than the analytic radius means the previous
   * selection belongs to somewhere else entirely; hysteresis must not drag
   * it across the map.
   */
  resetHysteresis() {
    this.selectedGenerations.fill(0);
    this.isForceDirty = true;
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
   * Selection + binning + packing. Returns immediately when neither the
   * registry nor the camera's grid cell moved since the last pass.
   */
  update(
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    stats: LocalLightStats,
  ) {
    const cellSize = this.uniforms.gridCellSize.value;
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
    if (!isDirty) {
      stats.selectMs = 0;
      stats.packMs = 0;
      return;
    }

    this.isForceDirty = false;
    this.lastRegistryRevision = this.registry.revision;
    this.lastCameraCellX = cameraCellX;
    this.lastCameraCellY = cameraCellY;
    this.lastCameraCellZ = cameraCellZ;

    this.uniforms.gridOrigin.value.set(
      (cameraCellX - (this.gridDims[0] >> 1)) * cellSize,
      (cameraCellY - (this.gridDims[1] >> 1)) * cellSize,
      (cameraCellZ - (this.gridDims[2] >> 1)) * cellSize,
    );

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
    this.uniforms.clusteredCount.value = this.selectedCount;
  }

  /**
   * CPU mirror of the shader's light response, for entities and particles:
   * accumulates the falloff-weighted color of every selected light in range
   * of the point, with the same spot/capsule shaping, shader-matched flicker,
   * and — when the caller supplies its local flood level — the same
   * occlusion mask the world surfaces use, so an entity behind a wall stops
   * tinting from the light the wall blocks. Mirrors the chunk shader's
   * per-fragment structure exactly: only lights present in the point's grid
   * cell contribute — color and claim alike — so a point outside the window
   * or in an overflowed cell keeps its flood look on entities just as it
   * does on blocks, and both the color and `out.claim` (the unoccluded
   * luminance claim that drives the flood remainder) carry the same
   * outer-two-cell window fade the shader applies, keeping the combined
   * block light continuous across the rim. Zero allocation; the caller owns
   * `out` and may reuse one `options` scratch object across calls
   * (`floodMask` is the knee-mapped local flood level, 1 = fully open;
   * `timeMs` drives the same flicker curve the shader evaluates).
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
    const cellX = Math.floor(relX);
    const cellY = Math.floor(relY);
    const cellZ = Math.floor(relZ);
    let cellBase = -1;
    if (
      cellX >= 0 &&
      cellY >= 0 &&
      cellZ >= 0 &&
      cellX < dimX &&
      cellY < dimY &&
      cellZ < dimZ
    ) {
      const cell = (cellZ * dimY + cellY) * dimX + cellX;
      cellBase =
        (cell >> 5) * (GRID_CELLS_PER_ROW * MAX_LIGHTS_PER_CELL) +
        (cell & 31) * MAX_LIGHTS_PER_CELL;
    }
    // The shader fades the claim over the window's outer two cells so its
    // cell-stepped edge never pops; the CPU claim rides the same fade.
    const edgeCells = Math.min(
      Math.min(relX, dimX - relX),
      Math.min(Math.min(relY, dimY - relY), Math.min(relZ, dimZ - relZ)),
    );
    const windowFade = Math.min(Math.max(edgeCells * 0.5, 0), 1);
    for (let rank = 0; rank < this.selectedCount; rank++) {
      // Same gate as a fragment: outside the window, or not in the cell's
      // slot list (overflow), this light neither tints nor claims here.
      if (cellBase < 0 || !this.cellHoldsRank(cellBase, rank)) continue;
      const i = this.selectedIndices[rank];

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
      const norm = dist / range;
      let falloff = 1 - norm * norm;
      falloff *= falloff;

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

      // Unoccluded claim: falloff and cone shaping only — no flicker, no
      // occlusion. Accumulated before the occlusion continue, because a
      // wall-blocked light still owns its coverage: the baked flood term
      // must not refill the side the analytic model keeps dark.
      claim +=
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
        intensities[i] * shares[i] * falloff * angular * flicker * occlusion;
      outColor[0] += colors[i * 3] * energy;
      outColor[1] += colors[i * 3 + 1] * energy;
      outColor[2] += colors[i * 3 + 2] * energy;
      contributors++;
    }
    // The analytic tint rides the same window-rim fade the shader applies
    // to fragments; the claim stays unfaded and the fade is reported
    // alongside it, so consumers reproduce the shader's exact crossfade
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

  /** Does the fixed slot list at `cellBase` hold the light ranked `rank`? */
  private cellHoldsRank(cellBase: number, rank: number): boolean {
    const slotValue = rank + 1;
    const gridData = this.gridData;
    for (let s = 0; s < MAX_LIGHTS_PER_CELL; s++) {
      const value = gridData[cellBase + s];
      if (value === 0) return false;
      if (value === slotValue) return true;
    }
    return false;
  }

  /**
   * Rewrite only the shadow-facing data (flags bit 2 + texels 4–5) of every
   * packed record. Runs when shadow slots change on a frame where the main
   * pack did not — a ≤ 32 KB re-upload, counted in stats.
   */
  refreshShadowTexels(stats: LocalLightStats): void {
    for (let rank = 0; rank < this.selectedCount; rank++) {
      this.writeShadowTexels(rank, this.selectedIndices[rank]);
    }
    this.dataTexture.needsUpdate = true;
    stats.dataTextureUploads++;
  }

  private writeShadowTexels(rank: number, i: number): void {
    const data = this.lightData;
    const base = rank * DATA_TEXELS_PER_LIGHT * 4;
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
      data[base + 22] = 0;
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
    } = this.registry;
    const radius = this.analyticRadius;
    const limit = this.maxClusteredLights;
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
      if (limit === 0) continue;

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

    // Rank selected lights by (score desc, slot asc): binning order decides
    // which lights survive a full cell, so it must be deterministic.
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
      if (selectedGenerations[i] !== this.registry.generationAt(i)) churn++;
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
    const gridData = this.gridData;
    gridData.fill(0);

    const [dimX, dimY, dimZ] = this.gridDims;
    const cellSize = this.uniforms.gridCellSize.value;
    const origin = this.uniforms.gridOrigin.value;
    const slotCap = this.maxLightsPerCell;
    let overflowed = 0;

    for (let rank = 0; rank < this.selectedCount; rank++) {
      const i = this.selectedIndices[rank];
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const range = ranges[i];

      let minCX = Math.floor((px - range - origin.x) / cellSize);
      let minCY = Math.floor((py - range - origin.y) / cellSize);
      let minCZ = Math.floor((pz - range - origin.z) / cellSize);
      let maxCX = Math.floor((px + range - origin.x) / cellSize);
      let maxCY = Math.floor((py + range - origin.y) / cellSize);
      let maxCZ = Math.floor((pz + range - origin.z) / cellSize);
      // A capsule reaches from both endpoints; grow the cell AABB to cover
      // the far end as well.
      if (shapes[i] === 2) {
        const ex = px + aux[i * 4];
        const ey = py + aux[i * 4 + 1];
        const ez = pz + aux[i * 4 + 2];
        minCX = Math.min(minCX, Math.floor((ex - range - origin.x) / cellSize));
        minCY = Math.min(minCY, Math.floor((ey - range - origin.y) / cellSize));
        minCZ = Math.min(minCZ, Math.floor((ez - range - origin.z) / cellSize));
        maxCX = Math.max(maxCX, Math.floor((ex + range - origin.x) / cellSize));
        maxCY = Math.max(maxCY, Math.floor((ey + range - origin.y) / cellSize));
        maxCZ = Math.max(maxCZ, Math.floor((ez + range - origin.z) / cellSize));
      }
      minCX = Math.max(minCX, 0);
      minCY = Math.max(minCY, 0);
      minCZ = Math.max(minCZ, 0);
      maxCX = Math.min(maxCX, dimX - 1);
      maxCY = Math.min(maxCY, dimY - 1);
      maxCZ = Math.min(maxCZ, dimZ - 1);

      const slotValue = rank + 1;
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        for (let cy = minCY; cy <= maxCY; cy++) {
          for (let cx = minCX; cx <= maxCX; cx++) {
            const cell = (cz * dimY + cy) * dimX + cx;
            const base =
              (cell >> 5) * (GRID_CELLS_PER_ROW * MAX_LIGHTS_PER_CELL) +
              (cell & 31) * MAX_LIGHTS_PER_CELL;
            let placed = false;
            for (let s = 0; s < slotCap; s++) {
              if (gridData[base + s] === 0) {
                gridData[base + s] = slotValue;
                placed = true;
                break;
              }
            }
            // Ranked insertion order means every occupant outranks this
            // light; dropping it here is the deterministic overflow policy.
            if (!placed) overflowed++;
          }
        }
      }

      const data = this.lightData;
      const base = rank * DATA_TEXELS_PER_LIGHT * 4;
      const energy = intensities[i] * shares[i];
      data[base] = px;
      data[base + 1] = py;
      data[base + 2] = pz;
      data[base + 3] = range;
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
      this.writeShadowTexels(rank, i);
    }

    stats.cellsOverflowed = overflowed;
    this.gridTexture.needsUpdate = true;
    this.dataTexture.needsUpdate = true;
    stats.gridTextureUploads++;
    stats.dataTextureUploads++;
  }
}
