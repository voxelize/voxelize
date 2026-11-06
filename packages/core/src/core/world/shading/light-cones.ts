import {
  abs,
  Break,
  cameraPosition,
  clamp,
  Continue,
  cross,
  dFdx,
  dFdy,
  distance,
  dot,
  exp,
  float,
  floor,
  Fn,
  If,
  int,
  length,
  Loop,
  max,
  min,
  mix,
  normalize,
  sqrt,
  vec2,
  vec3,
} from "three/tsl";

import {
  LIGHT_CONE_STRIDE,
  LIGHT_CONES,
  type LightConeUniforms,
} from "../light-cones";
import { WATER_VIEW_EXTINCTION } from "../water-optics";

import { screenFaceNormal } from "./conventions";
import type { FloatNode, IntNode, Vec3Node } from "./types";

const EXTINCTION = vec3(
  WATER_VIEW_EXTINCTION.red,
  WATER_VIEW_EXTINCTION.green,
  WATER_VIEW_EXTINCTION.blue,
);

/**
 * The light cones (flashlights, headlights) of one world: what they light
 * on a surface, and the glow a beam scatters toward the eye through the air
 * or water it crosses.
 */
export function lightConeShading(u: LightConeUniforms) {
  const slot = (cone: IntNode, field: number) =>
    u.cones.node.element(cone.mul(LIGHT_CONE_STRIDE).add(field));

  /**
   * Every cone's light on a surface point: quadratic angular falloff between
   * the inner and outer cone, squared-quadratic distance falloff to zero at
   * range, a wrapped Lambert, and Beer-Lambert extinction from the cone
   * origin scaled by its submersion, so a beam dies out under water and
   * carries in air.
   */
  const surface = Fn(([point, normal]: [Vec3Node, Vec3Node]) => {
    const total = vec3(0).toVar();
    Loop({ start: int(0), end: int(LIGHT_CONES.maxCones) }, ({ i }) => {
      If(i.greaterThanEqual(u.coneCount.toInt()), () => {
        Break();
      });
      const origin = slot(i, 0);
      const shape = slot(i, 3);
      const toPoint = point.sub(origin.xyz);
      const dist = length(toPoint);
      If(dist.greaterThanEqual(shape.z).or(dist.lessThan(1e-4)), () => {
        Continue();
      });
      const l = toPoint.div(dist);
      const angular = clamp(
        dot(l, slot(i, 1).xyz).sub(shape.x).mul(shape.y),
        0,
        1,
      );
      const n = dist.div(shape.z);
      const fall = n.mul(n).oneMinus();
      const lambert = max(dot(normal, l.negate()), 0)
        .mul(1 - LIGHT_CONES.lambertWrap)
        .add(LIGHT_CONES.lambertWrap);
      const transmit = exp(EXTINCTION.negate().mul(dist).mul(origin.w));
      total.addAssign(
        slot(i, 2)
          .xyz.mul(angular.mul(angular).mul(fall.mul(fall)).mul(lambert))
          .mul(transmit),
      );
    });
    return total;
  });

  /**
   * The stretch `[s, e]` of the view ray inside cone `i`'s front nappe,
   * clipped to `[0, maxT]` and to the cone's reach along its axis; `e <= s`
   * when the ray misses it. The front nappe is convex, so the inside is one
   * interval of a quadratic in t.
   */
  const segment = (
    i: IntNode,
    cam: Vec3Node,
    rayDir: Vec3Node,
    maxT: FloatNode,
  ) => {
    const result = vec2(0).toVar();
    const v = cam.sub(slot(i, 0).xyz);
    const d = slot(i, 1).xyz;
    const shape = slot(i, 3);
    const cos2 = shape.x.mul(shape.x);
    const rd = dot(rayDir, d);
    const vd = dot(v, d);
    const lo = float(0).toVar();
    const hi = float(maxT).toVar();
    const isMissed = float(0).toVar();
    // The axial slab 0 <= dot(P - O, D) <= range.
    If(abs(rd).greaterThan(1e-5), () => {
      const t0 = vd.negate().div(rd);
      const t1 = shape.z.sub(vd).div(rd);
      lo.assign(max(lo, min(t0, t1)));
      hi.assign(min(hi, max(t0, t1)));
    }).ElseIf(vd.lessThan(0).or(vd.greaterThan(shape.z)), () => {
      isMissed.assign(1);
    });
    If(isMissed.lessThan(0.5).and(hi.greaterThan(lo)), () => {
      const a = rd.mul(rd).sub(cos2);
      const b = rd.mul(vd).sub(cos2.mul(dot(rayDir, v))).mul(2);
      const c = vd.mul(vd).sub(cos2.mul(dot(v, v)));
      const disc = b.mul(b).sub(a.mul(c).mul(4));
      If(abs(a).lessThan(1e-6), () => {
        // Parallel to the surface: one crossing; keep the side inside.
        const mid = lo.add(hi).mul(0.5);
        If(abs(b).lessThan(1e-6), () => {
          If(b.mul(mid).add(c).greaterThanEqual(0), () => {
            result.assign(vec2(lo, hi));
          });
        }).Else(() => {
          const tc = c.negate().div(b);
          result.assign(
            b
              .greaterThan(0)
              .select(vec2(max(lo, tc), hi), vec2(lo, min(hi, tc))),
          );
        });
      })
        .ElseIf(disc.lessThan(0), () => {
          If(a.greaterThan(0), () => {
            result.assign(vec2(lo, hi));
          });
        })
        .Else(() => {
          const sq = sqrt(disc);
          const r1 = b.negate().sub(sq).div(a.mul(2));
          const r2 = b.negate().add(sq).div(a.mul(2));
          const t1 = min(r1, r2);
          const t2 = max(r1, r2);
          If(a.lessThan(0), () => {
            result.assign(vec2(max(lo, t1), min(hi, t2)));
          }).Else(() => {
            // Outside between the roots: inside is the slab before t1 or
            // after t2; it holds the front nappe only, so one is empty.
            const before = vec2(lo, min(hi, t1));
            const after = vec2(max(lo, t2), hi);
            result.assign(
              before.y
                .sub(before.x)
                .greaterThanEqual(after.y.sub(after.x))
                .select(before, after),
            );
          });
        });
    });
    return result;
  };

  /**
   * One cone's scattered term in the voxel-native look: underwater, the
   * brightest channel capped at `scatterCeiling` (a submerged beam glows
   * murky instead of whiting out); the other channels keep their ratio to
   * it, so water's red-first extinction still tints the shaft.
   */
  const styled = (scatter: Vec3Node, submersion: FloatNode): Vec3Node => {
    const top = LIGHT_CONES.scatterCeiling;
    const peak = max(max(scatter.x, scatter.y), scatter.z);
    const level = min(peak.div(top), 1);
    const capped = scatter.mul(level.mul(top).div(max(peak, 1e-8)));
    return submersion
      .greaterThan(0)
      .and(peak.greaterThan(0))
      .select(mix(scatter, capped, submersion), scatter);
  };

  /**
   * The light the beams scatter toward the eye along the view ray up to
   * `fragDist`: `scatterSamples` taps spread over the stretch inside each
   * cone (found exactly, so none land outside it), snapped to the block
   * texel grid underwater, attenuated by the water along both legs.
   */
  const scatter = Fn(
    ([cam, rayDir, fragDist]: [Vec3Node, Vec3Node, FloatNode]) => {
      const total = vec3(0).toVar();
      Loop({ start: int(0), end: int(LIGHT_CONES.maxCones) }, ({ i }) => {
        If(i.greaterThanEqual(u.coneCount.toInt()), () => {
          Break();
        });
        const origin = slot(i, 0);
        const shape = slot(i, 3);
        const submersion = origin.w;
        // Clear air scatters a few percent of what murky water does: enough
        // to see the shaft of a strong beam, nowhere near a white-out.
        const strength = shape.w.mul(mix(0.05, 1, submersion));
        const maxT = min(fragDist, distance(cam, origin.xyz).add(shape.z));
        If(strength.lessThanEqual(0).or(maxT.lessThanEqual(0)), () => {
          Continue();
        });
        const seg = segment(i, cam, rayDir, maxT);
        If(seg.y.lessThanEqual(seg.x), () => {
          Continue();
        });
        const step = seg.y.sub(seg.x).div(LIGHT_CONES.scatterSamples);
        // The texel grid the samples snap to underwater; dry air stays smooth.
        const snap = submersion
          .greaterThan(0.5)
          .select(float(LIGHT_CONES.scatterTexelsPerBlock), float(0));
        const snapInv = float(1).div(max(snap, 1e-3));
        const snapOffset = snapInv.mul(0.5).sub(origin.xyz);
        const sum = vec3(0).toVar();
        for (let k = 0; k < LIGHT_CONES.scatterSamples; k++) {
          const t = seg.x.add(step.mul(k + 0.5));
          const samplePoint = cam.add(rayDir.mul(t));
          const toSample = snap
            .greaterThan(0)
            .select(
              floor(samplePoint.mul(snap)).mul(snapInv).add(snapOffset),
              samplePoint.sub(origin.xyz),
            );
          const axial = length(toSample);
          If(axial.greaterThanEqual(1e-3).and(axial.lessThan(shape.z)), () => {
            const angular = clamp(
              dot(toSample.div(axial), slot(i, 1).xyz)
                .sub(shape.x)
                .mul(shape.y),
              0,
              1,
            );
            const n = axial.div(shape.z);
            const fall = n.mul(n).oneMinus();
            sum.addAssign(
              exp(EXTINCTION.negate().mul(axial.add(t)).mul(submersion)).mul(
                angular.mul(angular).mul(fall.mul(fall)),
              ),
            );
          });
        }
        total.addAssign(
          slot(i, 2).xyz.mul(styled(sum.mul(strength.mul(step)), submersion)),
        );
      });
      return total;
    },
  );

  /** `color` with the beams' glow added along the view ray to `worldPosition`. */
  const applyScatter = (color: Vec3Node, worldPosition: Vec3Node): Vec3Node => {
    const ray = worldPosition.sub(cameraPosition);
    const dist = max(length(ray), 1e-4);
    return u.coneCount
      .greaterThan(0)
      .select(color.add(scatter(cameraPosition, ray.div(dist), dist)), color);
  };

  /**
   * The cones on a flat-faced entity, whose normal is the face's own (from
   * screen derivatives), screen-blended into the light it is already shaded
   * with, the way the chunk shading blends them into its own.
   */
  const entityLit = (light: Vec3Node, worldPosition: Vec3Node): Vec3Node => {
    const normal = screenFaceNormal(worldPosition);
    const base = min(light, vec3(1));
    return max(
      light,
      base.oneMinus().mul(surface(worldPosition, normal).oneMinus()).oneMinus(),
    );
  };

  return { surface, scatter, applyScatter, entityLit };
}

export type LightConeShading = ReturnType<typeof lightConeShading>;
