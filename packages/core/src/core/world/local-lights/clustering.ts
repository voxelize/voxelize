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
  LightSourceRegistry,
} from "./registry";
import { LocalLightStats } from "./types";

/**
 * Compile-time slot count of the shader loop. Quality tiers cap how many
 * slots the CPU fills, never this constant, so no tier change recompiles.
 */
export const MAX_LIGHTS_PER_CELL = 8;

/** Grid cells per texture row; with 8 slots each, rows are 256 texels wide. */
export const GRID_CELLS_PER_ROW = 32;

/** Hard ceiling of the clustered set: grid slots hold `rank + 1` in a byte. */
export const MAX_CLUSTERED_LIGHTS = 255;

/** Texels per packed light record (position/range, color/flags, aux, flicker). */
const DATA_TEXELS_PER_LIGHT = 4;

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
    debugMode: { value: 0 },
    emissiveLevels: { value: new Vector4(1.0, 1.75, 2.5, 3.5) },
  };

  /** Selected registry slot per rank; `selectedCount` entries are live. */
  readonly selectedIndices: Uint32Array;
  selectedCount = 0;

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
  private readonly wasSelected: Uint8Array;

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
    this.wasSelected = new Uint8Array(registry.capacity);
  }

  setTierCaps(
    maxClusteredLights: number,
    maxLightsPerCell: number,
    analyticRadius: number,
    fluidSpecularStrength: number,
  ) {
    this.maxClusteredLights = Math.min(
      maxClusteredLights,
      MAX_CLUSTERED_LIGHTS,
    );
    this.maxLightsPerCell = Math.min(maxLightsPerCell, MAX_LIGHTS_PER_CELL);
    this.analyticRadius = analyticRadius;
    this.uniforms.specularStrength.value = fluidSpecularStrength;
    this.isForceDirty = true;
  }

  /**
   * A camera jump larger than the analytic radius means the previous
   * selection belongs to somewhere else entirely; hysteresis must not drag
   * it across the map.
   */
  resetHysteresis() {
    this.wasSelected.fill(0);
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
   * of the point. Zero allocation; the caller owns `outColor`.
   */
  sampleIrradiance(
    x: number,
    y: number,
    z: number,
    outColor: [number, number, number],
  ): number {
    const { positions, ranges, colors, intensities, shares } = this.registry;
    let contributors = 0;
    for (let rank = 0; rank < this.selectedCount; rank++) {
      const i = this.selectedIndices[rank];
      const dx = positions[i * 3] - x;
      const dy = positions[i * 3 + 1] - y;
      const dz = positions[i * 3 + 2] - z;
      const range = ranges[i];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= range * range) continue;
      const norm = Math.sqrt(d2) / range;
      let falloff = 1 - norm * norm;
      falloff *= falloff;
      const energy = intensities[i] * shares[i] * falloff;
      outColor[0] += colors[i * 3] * energy;
      outColor[1] += colors[i * 3 + 1] * energy;
      outColor[2] += colors[i * 3 + 2] * energy;
      contributors++;
    }
    return contributors;
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
    // Candidates must be able to touch both the analytic radius and the grid
    // window: a light past the window (the vertical span is deliberately
    // shorter than the horizontal) could never be binned, so selecting it
    // would waste a slot.
    const windowHalfX = Math.min((this.gridDims[0] * cellSize) / 2, radius);
    const windowHalfY = Math.min((this.gridDims[1] * cellSize) / 2, radius);
    const windowHalfZ = Math.min((this.gridDims[2] * cellSize) / 2, radius);
    const heapScores = this.heapScores;
    const heapIndices = this.heapIndices;
    let heapSize = 0;
    let candidates = 0;

    for (let k = 0; k < aliveCount; k++) {
      const i = aliveIndices[k];
      if (!this.registry.isEnabledAt(i)) continue;
      const dx = positions[i * 3] - cameraX;
      const dy = positions[i * 3 + 1] - cameraY;
      const dz = positions[i * 3 + 2] - cameraZ;
      const range = ranges[i];
      if (
        Math.abs(dx) > windowHalfX + range ||
        Math.abs(dy) > windowHalfY + range ||
        Math.abs(dz) > windowHalfZ + range
      ) {
        continue;
      }
      const d2 = dx * dx + dy * dy + dz * dz;
      candidates++;
      if (limit === 0) continue;

      const luma =
        intensities[i] *
        (colors[i * 3] * LUMA_R +
          colors[i * 3 + 1] * LUMA_G +
          colors[i * 3 + 2] * LUMA_B);
      let score = (luma * range * range) / Math.max(d2, 1) + priorityBiases[i];
      if (this.wasSelected[i]) score *= this.selectionHysteresis;

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
    const wasSelected = this.wasSelected;
    for (let n = 0; n < count; n++) {
      if (!wasSelected[selected[n]]) churn++;
    }
    let previousCount = 0;
    for (let k = 0; k < aliveCount; k++) {
      if (wasSelected[aliveIndices[k]]) previousCount++;
    }
    churn += Math.max(previousCount - (count - churn), 0);
    stats.selectionChurn = churn;

    wasSelected.fill(0);
    for (let n = 0; n < count; n++) {
      wasSelected[selected[n]] = 1;
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
      data[base + 7] =
        (flags[i] & LIGHT_FLAG_MASKED ? 1 : 0) |
        (flags[i] & LIGHT_FLAG_FLICKER ? 2 : 0) |
        (shapes[i] << 4);
      data[base + 8] = aux[i * 4];
      data[base + 9] = aux[i * 4 + 1];
      data[base + 10] = aux[i * 4 + 2];
      data[base + 11] = aux[i * 4 + 3];
      data[base + 12] = flickers[i * 4];
      data[base + 13] = flickers[i * 4 + 1];
      data[base + 14] = flickers[i * 4 + 2];
      data[base + 15] = flickers[i * 4 + 3];
    }

    stats.cellsOverflowed = overflowed;
    this.gridTexture.needsUpdate = true;
    this.dataTexture.needsUpdate = true;
    stats.gridTextureUploads++;
    stats.dataTextureUploads++;
  }
}
