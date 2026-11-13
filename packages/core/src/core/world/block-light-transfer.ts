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
 * The chunk shading's TSL twin is shading/block-light.ts; change neither
 * alone.
 */

export const BLOCK_LIGHT_TRANSFER = Object.freeze({
  /**
   * Each flood level keeps this fraction of the one above it. The light is
   * linear and the screen is not: 0.84 a level reads as 0.92 a level once
   * displayed, so a torch's pool lay nearly flat from its foot to its edge
   * and a field of torches lit as one even wash. 0.8 with the higher gain
   * keeps the pool's reach and gives it a slope the eye can see.
   */
  ratio: 0.8,
  /** Torch-light gain on the geometric curve. */
  gain: 2.2,
  /**
   * White point of the tone map where block light dominates: what stands
   * at a lamp's foot is lit a little past its own colour, so a lamp reads
   * as a source and not as one more evenly lit patch. Daylight (dominance
   * 0) keeps the fit's own white.
   */
  lampWhite: 1.2,
  /**
   * Knee in `torchBrightness / (torchBrightness + sunLuma + knee)`: the warm
   * tint and hue-preserving tone map fade in over the outer levels of a
   * light instead of snapping on at level 1.
   */
  dominanceKnee: 0.06,
  /**
   * Analytic kernel: a windowed inverse square with a core of
   * `tightKernelCoreRatio x range`. A core of 0.2 x range falls off across a
   * small room and still fades smoothly (0.3 lit a 5-block room nearly
   * evenly): a
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

/**
 * One flood level (0..1 units): a channel below the peak fades its hue share
 * in over this much of its own level, or over the peak itself when the peak
 * is fainter, so the peak channel is never dimmed.
 */
export const BLOCK_LIGHT_HUE_RAMP_LEVEL = 1 / 15;

/** `15 log2(ratio)`: the geometric curve's exponent per unit of level. */
export const BLOCK_LIGHT_LOG2_RATIO = 15 * Math.log2(BLOCK_LIGHT_TRANSFER.ratio);
/** `ratio^15`, subtracted so level 0 maps to exactly 0. */
export const BLOCK_LIGHT_TAIL = BLOCK_LIGHT_TRANSFER.ratio ** 15;

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** Geometric per-level map: level 15 -> 1, each level down x `ratio`, 0 -> 0. */
export const blockLightCurve = (level: number) => {
  if (!(level > 0)) return 0;
  const g = 2 ** (BLOCK_LIGHT_LOG2_RATIO * (1 - clamp01(level)));
  return Math.max(g - BLOCK_LIGHT_TAIL, 0) / (1 - BLOCK_LIGHT_TAIL);
};

/**
 * The curve for a flood colour (levels 0..1 per channel), as the chunk
 * fragment evaluates it: brightness from the brightest channel, hue from the
 * level gaps (see `hueLevels`). Writes `out`.
 *
 * A channel that has run out (level 0) while the brightest one is still
 * lit has lost its gap, and with it its share: a lamp's blue ends seven
 * levels before its red, its green three, so the last blocks of its pool
 * went orange and then pure red. `fill` hands those channels a share back:
 * the colour of the analytic lights around the point (their channel
 * ratios, so a lamp's amber), weighted by how much of that colour lies on
 * the flood's own brightest channel and capped by the most the dead channel
 * could still hold (its gap is at least the peak). Channels still lit keep
 * their own gap's share exactly, and a channel the fill also lacks stays
 * dark, so a pure red light stays red. No fill (no analytic light near, the
 * off tier): channels at 0 stay 0.
 */
export function blockLightCurveRGB(
  r: number,
  g: number,
  b: number,
  out: [number, number, number],
  fill?: readonly [number, number, number],
): [number, number, number] {
  const peak = Math.max(r, g, b);
  const bright = blockLightCurve(peak);
  const rampSpan = Math.max(
    Math.min(clamp01(peak), BLOCK_LIGHT_HUE_RAMP_LEVEL),
    1e-6,
  );
  const fillPeak = fill ? Math.max(fill[0], fill[1], fill[2]) : 0;
  // How much of the fill lies on the flood's own brightest channel: 1 when
  // the flood came from the light the fill is (a lamp's red under a lamp),
  // 0 when the fill is another colour that only reaches here through a
  // wall (a red light lends a green flood nothing).
  const fillOnPeak = fill
    ? Math.max(
        r >= peak ? fill[0] : 0,
        g >= peak ? fill[1] : 0,
        b >= peak ? fill[2] : 0,
      )
    : 0;
  const fillScale =
    fillPeak > 0 ? Math.max(fillOnPeak, 0) / (fillPeak * fillPeak) : 0;
  // A channel's share of the peak, faded in over its first level; below it
  // the share fades to the fill's instead of to nothing.
  const hue = (level: number, fillChannel: number) => {
    const gapShare = clamp01(
      1 -
        (15 * (clamp01(peak) - clamp01(level))) /
          BLOCK_LIGHT_TRANSFER.hueLevels,
    );
    const lit = level > 0 ? Math.min(clamp01(level) / rampSpan, 1) : 0;
    const fillShare = Math.min(Math.max(fillChannel, 0) * fillScale, gapShare);
    return fillShare + (gapShare - fillShare) * lit;
  };
  out[0] = bright * hue(r, fill ? fill[0] : 0);
  out[1] = bright * hue(g, fill ? fill[1] : 0);
  out[2] = bright * hue(b, fill ? fill[2] : 0);
  return out;
}

/** The ACES fit the chunk fragment tone-maps its light multiplier through. */
export const acesFit = (x: number) =>
  (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);

/**
 * Warm tint for flood light; saturated emitters keep their own hue. Gold
 * rather than orange: under (1.05, 0.92, 0.75) on top of a torch's own
 * amber, green crops went olive and soil went rust, and a lit field lost
 * the colours that tell its plants apart.
 */
export const BLOCK_LIGHT_WARM_TINT: readonly [number, number, number] = [
  1.04, 0.95, 0.8,
];

/**
 * The warm tint for a torch colour, faded toward white by the torch light's
 * saturation, so a coloured emitter is not pushed further toward red.
 */
export function blockLightWarmTint(
  torchR: number,
  torchG: number,
  torchB: number,
  out: [number, number, number],
): [number, number, number] {
  const peak = Math.max(torchR, torchG, torchB);
  const t = peak > 0 ? 1 - Math.min(torchR, torchG, torchB) / peak : 0;
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
  const t = BLOCK_LIGHT_TRANSFER.adaptation * clamp01(torchDominance);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out[0] = r + (luma - r) * t;
  out[1] = g + (luma - g) * t;
  out[2] = b + (luma - b) * t;
  return out;
}

/**
 * The tone map: per-channel ACES in daylight, blending toward a
 * hue-preserving ACES (every channel scaled by the peak's mapping, then
 * rescaled to the per-channel result's luminance, times `lampWhite`) as
 * block light dominates: the light keeps its colour, the room keeps its
 * brightness. Writes `out`.
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
  const t = clamp01(torchDominance);
  const cr = acesFit(r),
    cg = acesFit(g),
    cb = acesFit(b);
  // Hue from the peak mapping, luminance from the per-channel fit.
  const hueLuma = (0.2126 * r + 0.7152 * g + 0.0722 * b) * scale;
  const channelLuma = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
  const match = (scale * channelLuma) / Math.max(hueLuma, 1e-4);
  const white = match * BLOCK_LIGHT_TRANSFER.lampWhite;
  out[0] = cr + (r * white - cr) * t;
  out[1] = cg + (g * white - cg) * t;
  out[2] = cb + (b * white - cb) * t;
  return out;
}

/**
 * Analytic falloff at `dist` for a light of `range`: a windowed inverse
 * square with a core of `tightKernelCoreRatio x range`, 0 at and beyond the
 * range.
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
  const window = (1 - n2 * n2) * (1 - n2 * n2);
  const core = BLOCK_LIGHT_TRANSFER.tightKernelCoreRatio * range;
  return (
    (BLOCK_LIGHT_TRANSFER.tightKernelGain * window) /
    (1 + coreDistSq / (core * core))
  );
}

/**
 * Distance a masked light's falloff is windowed by: its flood ends on the L1
 * diamond of its range, so the window runs to the larger of the Euclidean
 * and L1 distances and reaches zero exactly where the mask would otherwise
 * cut. Mirrors `localLightSurface`.
 */
export function maskedWindowDistance(
  dist: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  return Math.max(dist, Math.abs(dx) + Math.abs(dy) + Math.abs(dz));
}

/**
 * Default analytic colour of an emitter whose flood levels are `r, g, b`:
 * each channel below the brightest keeps its share of the flood's hue (see
 * `hueLevels`), so the analytic hue at a light's core equals the flood's
 * hue there.
 */
export function analyticColorFromLevels(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const max = Math.max(r, g, b, 1);
  const channel = (level: number) =>
    level > 0 ? clamp01(1 - (max - level) / BLOCK_LIGHT_TRANSFER.hueLevels) : 0;
  return [channel(r), channel(g), channel(b)];
}
