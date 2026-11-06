import { WebGLCoordinateSystem } from "three/webgpu";
import {
  cameraPosition,
  cross,
  dFdx,
  dFdy,
  dot,
  Fn,
  normalize,
  select,
  vec2,
} from "three/tsl";

import type { FloatNode, Vec2Node, Vec3Node } from "./types";

/**
 * Clip-space depth (`clip.z / clip.w` of a projection three built for the
 * renderer) to the 0..1 a depth texture stores: WebGPU's clip depth already
 * is it, WebGL's runs -1..1. Picked when the shader is built, by the backend
 * it is built for.
 */
export const clipDepthTo01 = (z: FloatNode): FloatNode =>
  Fn((builder) =>
    builder.renderer.coordinateSystem === WebGLCoordinateSystem
      ? z.mul(0.5).add(0.5)
      : z,
  )() as FloatNode;

/**
 * Normalized device xy (-1..1, y up) to the uv a render target's texture is
 * read at: WebGPU's v runs down from the top row, where NDC y = 1 lands.
 * (Under the WebGL backend three flips render-target uvs back itself.)
 */
export const ndcToTargetUv = (ndc: Vec2Node): Vec2Node =>
  vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(-0.5).add(0.5));

/**
 * A uv laid out the GL way on a render target (v up from the bottom row,
 * as a viewport's y is), in the convention texture reads take.
 */
export const glUvToTargetUv = (uv: Vec2Node): Vec2Node =>
  vec2(uv.x, uv.y.oneMinus());

/**
 * Perspective depth (0..1, as stored) back to the distance along the view
 * axis, for a camera with these clip planes. The same expression holds for
 * WebGL's and WebGPU's projections: both store `far (z - near) / (z (far -
 * near))`.
 */
export const perspectiveDepthToViewZ = (
  depth: FloatNode,
  near: FloatNode,
  far: FloatNode,
): FloatNode => near.mul(far).div(far.sub(depth.mul(far.sub(near))));

/**
 * A render target's texture uv (v down from the top row) back to
 * normalized device xy (-1..1, y up): the inverse of {@link ndcToTargetUv}.
 */
export const targetUvToNdc = (uv: Vec2Node): Vec2Node =>
  vec2(uv.x.mul(2).sub(1), uv.y.mul(-2).add(1));

/**
 * The flat face's normal at a fragment, from how its world position moves
 * across the screen, turned toward the camera. The raw cross product's sign
 * follows the screen's y (up under WebGL, down under WebGPU), so it is
 * oriented by the view instead. Take it in uniform control flow: it is a
 * derivative.
 */
export const screenFaceNormal = (worldPosition: Vec3Node): Vec3Node => {
  const raw = normalize(cross(dFdx(worldPosition), dFdy(worldPosition)));
  const toCamera = cameraPosition.sub(worldPosition);
  return select(dot(raw, toCamera).lessThan(0), raw.negate(), raw);
};
