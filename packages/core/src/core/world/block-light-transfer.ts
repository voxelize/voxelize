/**
 * How flood block light (torches, lanterns, glowberries) turns into light
 * on a surface: the single source for the chunk fragment, its local-light
 * ownership math and every CPU mirror (entity light, the client's entity
 * lighting utils). See docs/design/rendering/2026-09-23-block-light-
 * illumination.md, steps 6 and 7.
 *
 * The flood stores 0..15 per channel and loses one level per block. The
 * legacy map (smoothstep, gain 1.2, per-channel ACES) turned that into a
 * flat plateau with a cliff at the edge, and walked every coloured light's
 * hue to pure red as its weaker channels died first. The geometric map
 * keeps a fixed `ratio` per level, so the decline is even block to block
 * and a light keeps its hue while its channels are alive; the tone map
 * preserves hue for block-lit fragments. Daylight is unchanged: every new
 * term rides `torchDominance`, which is 0 in a sunlit frame.
 *
 * Every change sits behind a runtime switch in {@link BLOCK_LIGHT_TUNING},
 * shared as uniforms by the chunk materials and read by the CPU mirrors, so
 * the old and new models can be A/B'd in one session without a recompile.
 */

export const BLOCK_LIGHT_TRANSFER = Object.freeze({
  /** Each flood level keeps this fraction of the one above it. */
  ratio: 0.84,
  /** Torch-light gain on the geometric curve (legacy 1.2 on smoothstep). */
  gain: 1.6,
  legacyGain: 1.2,
  /**
   * Knee in `torchBrightness / (torchBrightness + sunLuma + knee)`: the warm
   * tint and hue-preserving tone map fade in over the outer levels of a
   * light instead of snapping on at level 1 (legacy 0.01).
   */
  dominanceKnee: 0.06,
  legacyDominanceKnee: 0.01,
  /**
   * Analytic kernel: windowed inverse square with a core of
   * `kernelCoreRatio * range`, scaled so the lit area matches the legacy
   * `(1 - n^2)^2` window (area-weighted integral parity at core 0.3).
   */
  kernelCoreRatio: 0.3,
  kernelGain: 2.0,
});

const LOG2_RATIO = 15 * Math.log2(BLOCK_LIGHT_TRANSFER.ratio);
/** `ratio^15`, subtracted so level 0 maps to exactly 0. */
const TAIL = BLOCK_LIGHT_TRANSFER.ratio ** 15;

/**
 * Runtime switches, 1 = the new model. Plain `{ value }` objects so the
 * chunk materials bind them as uniforms directly; derived values (`gain`,
 * `dominanceKnee`) follow the switches through {@link setBlockLightTuning}.
 */
export const BLOCK_LIGHT_TUNING = {
  /** Step 6: geometric per-level curve, gain, dominance knee, chroma tint. */
  curve: { value: 1 },
  /** Step 6: hue-preserving tone map for block-lit fragments. */
  toneMap: { value: 1 },
  /** Step 7: windowed inverse-square analytic kernel. */
  kernel: { value: 1 },
  /** Derived: torch-light gain for the active curve. */
  gain: { value: BLOCK_LIGHT_TRANSFER.gain as number },
  /** Derived: dominance knee for the active curve. */
  dominanceKnee: { value: BLOCK_LIGHT_TRANSFER.dominanceKnee as number },
};

export type BlockLightTuningFlags = {
  curve?: boolean;
  toneMap?: boolean;
  kernel?: boolean;
};

