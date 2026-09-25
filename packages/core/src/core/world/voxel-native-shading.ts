/**
 * Shader helpers that keep procedural effects on the same grain as the
 * blocks around them: patterns that step in whole texels instead of sliding,
 * signals quantised into a few flat bands instead of smooth gradients, and
 * animation clocks that tick in frames instead of flowing. A scanline, a
 * pulse or a ripple built on these reads as pixel art beside a 16-texel
 * block; built on raw `sin` and `smoothstep` it reads as a render from a
 * different engine.
 *
 * GLSL, with a TypeScript mirror of each function for CPU-side effects (a
 * particle's stepped growth, a mesh's stepped scale) and for tests. The two
 * must agree: the tests pin the mirror, and the mirror pins the maths.
 */

/** The include name {@link installVoxelNativeShaderChunk} registers. */
export const VOXEL_NATIVE_CHUNK_NAME = "voxel_native";

/**
 * - `snapToTexel(p, texelsPerUnit)`: the centre of the texel `p` falls in, on
 *   a grid of `texelsPerUnit` texels per world unit (16 is the block grain).
 *   Overloaded for float, vec2 and vec3.
 * - `band(x, steps)`: `x` clamped to 0..1 and quantised to `steps` flat
 *   levels, 0 and 1 included (`steps` 2 is a hard threshold at one half).
 * - `stepTime(t, framesPerSecond)`: a clock that holds each frame, for
 *   flip-book animation instead of continuous motion.
 */
export const VOXEL_NATIVE_GLSL = /* glsl */ `
float snapToTexel(float p, float texelsPerUnit) {
  return (floor(p * texelsPerUnit) + 0.5) / texelsPerUnit;
}
vec2 snapToTexel(vec2 p, float texelsPerUnit) {
  return (floor(p * texelsPerUnit) + 0.5) / texelsPerUnit;
}
vec3 snapToTexel(vec3 p, float texelsPerUnit) {
  return (floor(p * texelsPerUnit) + 0.5) / texelsPerUnit;
}
float band(float x, float steps) {
  float levels = max(steps, 1.0);
  float level = min(floor(clamp(x, 0.0, 1.0) * levels), levels - 1.0);
  return level / max(levels - 1.0, 1.0);
}
float stepTime(float t, float framesPerSecond) {
  return floor(t * framesPerSecond) / framesPerSecond;
}
`;

/** {@link VOXEL_NATIVE_GLSL}'s `snapToTexel`, for one axis. */
export function snapToTexel(p: number, texelsPerUnit: number): number {
  return (Math.floor(p * texelsPerUnit) + 0.5) / texelsPerUnit;
}

/** {@link VOXEL_NATIVE_GLSL}'s `band`. */
export function band(x: number, steps: number): number {
  const levels = Math.max(steps, 1);
  const clamped = Math.min(Math.max(x, 0), 1);
  const level = Math.min(Math.floor(clamped * levels), levels - 1);
  return level / Math.max(levels - 1, 1);
}

/** {@link VOXEL_NATIVE_GLSL}'s `stepTime`. */
export function stepTime(t: number, framesPerSecond: number): number {
  return Math.floor(t * framesPerSecond) / framesPerSecond;
}

/**
 * Rounds a length up to whole texels, never below one: a mesh scaled
 * through this grows in visible steps of the grid rather than smoothly, and
 * a sliver never rounds away to nothing.
 */
export function snapLengthToTexels(
  length: number,
  texelsPerUnit: number,
): number {
  return Math.max(1, Math.round(length * texelsPerUnit)) / texelsPerUnit;
}

/** The slice of three's `ShaderChunk` table the installer writes to. */
type ShaderChunkTable = Record<string, string>;

/**
 * Registers {@link VOXEL_NATIVE_GLSL} as `#include <voxel_native>` in the
 * given chunk table (three's `ShaderChunk`). Idempotent.
 */
export function installVoxelNativeShaderChunk(chunks: ShaderChunkTable) {
  chunks[VOXEL_NATIVE_CHUNK_NAME] = VOXEL_NATIVE_GLSL;
}
