import { Vector4 } from "three";

import type { LightClusterGrid } from "./clustering";
import type { LightSourceRegistry } from "./registry";
import type { LightQualityTier } from "./types";

/**
 * Uniform slots of the air-light set: the steady lights of the richest tier
 * plus room for lights still fading out of it. Compile-time in every shader
 * that reads the set (the air effect, the chunk room fill).
 */
export const AIRLIGHT_SLOTS = 12;

export type LocalLightAirlightOptions = {
  /** Steady lights in the set, per quality tier (0 turns the layer off). */
  lightsPerTier: Record<LightQualityTier, number>;
  /** In-scatter per block of air along a view ray. */
  strength: number;
  /**
   * Radius of a light's scattering core, as a fraction of its range: the
   * glow is a broad haze thickening toward the source, never a hot point.
   */
  coreRatio: number;
  /** Soft ceiling on the linear light the air adds to a pixel. */
  maxAdded: number;
  /**
   * Flat brightness bands the air glow is cut into, each constant over a
   * 1/16-block texel of the surface behind it (voxel-native: crisp steps,
   * no soft gradient). 0 draws the smooth legacy haze, sky included.
   */
  bands: number;
  /** Share of the air glow kept under open sky at night. */
  openSkyShare: number;
  /** Fade in and out of the set, in ms (the grid's slot fade). */
  fadeMs: number;
  /** An incumbent's score multiplier against challengers. */
  hysteresis: number;
  /** One set member's line of sight is re-tested every this many ms. */
  visibilityIntervalMs: number;
  /**
   * A line-of-sight hit this close to a light (blocks) still counts as
   * seeing it; the hit block holding the light always does. Kept under
   * half a block: a light one wall away (a lamp in the next room) is
   * hidden, however near the wall stands to it.
   */
  visibilityTolerance: number;
  /** Time constant of the daylight/submersion dimmer, in ms. */
  dimmerMs: number;
  /** Room fill: share of a light's energy bounced onto unlit surfaces. */
  fillStrength: number;
  /** Room fill reaches this multiple of a light's range. */
  fillRangeScale: number;
  /** Room fill core, as a multiple of the air core. */
  fillCoreScale: number;
  /**
   * 1: room fill lands only where the fragment's own flood reaches, so it
   * never passes a wall; 0: unmasked (reaches past the flood, and leaks).
   */
  fillFloodMask: number;
};

export const defaultAirlightOptions: LocalLightAirlightOptions = {
  // The set feeds room fill. The air glow itself is off (strength 0, the
  // effect skips the screen): banded it drew ring edges round every lamp,
  // and smooth it was too faint to see for about 0.14 ms per light at
  // 1080p. A game can turn it on with `strength`.
  lightsPerTier: {
    ultra: 4,
    high: 2,
    medium: 0,
    low: 0,
    potato: 0,
    off: 0,
  },
  strength: 0,
  coreRatio: 0.35,
  maxAdded: 0.09,
  bands: 0,
  // Under open sky a lamp lights the ground, not a sheet of sky.
  openSkyShare: 0,
  fadeMs: 320,
  hysteresis: 1.3,
  visibilityIntervalMs: 90,
  visibilityTolerance: 0.3,
  dimmerMs: 600,
  fillStrength: 0.14,
  fillRangeScale: 2.5,
  fillCoreScale: 1.6,
  fillFloodMask: 1,
};

export type AirlightInput = {
  grid: LightClusterGrid;
  registry: LightSourceRegistry;
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  nowMs: number;
  tier: LightQualityTier;
  /** 0..1: how much of the camera's surroundings the sun lights now. */
  daylight: number;
  /** 0..1: how far under open sky the camera stands. */
  skyExposure: number;
  /** 0..1 camera submersion; the air layer yields to the water optics. */
  submersion: number;
  /**
   * Line of sight from the camera to a light: true when nothing blocks the
   * segment, when the first solid block hit is the block the light sits in
   * (a lamp block, a group's centre inside its ceiling), or when the hit
   * lies within `tolerance` blocks of the light.
   */
  isVisible: (
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
    tolerance: number,
  ) => boolean;
};

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/**
 * The few local lights the camera can see, for effects that light the air
 * and the room rather than the surface next to each source (plan steps 5
 * and 8). Drawn from the clustered layer's selection, so it inherits that
 * selection's stability; on top, a light keeps its place against a
 * marginally stronger challenger (`hysteresis`), and every change — joining,
 * leaving, losing or regaining line of sight, the day coming up — fades.
 * All per-frame work runs on preallocated arrays.
 */
export class LocalLightAirlight {
  readonly options: LocalLightAirlightOptions;