export function setBlockLightTuning(flags: BlockLightTuningFlags): void {
  if (flags.curve !== undefined)
    BLOCK_LIGHT_TUNING.curve.value = flags.curve ? 1 : 0;
  if (flags.toneMap !== undefined)
    BLOCK_LIGHT_TUNING.toneMap.value = flags.toneMap ? 1 : 0;
  if (flags.kernel !== undefined)
    BLOCK_LIGHT_TUNING.kernel.value = flags.kernel ? 1 : 0;
  const curve = BLOCK_LIGHT_TUNING.curve.value;
  BLOCK_LIGHT_TUNING.gain.value =
    BLOCK_LIGHT_TRANSFER.legacyGain +
    (BLOCK_LIGHT_TRANSFER.gain - BLOCK_LIGHT_TRANSFER.legacyGain) * curve;
  BLOCK_LIGHT_TUNING.dominanceKnee.value =
    BLOCK_LIGHT_TRANSFER.legacyDominanceKnee +
    (BLOCK_LIGHT_TRANSFER.dominanceKnee -
      BLOCK_LIGHT_TRANSFER.legacyDominanceKnee) *
      curve;
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** Legacy `x * x * (3 - 2x)`. */
export const legacyBlockLightCurve = (level: number) => {
  const x = clamp01(level);
  return x * x * (3 - 2 * x);
};

/** Geometric per-level map: level 15 -> 1, each level down x `ratio`, 0 -> 0. */
export const geometricBlockLightCurve = (level: number) => {
  if (!(level > 0)) return 0;
  const g = 2 ** (LOG2_RATIO * (1 - clamp01(level)));
  return Math.max(g - TAIL, 0) / (1 - TAIL);
};

/** The active curve, per {@link BLOCK_LIGHT_TUNING}.curve. */
export const blockLightCurve = (level: number) => {
  const curve = BLOCK_LIGHT_TUNING.curve.value;
  const legacy = legacyBlockLightCurve(level);
  return curve === 0
    ? legacy
    : legacy + (geometricBlockLightCurve(level) - legacy) * curve;
};

/** The ACES fit the chunk fragment tone-maps its light multiplier through. */
export const acesFit = (x: number) =>
  (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);

/** Warm tint for flood light; saturated emitters keep their own hue. */
export const BLOCK_LIGHT_WARM_TINT: readonly [number, number, number] = [
  1.05, 0.92, 0.75,
];

/**
 * The warm tint for a torch colour: legacy always applies the full warm
 * tint; the new model fades it toward white by the torch light's
 * saturation, so a coloured emitter is not pushed further toward red.
 */
export function blockLightWarmTint(
  torchR: number,
  torchG: number,
  torchB: number,
  out: [number, number, number],
): [number, number, number] {
  const peak = Math.max(torchR, torchG, torchB);
  const saturation = peak > 0 ? 1 - Math.min(torchR, torchG, torchB) / peak : 0;
  const t = saturation * BLOCK_LIGHT_TUNING.curve.value;
  out[0] = BLOCK_LIGHT_WARM_TINT[0] + (1 - BLOCK_LIGHT_WARM_TINT[0]) * t;
  out[1] = BLOCK_LIGHT_WARM_TINT[1] + (1 - BLOCK_LIGHT_WARM_TINT[1]) * t;
  out[2] = BLOCK_LIGHT_WARM_TINT[2] + (1 - BLOCK_LIGHT_WARM_TINT[2]) * t;
  return out;
}

/**
 * The tone map: per-channel ACES in daylight, blending toward a
 * hue-preserving ACES (every channel scaled by the peak's mapping, then
 * rescaled to the per-channel result's luminance) as block light dominates:
 * the light keeps its colour, the room keeps its brightness. Writes `out`.
 */
export function blockLightToneMap(
  r: number,
  g: number,
  b: number,
  torchDominance: number,
  out: [number, number, number],
): [number, number, number] {
  const peak = Math.max(r, g, b);
  const scale = acesFit(peak) / Math.max(peak, 1e-4);
  const t = clamp01(torchDominance) * BLOCK_LIGHT_TUNING.toneMap.value;
  const cr = acesFit(r),
    cg = acesFit(g),
    cb = acesFit(b);
  // Hue from the peak mapping, luminance from the per-channel fit.
  const hueLuma = (0.2126 * r + 0.7152 * g + 0.0722 * b) * scale;
  const channelLuma = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
  const match = (scale * channelLuma) / Math.max(hueLuma, 1e-4);
  out[0] = cr + (r * match - cr) * t;
  out[1] = cg + (g * match - cg) * t;
  out[2] = cb + (b * match - cb) * t;
  return out;
}

/**
 * Analytic falloff at `dist` for a light of `range`: the legacy
 * `(1 - n^2)^2` window, or the windowed inverse square, per the kernel
 * switch. 0 at and beyond the range either way.
 */
export function localLightFalloff(dist: number, range: number): number {
  if (!(range > 0) || dist >= range) return 0;
  const n = dist / range;
  const n2 = n * n;
  const legacy = (1 - n2) * (1 - n2);
  const kernel = BLOCK_LIGHT_TUNING.kernel.value;
  if (kernel === 0) return legacy;
  const window = (1 - n2 * n2) * (1 - n2 * n2);
  const core = BLOCK_LIGHT_TRANSFER.kernelCoreRatio * range;
  const shaped =
    (BLOCK_LIGHT_TRANSFER.kernelGain * window) /
    (1 + (dist * dist) / (core * core));
  return legacy + (shaped - legacy) * kernel;
}

/** Uniform declarations for the chunk fragment (bound in chunk-materials). */
export const BLOCK_LIGHT_TRANSFER_UNIFORMS_GLSL = `
uniform float uBlockLightCurve;
uniform float uBlockLightToneMap;
uniform float uBlockLightKernel;
uniform float uBlockLightGain;
uniform float uBlockLightDominanceKnee;
`;

/** GLSL twins of the TS functions above; declared before the local lights. */
export const BLOCK_LIGHT_TRANSFER_GLSL = `
vec3 blockLightCurve(vec3 blLevel) {
  vec3 blX = clamp(blLevel, 0.0, 1.0);
  vec3 blLegacy = blX * blX * (3.0 - 2.0 * blX);
  vec3 blGeometric = max(exp2(${LOG2_RATIO.toFixed(6)} * (1.0 - blX)) - ${TAIL.toFixed(
    6,
  )}, 0.0) * ${(1 / (1 - TAIL)).toFixed(6)};
  return mix(blLegacy, blGeometric, uBlockLightCurve);
}
float blockLightCurve1(float blLevel) {
  return blockLightCurve(vec3(blLevel)).x;
}
vec3 blockLightAcesFit(vec3 blX) {
  return (blX * (2.51 * blX + 0.03)) / (blX * (2.43 * blX + 0.59) + 0.14);
}
float blockLightAcesFit1(float blX) {
  return (blX * (2.51 * blX + 0.03)) / (blX * (2.43 * blX + 0.59) + 0.14);
}
float blockLightKernelFalloff(float blDist, float blD2, float blRange) {
  float blN = blDist / blRange;
  float blN2 = blN * blN;
  float blLegacy = (1.0 - blN2) * (1.0 - blN2);
  float blWindow = 1.0 - blN2 * blN2;
  blWindow *= blWindow;
  float blCore = ${BLOCK_LIGHT_TRANSFER.kernelCoreRatio.toFixed(4)} * blRange;
  float blShaped = ${BLOCK_LIGHT_TRANSFER.kernelGain.toFixed(4)} * blWindow
    / (1.0 + blD2 / (blCore * blCore));
  return mix(blLegacy, blShaped, uBlockLightKernel);
}
`;
