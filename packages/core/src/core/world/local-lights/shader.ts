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
 * Safety gain on the analytic claim when it suppresses the baked flood
 * term: the two models approximate the same sources with different falloff
 * curves, so ownership must saturate decisively near a source (fully
 * analytic — N·L and shadows undiluted) while still fading smoothly to the
 * flood look at the claim's edge. Shared by the chunk shader and the CPU
 * entity mirror; change neither side alone.
 */
export const BLOCK_LIGHT_OWNERSHIP_GAIN = 1.5;

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
    (args.scaledClaim * BLOCK_LIGHT_OWNERSHIP_GAIN) /
    Math.max(floodSmooth, 1e-3);
  const owned = 1 - Math.min(Math.max(ratio, 0), 1);
  const fade = Math.min(Math.max(args.windowFade, 0), 1);
  return 1 + (owned - 1) * fade;
}
