import { blockLightCurve } from "../block-light-transfer";

export const FLUID_SPECULAR_LIGHTS_PER_CELL = 1;

/**
 * The four strengths an emissive face can render at, indexed by the two AO
 * bits under the vertex emissive bit. Mirrors `EMISSIVE_LEVELS` in
 * `crates/mesher/src/mesher/vertex_light.rs`; change neither side alone.
 */
export const EMISSIVE_LEVELS: [number, number, number, number] = [
  1.0, 1.75, 2.5, 3.5,
];

/**
 * Same diffuse wrap the cone lights use, so a surface grazing any local
 * light keeps the same rim response. Exported for the CPU entity mirror
 * (`composeEntityLight`), which has no per-fragment normal and applies the
 * wrap at an average N·L instead; change neither side alone.
 */
export const LAMBERT_WRAP = 0.25;

/**
 * How a lamp's light loses its direction with distance. Near the lamp a
 * surface is lit by the lamp's own ray, so its facing shapes it
 * (`LAMBERT_WRAP`). Further out, what arrives has bounced off the ground
 * and the walls on its way and comes from everywhere: the wrap rises to
 * `farWrap` between `start` and `end` of the light's range. Without it a
 * torch a block and a half over open ground lit it at a grazing angle:
 * four blocks out the ground took a quarter of the light a wall there
 * took, while the lamp still owned the fragment and kept the baked flood
 * off it, so a torch's pool on the ground was half as wide with the
 * analytic lights on as with them off.
 */
export const LAMBERT_REACH = Object.freeze({
  farWrap: 0.85,
  start: 0.15,
  end: 0.6,
});

/** The diffuse wrap at `distance / range` from a light (the shader's too). */
export function lambertWrapAt(distanceOverRange: number): number {
  const { farWrap, start, end } = LAMBERT_REACH;
  const t = Math.min(
    Math.max((distanceOverRange - start) / (end - start), 0),
    1,
  );
  return LAMBERT_WRAP + (farWrap - LAMBERT_WRAP) * (t * t * (3 - 2 * t));
}

/**
 * What a CPU mirror multiplies one light by so that its fixed wrap, applied
 * later at `averageNdotL`, comes out as the wrap at this distance.
 */
export function lambertReachGain(
  distanceOverRange: number,
  averageNdotL = 0.5,
): number {
  const wrap = lambertWrapAt(distanceOverRange);
  return (
    (averageNdotL * (1 - wrap) + wrap) /
    (averageNdotL * (1 - LAMBERT_WRAP) + LAMBERT_WRAP)
  );
}

/**
 * Safety gain on the analytic claim when it suppresses the baked flood
 * term: the two models approximate the same sources with different falloff
 * curves, so ownership must saturate decisively near a source (fully
 * analytic — N·L and shadows undiluted) while still fading smoothly to the
 * flood look at the claim's edge. Shared by the chunk shader and the CPU
 * entity mirror; change neither side alone.
 */
export const BLOCK_LIGHT_OWNERSHIP_GAIN = 1.5;

/**
 * The gain a faint claim takes instead: under `to` it falls toward `gain`,
 * reached at `from`. The claim is measured against the flood's curve before
 * the flood's own gain, so 0.6 is about one to one in light: out in a
 * lamp's tail it owns a fragment only while it lights it more than its
 * flood would. At the near gain it owned the whole of its reach, where its
 * own light (the kernel, its window and the flood mask together) drops to
 * nothing over the last few blocks: a torch's pool ended on an edge, with
 * the flood's long soft tail kept off it.
 */
export const BLOCK_LIGHT_OWNERSHIP_TAIL = Object.freeze({
  gain: 0.6,
  from: 0.1,
  to: 0.5,
});

/** The ownership gain for a claim (already scaled by the tier's ownership). */
export function blockLightOwnershipGain(scaledClaim: number): number {
  const { gain, from, to } = BLOCK_LIGHT_OWNERSHIP_TAIL;
  const t = Math.min(Math.max((scaledClaim - from) / (to - from), 0), 1);
  return gain + (BLOCK_LIGHT_OWNERSHIP_GAIN - gain) * (t * t * (3 - 2 * t));
}

/**
 * CPU mirror of the chunk shader's flood-remainder computation: the
 * fraction of the baked flood term a point keeps, given the analytic
 * luminance claim at that point (unfaded, scaled by the effective
 * ownership), the raw flood level (0..1, max channel), and the window-rim
 * fade ({@link LocalLightSample.windowFade}). Matches the shader exactly:
 * the owned remainder uses the smoothstep denominator, then mixes toward 1
 * by the rim fade — the same crossfade the analytic contribution rides, so
 * the combined block light stays continuous across the rim on entities and
 * blocks alike. Callers may reuse one scratch args object; nothing is
 * retained.
 */
export function blockLightFloodRemainder(args: {
  scaledClaim: number;
  floodLevel: number;
  windowFade: number;
}): number {
  const floodSmooth = blockLightCurve(args.floodLevel);
  const ratio =
    (args.scaledClaim * blockLightOwnershipGain(args.scaledClaim)) /
    Math.max(floodSmooth, 1e-3);
  const owned = 1 - Math.min(Math.max(ratio, 0), 1);
  const fade = Math.min(Math.max(args.windowFade, 0), 1);
  return 1 + (owned - 1) * fade;
}
