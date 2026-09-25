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
  /**
   * The kernel above keeps a room inside its 0.3-range core, so a warm
   * fixed light of range 14 lights a 5-block room nearly evenly. A core of
   * 0.2 x range falls off across a small room and still fades smoothly: a
   * tighter one (0.08, gain 5) painted a hot round disc around every flame
   * and light cluster, which read as a halo with an edge. Tuned in-game
   * against two small rooms, each lit by one warm fixed light.
   */
  tightKernelCoreRatio: 0.2,
  tightKernelGain: 2.0,
  /**
   * Lamplight white balance: how far block light moves toward its own
   * luminance before the warm tint. The eye adapts to a flame, so a
   * 1750 K light reads warm, not a saturated orange cast.
   */
  adaptation: 0.13,
  /**
   * Lamp light (flood and analytic alike) on a face that looks down keeps
   * this share: the baked flood has no direction, so a lamp's whole
   * diamond lit the ceiling as brightly as the floor under it, and the
   * ceiling read as the lit surface of the room. Swept in-game over 1,
   * 0.75, 0.6 and 0.45 in a torch-lit room.
   */
  ceilingWeight: 0.6,
  /**
   * Hue of flood light: brightness follows the brightest channel down the
   * `ratio` curve, and each other channel keeps `1 - gap / hueLevels` of
   * it, `gap` its level difference from the brightest: an emitter's own
   * channel ratios (12/7/2 -> 1 : 0.58 : 0.17, amber), constant with
   * distance. Per-channel `ratio` decay pushed a light whose channels
   * differ by many levels to salmon (the same emitter lit stone at
   * G/R 0.34).
   */
  hueLevels: 12,
  /**
   * A light lights the ceiling it hangs under evenly: on down-facing faces
   * less than `mountFar` blocks above it, its falloff is flat across its
   * core instead of peaking over it. A cluster of hanging emitters painted
   * a bright pool on its own ceiling.
   */
  mountNear: 0.5,
  mountFar: 2.5,
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
  /**
   * Step 1: masked lights reach zero on their flood's L1 diamond instead of
   * being cut there by the mask.
   */
  diamond: { value: 1 },
  /**
   * Step 6 mirror: default analytic colours follow the flood's per-level
   * decay, so a coloured light is the same hue in both models. Read at
   * profile-resolve time; `LocalLights.rebuildProfiles` applies a change.
   */
  analyticHue: { value: 1 },
  /**
   * Step 2: an aggregated proxy spreads its members' energy over its wider
   * range instead of peaking where no emitter is. Read when proxies build.
   */
  proxyEnergy: { value: 1 },
  /**
   * Analytic kernel core, as a fraction of a light's range, and its gain
   * (the tight kernel by default; `BLOCK_LIGHT_TRANSFER.kernelCoreRatio`
   * and `.kernelGain` are the step-7 shape it replaced).
   */
  kernelCore: { value: BLOCK_LIGHT_TRANSFER.tightKernelCoreRatio as number },
  kernelGain: { value: BLOCK_LIGHT_TRANSFER.tightKernelGain as number },
  /** Lamplight white balance, 0 (off) to 1 (block light fully grey). */
  adaptation: { value: BLOCK_LIGHT_TRANSFER.adaptation as number },
  /** Flood hue: levels for a channel gap to reach 0 (0 = per-channel). */
  hueLevels: { value: BLOCK_LIGHT_TRANSFER.hueLevels as number },
  /** 1: a light lights the ceiling it hangs under evenly (0 = legacy). */
  mountFade: { value: 1 },
  /**
   * 1: the darkness floor takes the lamp's warm tint as the lamp dominates
   * a fragment, so a pool of lamp light fades out warm instead of through
   * a pink rim; 0: the legacy cool floor everywhere.
   */
  warmFloor: { value: 1 },
  /** Share of flood light a down-facing face keeps (1 = legacy). */
  ceilingWeight: { value: BLOCK_LIGHT_TRANSFER.ceilingWeight as number },
  /** Derived: torch-light gain for the active curve. */
  gain: { value: BLOCK_LIGHT_TRANSFER.gain as number },
  /** Derived: dominance knee for the active curve. */
  dominanceKnee: { value: BLOCK_LIGHT_TRANSFER.dominanceKnee as number },
};

export type BlockLightTuningFlags = {
  curve?: boolean;
  toneMap?: boolean;
  kernel?: boolean;
  diamond?: boolean;
  analyticHue?: boolean;
  proxyEnergy?: boolean;
  /** The tight kernel core (false: the step-7 0.3-range core). */
  tightKernel?: boolean;
  /** Lamplight white balance on (its default amount) or off. */
  adaptation?: boolean;
};

