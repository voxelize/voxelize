import {
  Break,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  float,
  If,
  Loop,
  max,
  min,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { ndcToTargetUv, perspectiveDepthToViewZ } from "./conventions";
import type { ChunkUniforms } from "./chunk-uniforms";
import type { FloatNode, Vec2Node, Vec3Node, Vec4Node } from "./types";

/**
 * The march a water surface finds what it mirrors with: along the
 * reflected ray in world space, steps growing with distance, each projected
 * into the frame drawn before the water and tested against its depth.
 */
export const WATER_REFLECTION = Object.freeze({
  /** Coarse steps; the first is `firstStep` blocks, each `growth` times the last. */
  steps: 22,
  firstStep: 0.5,
  growth: 1.24,
  /** Halvings between the last step in front and the first behind. */
  refineSteps: 5,
  /**
   * How far behind the frame's surface the ray may be and still count as
   * hitting it, in blocks plus a share of the step: thinner and the ray
   * slips between a tree's leaves; thicker and a trunk mirrors on the sky.
   */
  thickness: 0.9,
  thicknessPerStep: 0.6,
  /** The reflection fades over this much of the frame's edge (uv). */
  edgeFade: 0.07,
  /** And over the far part of the ray (blocks), where the march thins out. */
  rayFadeStart: 60,
  rayFadeEnd: 95,
  /** Surfaces this far (blocks) leave the march to the sky reflection. */
  surfaceFadeStart: 80,
  surfaceFadeEnd: 120,
});

const R = WATER_REFLECTION;

export type WaterReflectionInputs = Pick<
  ChunkUniforms,
  "sceneColor" | "sceneDepth" | "waterDepthClip"
>;

/**
 * What the frame drawn before the water shows along `dir` from `origin`
 * (a point on the surface): its colour, and how much of the reflection it
 * is (0 where the ray leaves the frame, finds nothing, or runs far).
 * Samples at level 0 only, so it may run in any control flow.
 */
export function marchWaterReflection(
  c: WaterReflectionInputs,
  origin: Vec3Node,
  dir: Vec3Node,
  surfaceDistance: FloatNode,
): { color: Vec3Node; weight: FloatNode } {
  const project = (p: Vec3Node) => {
    const view = cameraViewMatrix.mul(vec4(p, 1)) as unknown as Vec4Node;
    const clip = cameraProjectionMatrix.mul(view) as unknown as Vec4Node;
    const ndc = clip.xy.div(max(clip.w, 1e-4)) as Vec2Node;
    return { uv: ndcToTargetUv(ndc), z: view.z.negate() };
  };
  const sceneZ = (uv: Vec2Node) =>
    perspectiveDepthToViewZ(
      (c.sceneDepth.sample(uv).level(float(0)) as unknown as Vec4Node).r,
      c.waterDepthClip.x,
      c.waterDepthClip.y,
    );

  const color = vec3(0).toVar("reflectionColor");
  const weight = float(0).toVar("reflectionWeight");
  const surfaceKeep = smoothstep(
    R.surfaceFadeStart,
    R.surfaceFadeEnd,
    surfaceDistance,
  ).oneMinus();

  If(surfaceKeep.greaterThan(0.001), () => {
    const near = float(0).toVar("reflectionNear");
    const far = float(-1).toVar("reflectionFar");
    const t = float(R.firstStep).toVar("reflectionT");
    const step = float(R.firstStep).toVar("reflectionStep");
    Loop(R.steps, () => {
      const at = project(origin.add(dir.mul(t)));
      const uv = at.uv;
      If(
        uv.x
          .lessThan(0)
          .or(uv.x.greaterThan(1))
          .or(uv.y.lessThan(0))
          .or(uv.y.greaterThan(1))
          .or(at.z.lessThan(0)),
        () => {
          Break();
        },
      );
      const behind = at.z.sub(sceneZ(uv));
      If(
        behind
          .greaterThan(0)
          .and(behind.lessThan(step.mul(R.thicknessPerStep).add(R.thickness))),
        () => {
          far.assign(t);
          Break();
        },
      );
      near.assign(t);
      step.mulAssign(R.growth);
      t.addAssign(step);
    });

    If(far.greaterThan(0), () => {
      // Halve the bracket down to the surface the ray went behind.
      Loop(R.refineSteps, () => {
        const mid = near.add(far).mul(0.5);
        const at = project(origin.add(dir.mul(mid)));
        If(at.z.greaterThan(sceneZ(at.uv)), () => {
          far.assign(mid);
        }).Else(() => {
          near.assign(mid);
        });
      });
      const hit = project(origin.add(dir.mul(far)));
      const uv = clamp(hit.uv, vec2(0.001), vec2(0.999));
      const edge = min(min(uv.x, uv.x.oneMinus()), min(uv.y, uv.y.oneMinus()));
      color.assign(
        (c.sceneColor.sample(uv).level(float(0)) as unknown as Vec4Node).rgb,
      );
      weight.assign(
        smoothstep(0, R.edgeFade, edge)
          .mul(smoothstep(R.rayFadeStart, R.rayFadeEnd, far).oneMinus())
          .mul(surfaceKeep),
      );
    });
  });

  return { color, weight };
}