  /** Shared by every material that reads the set; updated in place. */
  readonly uniforms = {
    count: { value: 0 },
    /** xyz, range */
    positions: {
      value: Array.from({ length: AIRLIGHT_SLOTS }, () => new Vector4()),
    },
    /** rgb x intensity x fade, w = scattering core radius */
    colors: {
      value: Array.from({ length: AIRLIGHT_SLOTS }, () => new Vector4()),
    },
    /**
     * Per member, the air glow's share: line of sight from the camera x
     * the daylight/open-sky/submersion dimmer. Room fill ignores it — a
     * surface's bounce light does not depend on where the camera stands.
     */
    seen: { value: new Array<number>(AIRLIGHT_SLOTS).fill(0) },
    /** 1 when any member glows in the air (the effect's early out). */
    airActive: { value: 0 },
    strength: { value: 0 },
    maxAdded: { value: 0 },
    bands: { value: 0 },
    fillStrength: { value: 0 },
    fillRangeScale: { value: 0 },
    fillCoreScale: { value: 0 },
    fillFloodMask: { value: 0 },
  };

  /** Off for A/B captures; the set empties through its fades. */
  isEnabled = true;

  private readonly handles = new Uint32Array(AIRLIGHT_SLOTS);
  private readonly weights = new Float32Array(AIRLIGHT_SLOTS);
  private readonly seenWeights = new Float32Array(AIRLIGHT_SLOTS);
  private readonly isChosen = new Uint8Array(AIRLIGHT_SLOTS);
  private readonly isSeen = new Uint8Array(AIRLIGHT_SLOTS);
  private count = 0;

  private readonly topIndices = new Int32Array(AIRLIGHT_SLOTS);
  private readonly topScores = new Float64Array(AIRLIGHT_SLOTS);

  private dimmer = 0;
  private lastUpdateAt = Number.NaN;
  private lastVisibilityAt = Number.NEGATIVE_INFINITY;
  private visibilityCursor = 0;

  constructor(options: Partial<LocalLightAirlightOptions> = {}) {
    this.options = {
      ...defaultAirlightOptions,
      ...options,
      lightsPerTier: {
        ...defaultAirlightOptions.lightsPerTier,
        ...options.lightsPerTier,
      },
    };
    const u = this.uniforms;
    u.strength.value = this.options.strength;
    u.maxAdded.value = this.options.maxAdded;
    u.bands.value = this.options.bands;
    u.fillStrength.value = this.options.fillStrength;
    u.fillRangeScale.value = this.options.fillRangeScale;
    u.fillCoreScale.value = this.options.fillCoreScale;
    u.fillFloodMask.value = this.options.fillFloodMask;
  }

  /** Lights in the set right now, fading ones included. */
  get size(): number {
    return this.count;
  }

  update(input: AirlightInput): void {
    const { registry, nowMs } = input;
    const options = this.options;
    const elapsed = Number.isFinite(this.lastUpdateAt)
      ? Math.max(nowMs - this.lastUpdateAt, 0)
      : 0;
    this.lastUpdateAt = nowMs;

    // Under the sun the air carries no visible lamp light, nor (by default)
    // under open sky at night. The dimmer eases, so walking out of a cave
    // mouth never snaps the glow away. It dims the air only: room fill is a
    // property of the surface, not of where the camera stands.
    const sky = Math.min(Math.max(input.skyExposure, 0), 1);
    const water = Math.min(Math.max((input.submersion - 0.3) / 0.3, 0), 1);
    const dimmerTarget =
      (1 - Math.min(Math.max(input.daylight, 0), 1)) *
      (1 - sky * (1 - options.openSkyShare)) *
      (1 - water);
    const ease =
      options.dimmerMs > 0 ? 1 - Math.exp(-elapsed / options.dimmerMs) : 1;
    this.dimmer += (dimmerTarget - this.dimmer) * ease;
    // Settle exactly, so daylight zeroes every air share and the effect's
    // early out skips the whole screen.
    if (Math.abs(this.dimmer - dimmerTarget) < 1e-3) this.dimmer = dimmerTarget;

    // Drop members whose light is gone: the source itself vanished.
    for (let k = 0; k < this.count; ) {
      if (registry.resolve(this.handles[k]) < 0) {
        this.removeAt(k);
      } else {
        k++;
      }
    }

    const steady = this.isEnabled
      ? Math.min(options.lightsPerTier[input.tier] ?? 0, AIRLIGHT_SLOTS)
      : 0;
    const top = this.pickTop(input, steady);

    for (let k = 0; k < this.count; k++) this.isChosen[k] = 0;
    for (let n = 0; n < top; n++) {
      const i = this.topIndices[n];
      const handle = registry.handleAt(i);
      let slot = this.slotOf(handle);
      if (slot < 0) {
        if (this.count >= AIRLIGHT_SLOTS) continue;
        slot = this.count++;
        this.handles[slot] = handle;
        this.weights[slot] = 0;
        this.isSeen[slot] = this.testVisibility(input, i) ? 1 : 0;
        this.seenWeights[slot] = 0;
      }
      this.isChosen[slot] = 1;
    }

    // Line of sight, one member at a time on a fixed cadence.
    if (
      this.count > 0 &&
      nowMs - this.lastVisibilityAt >= options.visibilityIntervalMs
    ) {
      this.lastVisibilityAt = nowMs;
      this.visibilityCursor = (this.visibilityCursor + 1) % this.count;
      const k = this.visibilityCursor;
      const i = registry.resolve(this.handles[k]);
      if (i >= 0) this.isSeen[k] = this.testVisibility(input, i) ? 1 : 0;
    }

    const step = options.fadeMs > 0 ? elapsed / options.fadeMs : 1;
    for (let k = 0; k < this.count; ) {
      // Membership (fill and air) and line of sight (air only) fade apart.
      const target = this.isChosen[k] === 1 ? 1 : 0;
      const weight =
        target === 1
          ? Math.min(this.weights[k] + step, 1)
          : Math.max(this.weights[k] - step, 0);
      this.weights[k] = weight;
      this.seenWeights[k] =
        this.isSeen[k] === 1
          ? Math.min(this.seenWeights[k] + step, 1)
          : Math.max(this.seenWeights[k] - step, 0);
      if (target === 0 && weight <= 0) {
        this.removeAt(k);
      } else {
        k++;
      }
    }

    this.writeUniforms(registry);
  }

