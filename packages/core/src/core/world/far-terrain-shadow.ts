/**
 * Sun shadows over the far layer, cast by its own heights. For every texel
 * of a height map, the shadow line: the height below which a point there is
 * shaded, because the land or canopy toward the sun stands above the ray
 * from the point to the sun. One number per texel serves a top, a cliff
 * face and a crown alike, which the far shader compares its height against.
 * Pure, so a worker can run it.
 */

export type FarShadowInput = {
  /** Highest surface per texel (ground or canopy), row-major, z by x. */
  heights: Float32Array;
  /** Texels per side. */
  size: number;
  /** Blocks per texel. */
  texelBlocks: number;
  /** Unit vector toward the sun. */
  sun: readonly [number, number, number];
  /** Blocks along the ground a shadow may reach. */
  maxDistance: number;
};

/** A line no surface lies under: lit everywhere. */
export const FAR_SHADOW_NONE = -4096;

/** The sun's elevation sine under which nothing is shadowed (night, dusk). */
const SUN_LOW = 0.02;

/**
 * The shadow line per texel into `out`. Nothing is shadowed while the sun
 * is below SUN_LOW (the far layer is lit by the sky alone by then) or
 * straight overhead.
 */
export function farShadowLines(
  input: FarShadowInput,
  out: Float32Array = new Float32Array(input.size * input.size),
): Float32Array {
  const { heights, size, texelBlocks } = input;
  const [sx, sy, sz] = input.sun;
  const flat = Math.hypot(sx, sz);
  if (sy < SUN_LOW || flat < 1e-4) {
    out.fill(FAR_SHADOW_NONE);
    return out;
  }
  const dx = sx / flat;
  const dz = sz / flat;
  // How much the ray to the sun climbs per texel crossed.
  const rise = (sy / flat) * texelBlocks;
  const steps = Math.max(1, Math.ceil(input.maxDistance / texelBlocks));
  let highest = -Infinity;
  for (let at = 0; at < heights.length; at++) {
    if (heights[at] > highest) highest = heights[at];
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let line = FAR_SHADOW_NONE;
      for (let k = 1; k <= steps; k++) {
        // No surface further on can raise the line once even the highest
        // one would sit under it.
        if (highest - rise * k <= line) break;
        const x = Math.round(i + dx * k);
        const z = Math.round(j + dz * k);
        if (x < 0 || z < 0 || x >= size || z >= size) break;
        const candidate = heights[z * size + x] - rise * k;
        if (candidate > line) line = candidate;
      }
      out[j * size + i] = line;
    }
  }
  return out;
}

const HALF_BUFFER = new Float32Array(1);
const HALF_BITS = new Uint32Array(HALF_BUFFER.buffer);

/** An IEEE half float's bits, rounded to nearest, for a half-float texture. */
export function toHalfFloat(value: number): number {
  HALF_BUFFER[0] = value;
  const bits = HALF_BITS[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  const mantissa = bits & 0x7fffff;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7c00;
  const half = sign | (exponent << 10) | (mantissa >>> 13);
  return mantissa & 0x1000 ? half + 1 : half;
}
