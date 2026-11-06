import { clamp, floor, max, min } from "three/tsl";

import type { FloatNode, Vec2Node, Vec3Node } from "./shading/types";

/**
 * Shader helpers that keep procedural effects on the same grain as the
 * blocks around them: patterns that step in whole texels instead of sliding,
 * signals quantised into a few flat bands instead of smooth gradients, and
 * animation clocks that tick in frames instead of flowing. A scanline, a
 * pulse or a ripple built on these reads as pixel art beside a 16-texel
 * block; built on raw `sin` and `smoothstep` it reads as a render from a
 * different engine.
 *
 * TSL nodes (`*Node`), with a TypeScript twin of each for CPU-side effects
 * (a particle's stepped growth, a mesh's stepped scale) and for tests. The
 * two must agree: the tests pin the twin, and the twin pins the maths.
 */

/**
 * The centre of the texel `p` falls in, on a grid of `texelsPerUnit` texels
 * per world unit (16 is the block grain). Any float vector.
 */
export function snapToTexelNode<T extends FloatNode | Vec2Node | Vec3Node>(
  p: T,
  texelsPerUnit: FloatNode | number,
): T {
  const v = p as unknown as Vec3Node;
  return floor(v.mul(texelsPerUnit)).add(0.5).div(texelsPerUnit) as unknown as T;
}

/**
 * `x` clamped to 0..1 and quantised to `steps` flat levels, 0 and 1
 * included (`steps` 2 is a hard threshold at one half).
 */
export function bandNode(x: FloatNode, steps: FloatNode | number): FloatNode {
  const levels = max(steps, 1);
  const level = min(floor(clamp(x, 0, 1).mul(levels)), levels.sub(1));
  return level.div(max(levels.sub(1), 1));
}

/** A clock that holds each frame, for flip-book animation. */
export function stepTimeNode(
  t: FloatNode,
  framesPerSecond: FloatNode | number,
): FloatNode {
  return floor(t.mul(framesPerSecond)).div(framesPerSecond);
}

/** {@link snapToTexelNode}, for one axis. */
export function snapToTexel(p: number, texelsPerUnit: number): number {
  return (Math.floor(p * texelsPerUnit) + 0.5) / texelsPerUnit;
}

/** {@link bandNode}'s twin. */
export function band(x: number, steps: number): number {
  const levels = Math.max(steps, 1);
  const clamped = Math.min(Math.max(x, 0), 1);
  const level = Math.min(Math.floor(clamped * levels), levels - 1);
  return level / Math.max(levels - 1, 1);
}

/** {@link stepTimeNode}'s twin. */
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