export function setBlockLightTuning(flags: BlockLightTuningFlags): void {
  if (flags.curve !== undefined)
    BLOCK_LIGHT_TUNING.curve.value = flags.curve ? 1 : 0;
  if (flags.toneMap !== undefined)
    BLOCK_LIGHT_TUNING.toneMap.value = flags.toneMap ? 1 : 0;
  if (flags.kernel !== undefined)
    BLOCK_LIGHT_TUNING.kernel.value = flags.kernel ? 1 : 0;
  if (flags.diamond !== undefined)
    BLOCK_LIGHT_TUNING.diamond.value = flags.diamond ? 1 : 0;
  if (flags.analyticHue !== undefined)
    BLOCK_LIGHT_TUNING.analyticHue.value = flags.analyticHue ? 1 : 0;
  if (flags.proxyEnergy !== undefined)
    BLOCK_LIGHT_TUNING.proxyEnergy.value = flags.proxyEnergy ? 1 : 0;
  if (flags.tightKernel !== undefined) {
    BLOCK_LIGHT_TUNING.kernelCore.value = flags.tightKernel
      ? BLOCK_LIGHT_TRANSFER.tightKernelCoreRatio
      : BLOCK_LIGHT_TRANSFER.kernelCoreRatio;
    BLOCK_LIGHT_TUNING.kernelGain.value = flags.tightKernel
      ? BLOCK_LIGHT_TRANSFER.tightKernelGain
      : BLOCK_LIGHT_TRANSFER.kernelGain;
  }
  if (flags.adaptation !== undefined)
    BLOCK_LIGHT_TUNING.adaptation.value = flags.adaptation
      ? BLOCK_LIGHT_TRANSFER.adaptation
      : 0;
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

/**
 * The active curve for a flood colour (levels 0..1 per channel), as the
 * chunk fragment evaluates it: brightness from the brightest channel,
 * hue from the level gaps (see `hueLevels`; channels at 0 stay 0).
 * Writes `out`.
 */
export function blockLightCurveRGB(
  r: number,
  g: number,
  b: number,
  out: [number, number, number],
): [number, number, number] {
  const hueLevels = BLOCK_LIGHT_TUNING.hueLevels.value;
  if (!(hueLevels > 0)) {
    out[0] = blockLightCurve(r);
    out[1] = blockLightCurve(g);
    out[2] = blockLightCurve(b);
    return out;
  }
  const peak = Math.max(r, g, b);
  const bright = blockLightCurve(peak);
  const curve = BLOCK_LIGHT_TUNING.curve.value;
  const hue = (level: number) =>
    level > 0
      ? clamp01(1 - (15 * (clamp01(peak) - clamp01(level))) / hueLevels)
      : 0;
  const mixed = (level: number) => {
    const legacy = legacyBlockLightCurve(level);
    return legacy + (bright * hue(level) - legacy) * curve;
  };
  out[0] = mixed(r);
  out[1] = mixed(g);
  out[2] = mixed(b);
  return out;
}

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
 * Lamplight white balance (mirrors the chunk fragment): block light moves
 * toward its own luminance by `adaptation x torchDominance`, before the
 * warm tint, so a flame reads warm rather than saturated. Daylight
 * (dominance 0) is untouched. Writes `out`.
 */
export function blockLightAdapt(
  r: number,
  g: number,
  b: number,
  torchDominance: number,
  out: [number, number, number],
): [number, number, number] {
  const t = BLOCK_LIGHT_TUNING.adaptation.value * clamp01(torchDominance);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out[0] = r + (luma - r) * t;
  out[1] = g + (luma - g) * t;
  out[2] = b + (luma - b) * t;
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
export function localLightFalloff(
  dist: number,
  range: number,
  /** Squared distance for the inverse-square core (defaults to `dist`). */
  coreDistSq = dist * dist,
): number {
  if (!(range > 0) || dist >= range) return 0;
  const n = dist / range;
  const n2 = n * n;
  const legacy = (1 - n2) * (1 - n2);
  const kernel = BLOCK_LIGHT_TUNING.kernel.value;
  if (kernel === 0) return legacy;
  const window = (1 - n2 * n2) * (1 - n2 * n2);
  const core = BLOCK_LIGHT_TUNING.kernelCore.value * range;
  const shaped =
    (BLOCK_LIGHT_TUNING.kernelGain.value * window) /
    (1 + coreDistSq / (core * core));
  return legacy + (shaped - legacy) * kernel;
}

/**
 * Distance a masked light's falloff is windowed by (step 1): its flood ends
 * on the L1 diamond of its range, so the window runs to the larger of the
 * Euclidean and L1 distances and reaches zero exactly where the mask would
 * otherwise cut. Mirrors `localLightSurface`.
 */
export function maskedWindowDistance(
  dist: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const l1 = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
  return dist + (Math.max(dist, l1) - dist) * BLOCK_LIGHT_TUNING.diamond.value;
}

/**
 * Default analytic colour of an emitter whose flood levels are `r, g, b`
 * (step 6 mirror): each channel below the brightest keeps `ratio` per level
 * of difference, the flood's own per-level decay, so the analytic hue at a
 * light's core equals the flood's hue there. Legacy: channels over max.
 */
export function analyticColorFromLevels(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const max = Math.max(r, g, b, 1);
  if (BLOCK_LIGHT_TUNING.analyticHue.value === 0) {
    return [r / max, g / max, b / max];
  }
  // The flood's hue (see hueLevels); the per-channel curve's own ratio
  // when that is switched off.
  const hueLevels = BLOCK_LIGHT_TUNING.hueLevels.value;
  const ratio = BLOCK_LIGHT_TRANSFER.ratio;
  const channel = (level: number) =>
    level > 0
      ? hueLevels > 0
        ? clamp01(1 - (max - level) / hueLevels)
        : ratio ** (max - level)
      : 0;
  return [channel(r), channel(g), channel(b)];
}

const BLOCK_LIGHT_TRANSFER_MOUNT = {
  near: BLOCK_LIGHT_TRANSFER.mountNear.toFixed(3),
  far: BLOCK_LIGHT_TRANSFER.mountFar.toFixed(3),
};

/** Uniform declarations for the chunk fragment (bound in chunk-materials). */
export const BLOCK_LIGHT_TRANSFER_UNIFORMS_GLSL = `
uniform float uBlockLightCurve;
uniform float uBlockLightToneMap;
uniform float uBlockLightKernel;
uniform float uBlockLightDiamond;
uniform float uBlockLightGain;
uniform float uBlockLightDominanceKnee;
uniform float uBlockLightKernelCore;
uniform float uBlockLightKernelGain;
uniform float uBlockLightAdaptation;
uniform float uBlockLightCeilingWeight;
uniform float uBlockLightWarmFloor;
uniform float uBlockLightHueLevels;
uniform float uBlockLightMountFade;
`;

/** GLSL twins of the TS functions above; declared before the local lights. */
export const BLOCK_LIGHT_TRANSFER_GLSL = `
vec3 blockLightCurve(vec3 blLevel) {
  vec3 blX = clamp(blLevel, 0.0, 1.0);
  vec3 blLegacy = blX * blX * (3.0 - 2.0 * blX);
  vec3 blGeometric = max(exp2(${LOG2_RATIO.toFixed(6)} * (1.0 - blX)) - ${TAIL.toFixed(
    6,
  )}, 0.0) * ${(1 / (1 - TAIL)).toFixed(6)};
  if (uBlockLightHueLevels > 0.0) {
    // Brightness from the brightest channel, hue from the level gaps.
    float blPeak = max(max(blX.r, blX.g), blX.b);
    float blBright = max(max(blGeometric.r, blGeometric.g), blGeometric.b);
    vec3 blHue = clamp(1.0 - 15.0 * (blPeak - blX) / uBlockLightHueLevels, 0.0, 1.0)
      * step(vec3(1e-4), blX);
    blGeometric = blBright * blHue;
  }
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
  float blCore = uBlockLightKernelCore * blRange;
  float blShaped = uBlockLightKernelGain * blWindow
    / (1.0 + blD2 / (blCore * blCore));
  return mix(blLegacy, blShaped, uBlockLightKernel);
}
// 0 on a ceiling a light hangs just under (its falloff flattens there),
// 1 elsewhere; see BLOCK_LIGHT_TRANSFER.mountNear.
float blockLightMountFade(vec3 blToLight, vec3 blNormal) {
  float blPlane = dot(blToLight, blNormal);
  float blNear = (1.0 - smoothstep(${BLOCK_LIGHT_TRANSFER_MOUNT.near}, ${BLOCK_LIGHT_TRANSFER_MOUNT.far}, blPlane))
    * smoothstep(0.5, 0.9, -blNormal.y);
  return 1.0 - blNear * uBlockLightMountFade;
}
vec3 blockLightAdapt(vec3 blLight, float blTorchDominance) {
  float blLuma = dot(blLight, vec3(0.2126, 0.7152, 0.0722));
  return mix(blLight, vec3(blLuma), uBlockLightAdaptation * clamp(blTorchDominance, 0.0, 1.0));
}
`;
