/**
 * How a flickering local light breathes and shivers, shared by the light
 * shader (`shading/local-lights.ts`) and its CPU mirror
 * (`LightClusterGrid.sampleIrradiance`), so an entity beside a torch dims in
 * step with the wall behind it.
 *
 * A flame is not a sine. Its brightness is three incommensurate partials (no
 * repeat the eye can lock onto), weighted to the slowest, and now and then,
 * when two slow envelopes line up, it bows: a soft, deeper dip over about a
 * second that settles back. Nothing in it is fast: every partial stays under
 * ~6 Hz at a torch's speed, because a whole room pulsing quicker than that
 * reads as a strobe, not a flame. Its light also sways a few centimetres and
 * sinks a little as it dims, so the walls right next to it shimmer while the
 * far ones only breathe. All of it scales with the profile's amplitude and
 * runs on the profile's speed.
 *
 * Phases come from `flickerPhaseAt`: every client sees the same torch at the
 * same point of its flicker.
 */

/** [frequency ratio, phase multiplier, weight] of the brightness partials. */
export const FLICKER_PARTIALS: readonly (readonly [number, number, number])[] =
  [
    [1, 1, 0.6],
    [1.618, 1.31, 0.3],
    [2.414, 2.17, 0.1],
  ];

/** The two slow envelopes whose product, near its peak, gutters the flame. */
export const FLICKER_GUTTER_ENVELOPES: readonly (readonly [number, number])[] =
  [
    [0.113, 0.61],
    [0.071, 1.9],
  ];
/** Envelope product where a bow starts, and where it is at full depth. */
export const FLICKER_GUTTER_EDGES = [0.55, 0.95] as const;
/** How much deeper than the breathing a full bow dims, in amplitudes. */
export const FLICKER_GUTTER_DEPTH = 0.6;

/** Blocks the light sways per unit of amplitude (a 0.1 torch: 8 cm). */
export const FLICKER_SHIVER_PER_AMPLITUDE = 0.8;
/** Horizontal sway: [frequency ratio, phase multiplier] for x, then z. */
export const FLICKER_SHIVER_X = [0.83, 2.3] as const;
export const FLICKER_SHIVER_Z = [1.21, 0.9] as const;
/** How far the light sinks as it dims, as a share of the sway radius. */
export const FLICKER_SHIVER_SINK = 0.6;

const TAU = Math.PI * 2;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * One flickering light at `seconds`: writes [intensity scale, dx, dy, dz]
 * into `out` (the scale multiplies the light, the offset moves its origin
 * for shading only; shadow maps keep the real origin).
 */
export function sampleFlicker(
  speed: number,
  amplitude: number,
  phase: number,
  seconds: number,
  out: Float32Array | number[],
): void {
  const cycles = seconds * speed;
  let wave = 0;
  for (const [ratio, phaseMul, weight] of FLICKER_PARTIALS) {
    wave += weight * Math.sin(TAU * ratio * cycles + phaseMul * phase);
  }
  const breath = 0.5 + 0.5 * wave;

  let envelope = 1;
  for (const [ratio, phaseMul] of FLICKER_GUTTER_ENVELOPES) {
    envelope *= Math.sin(TAU * ratio * cycles + phaseMul * phase);
  }
  const gutter = smoothstep(
    FLICKER_GUTTER_EDGES[0],
    FLICKER_GUTTER_EDGES[1],
    envelope,
  );
  const dim = amplitude * (breath + FLICKER_GUTTER_DEPTH * gutter);
  out[0] = Math.max(1 - dim, 0);

  const radius = amplitude * FLICKER_SHIVER_PER_AMPLITUDE;
  out[1] =
    radius *
    Math.sin(TAU * FLICKER_SHIVER_X[0] * cycles + FLICKER_SHIVER_X[1] * phase);
  out[2] = -radius * FLICKER_SHIVER_SINK * (breath - 0.5);
  out[3] =
    radius *
    Math.sin(TAU * FLICKER_SHIVER_Z[0] * cycles + FLICKER_SHIVER_Z[1] * phase);
}
