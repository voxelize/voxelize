import {
  array,
  clamp,
  float,
  floor,
  int,
  ivec2,
  mod,
  screenCoordinate,
} from "three/tsl";

import { FAR_SEAM_BAYER } from "../far-terrain-seam";

import type { ChunkUniforms } from "./chunk-uniforms";
import type { BoolNode, FloatNode, Vec2Node } from "./types";

/** The dither thresholds, a constant array in the shader (no binding). */
const BAYER = /*@__PURE__*/ array(
  FAR_SEAM_BAYER.map((value) => float((value + 0.5) / 16)),
);

/**
 * The seam between the loaded chunks and the far layer (far-terrain-seam.ts):
 * over the outer half chunk of the loaded area chunk fragments yield pixels
 * to the far layer by an ordered dither, and the far layer draws exactly
 * those. Both read this, so they agree on every pixel.
 */
export function farSeam(
  u: Pick<ChunkUniforms, "farCoverMask" | "farCover" | "farSeam">,
) {
  /** Ordered 4x4 dither by screen pixel, 1/32 .. 31/32. */
  const dither = (): FloatNode => {
    const p = ivec2(mod(floor(screenCoordinate), 4));
    return BAYER.element(p.x.add(p.y.mul(4))) as unknown as FloatNode;
  };

  /** The mask's texel coordinates (continuous) at a world xz. */
  const texelAt = (worldXz: Vec2Node): Vec2Node =>
    worldXz.div(u.farCover.z).sub(u.farCover.xy);

  const isInside = (texel: Vec2Node): BoolNode =>
    texel.x
      .greaterThanEqual(0)
      .and(texel.y.greaterThanEqual(0))
      .and(texel.x.lessThan(u.farCover.w))
      .and(texel.y.lessThan(u.farCover.w));

  /** 1 where the chunk column under the texel draws real terrain, else 0. */
  const hard = (texel: Vec2Node): FloatNode =>
    u.farCoverMask.sample(floor(texel).add(0.5).div(u.farCover.w)).level(int(0))
      .r as unknown as FloatNode;

  /**
   * How far inside the loaded area a point is: 0 at the loaded edge and
   * beyond, 1 from half a chunk inside (the mask's bilinear ramp),
   * steepened by `farSeam`. A chunk keeps the pixel where the weight beats
   * the dither; the far layer keeps it where it does not.
   */
  const weight = (texel: Vec2Node): FloatNode => {
    const soft = u.farCoverMask.sample(texel.div(u.farCover.w)).level(int(0)).r;
    return clamp(soft.sub(0.5).mul(2).mul(u.farSeam), 0, 1);
  };

  /** Whether a chunk fragment at `worldXz` yields its pixel to the far layer. */
  const chunkYields = (worldXz: Vec2Node): BoolNode => {
    const texel = texelAt(worldXz);
    return u.farSeam
      .greaterThan(0)
      .and(isInside(texel))
      .and(weight(texel).lessThanEqual(dither()));
  };

  return { dither, texelAt, isInside, hard, weight, chunkYields };
}

export type FarSeamShading = ReturnType<typeof farSeam>;
