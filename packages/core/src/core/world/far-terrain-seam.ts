/**
 * The seam between the loaded chunks and the far layer. Over the outer half
 * chunk of the loaded area the chunk shader yields pixels to the far layer
 * by an ordered dither and the far layer draws exactly those, so blocks hand
 * over to columns across a short band instead of along a line, with no gap
 * and no double surface: both shaders include the GLSL below and read the
 * same mask, so they agree pixel for pixel on who draws. The TypeScript
 * twins of the GLSL rules are what the unit tests pin.
 */

/** Uniforms the seam needs; chunk materials and the far layer share them. */
export const FAR_SEAM_UNIFORM_DECLARATIONS = `
uniform sampler2D uFarCoverMask;
// x, y: the mask's origin in chunk columns; z: blocks per chunk; w: texels per side.
uniform vec4 uFarCover;
// The seam band's ramp scale: 0 keeps the loaded edge hard.
uniform float uFarSeam;
`;

/** The 4x4 Bayer matrix, row-major, each of 0..15 once. */
export const FAR_SEAM_BAYER: readonly number[] = [
  0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
];

export const FAR_SEAM_FUNCTIONS = `
// Ordered 4x4 dither by screen pixel, 1/32 .. 31/32.
float farSeamDither(vec2 fragCoord) {
  ivec2 p = ivec2(mod(floor(fragCoord), 4.0));
  const int bayer[16] = int[16](${FAR_SEAM_BAYER.join(", ")});
  return (float(bayer[p.x + p.y * 4]) + 0.5) / 16.0;
}

// The mask's texel coordinates (continuous) at a world xz.
vec2 farCoverTexel(vec2 worldXz) {
  return worldXz / uFarCover.z - uFarCover.xy;
}

bool farCoverInside(vec2 texel) {
  return texel.x >= 0.0 && texel.y >= 0.0 && texel.x < uFarCover.w && texel.y < uFarCover.w;
}

// 1 where the chunk column under the texel draws real terrain, else 0.
float farCoverHard(vec2 texel) {
  return texture2D(uFarCoverMask, (floor(texel) + 0.5) / uFarCover.w).r;
}

// How far inside the loaded area a point is: 0 at the loaded edge and
// beyond, 1 from half a chunk inside (the mask's bilinear ramp), steepened
// by uFarSeam. A chunk keeps the pixel where the weight beats the dither;
// the far layer keeps it where it does not.
float farSeamWeight(vec2 texel) {
  float soft = texture2D(uFarCoverMask, texel / uFarCover.w).r;
  return clamp((soft - 0.5) * 2.0 * uFarSeam, 0.0, 1.0);
}
`;

/** The dither threshold of screen pixel `(x, y)`, as the GLSL computes it. */
export function farSeamDither(x: number, y: number): number {
  const px = ((Math.floor(x) % 4) + 4) % 4;
  const py = ((Math.floor(y) % 4) + 4) % 4;
  return (FAR_SEAM_BAYER[px + py * 4] + 0.5) / 16;
}

/**
 * The ramp scale for a band of `band` blocks: the mask's own ramp spans
 * half a chunk, so a shorter band steepens it; 0 (or a band of 0) keeps the
 * edge hard.
 */
export function farSeamScale(chunkSize: number, band: number): number {
  const half = chunkSize / 2;
  if (!(band > 0) || !(half > 0)) return 0;
  return half / Math.min(band, half);
}

/** The bilinear coverage of a mask at continuous texel coordinates. */
export function sampleCoverageBilinear(
  mask: Uint8Array,
  size: number,
  tx: number,
  tz: number,
): number {
  const fx = Math.min(Math.max(tx - 0.5, 0), size - 1);
  const fz = Math.min(Math.max(tz - 0.5, 0), size - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, size - 1);
  const z1 = Math.min(z0 + 1, size - 1);
  const ax = fx - x0;
  const az = fz - z0;
  const at = (x: number, z: number) => mask[z * size + x] / 255;
  const top = at(x0, z0) * (1 - ax) + at(x1, z0) * ax;
  const bottom = at(x0, z1) * (1 - ax) + at(x1, z1) * ax;
  return top * (1 - az) + bottom * az;
}

/**
 * The seam weight at world `(x, z)`, as `farSeamWeight` computes it: 0 at
 * the loaded edge and outside, 1 half a chunk inside (sooner with a scale
 * above 1).
 */
export function farSeamWeightAt(
  mask: Uint8Array,
  originCx: number,
  originCz: number,
  size: number,
  chunkSize: number,
  scale: number,
  x: number,
  z: number,
): number {
  const tx = x / chunkSize - originCx;
  const tz = z / chunkSize - originCz;
  if (tx < 0 || tz < 0 || tx >= size || tz >= size) return 0;
  const soft = sampleCoverageBilinear(mask, size, tx, tz);
  return Math.min(Math.max((soft - 0.5) * 2 * scale, 0), 1);
}

/** Whether the chunk shader keeps a pixel of `weight` against `dither`. */
export const chunkKeepsSeamPixel = (weight: number, dither: number) =>
  weight > dither;

/** Whether the far layer keeps a pixel it covers, the chunk's complement. */
export const farKeepsSeamPixel = (weight: number, dither: number) =>
  !(weight > dither);