  /** Highest-scoring selected lights, incumbents boosted; returns count. */
  private pickTop(input: AirlightInput, limit: number): number {
    if (limit <= 0) return 0;
    const { grid, registry, cameraX, cameraY, cameraZ } = input;
    const { positions, ranges, colors, intensities, shares } = registry;
    const indices = this.topIndices;
    const scores = this.topScores;
    let size = 0;
    // The selection only: lights still fading out of the clustered layer
    // are leaving, and fade out of the air with it.
    for (let row = 0; row < grid.selectedCount; row++) {
      const i = grid.packedIndices[row];
      const dx = positions[i * 3] - cameraX;
      const dy = positions[i * 3 + 1] - cameraY;
      const dz = positions[i * 3 + 2] - cameraZ;
      const range = ranges[i];
      let score =
        (intensities[i] *
          shares[i] *
          (colors[i * 3] * LUMA_R +
            colors[i * 3 + 1] * LUMA_G +
            colors[i * 3 + 2] * LUMA_B) *
          range *
          range) /
        Math.max(dx * dx + dy * dy + dz * dz, 1);
      if (score <= 0) continue;
      const slot = this.slotOf(registry.handleAt(i));
      if (slot >= 0 && this.isChosen[slot] === 1) {
        score *= this.options.hysteresis;
      }
      if (size === limit && score <= scores[size - 1]) continue;
      let at = size < limit ? size++ : limit - 1;
      while (
        at > 0 &&
        (scores[at - 1] < score ||
          (scores[at - 1] === score && indices[at - 1] > i))
      ) {
        scores[at] = scores[at - 1];
        indices[at] = indices[at - 1];
        at--;
      }
      scores[at] = score;
      indices[at] = i;
    }
    return size;
  }

  private testVisibility(input: AirlightInput, i: number): boolean {
    const { registry } = input;
    const p = registry.positions;
    return input.isVisible(
      input.cameraX,
      input.cameraY,
      input.cameraZ,
      p[i * 3],
      p[i * 3 + 1],
      p[i * 3 + 2],
      this.options.visibilityTolerance,
    );
  }

  private slotOf(handle: number): number {
    for (let k = 0; k < this.count; k++) {
      if (this.handles[k] === handle) return k;
    }
    return -1;
  }

  private removeAt(k: number): void {
    const last = --this.count;
    this.handles[k] = this.handles[last];
    this.weights[k] = this.weights[last];
    this.seenWeights[k] = this.seenWeights[last];
    this.isChosen[k] = this.isChosen[last];
    this.isSeen[k] = this.isSeen[last];
    if (this.visibilityCursor >= this.count) this.visibilityCursor = 0;
  }

  private writeUniforms(registry: LightSourceRegistry): void {
    const { positions, ranges, colors, intensities, shares } = registry;
    const u = this.uniforms;
    let written = 0;
    let airActive = 0;
    for (let k = 0; k < this.count; k++) {
      const i = registry.resolve(this.handles[k]);
      if (i < 0) continue;
      const w = this.weights[k];
      const eased = w * w * (3 - 2 * w);
      if (eased <= 0) continue;
      const v = this.seenWeights[k];
      const seen = v * v * (3 - 2 * v) * this.dimmer;
      u.seen.value[written] = seen;
      if (seen > 0) airActive = 1;
      const energy = intensities[i] * shares[i] * eased;
      const range = ranges[i];
      u.positions.value[written].set(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
        range,
      );
      u.colors.value[written].set(
        colors[i * 3] * energy,
        colors[i * 3 + 1] * energy,
        colors[i * 3 + 2] * energy,
        range * this.options.coreRatio,
      );
      written++;
    }
    u.count.value = written;
    u.airActive.value = u.strength.value > 0 ? airActive : 0;
  }
}

/** GLSL declarations of the set, shared by its consumers. */
export const AIRLIGHT_UNIFORMS_GLSL = `
#define AIRLIGHT_SLOTS ${AIRLIGHT_SLOTS}
uniform int uAirCount;
uniform vec4 uAirPos[AIRLIGHT_SLOTS];
uniform vec4 uAirColor[AIRLIGHT_SLOTS];
`;

/** The air effect's extra per-member input (room fill does not read it). */
export const AIRLIGHT_SEEN_GLSL = `
uniform float uAirSeen[AIRLIGHT_SLOTS];
`;
