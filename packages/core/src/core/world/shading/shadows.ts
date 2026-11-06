import {
  abs,
  dFdx,
  dFdy,
  dot,
  float,
  Fn,
  int,
  If,
  Loop,
  max,
  mix,
  select,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import type { ShaderLightingUniforms, TextureInput } from "./chunk-uniforms";
import { clipDepthTo01, ndcToTargetUv } from "./conventions";
import type { Node } from "three/webgpu";

import type {
  FloatNode,
  Mat4Node,
  UVec2Node,
  Vec2Node,
  Vec3Node,
} from "./types";

/**
 * `Loop` with a named counter (three passes it to the body under its name,
 * so nested loops keep apart); r187's typings omit `name`.
 */
const namedLoop = Loop as unknown as <N extends string>(
  params: {
    start: Node<"int">;
    end: Node<"int">;
    type: "int";
    condition: "<" | "<=";
    name: N;
  },
  body: (inputs: Record<N, Node<"int">>) => void,
) => void;

const RECEIVER_PLANE_EPSILON = 0.000001;
/** Width of the fade at each cascade's map edge, in map uv. */
const EDGE_FADE = 0.08;
/** Share of each split over which a cascade hands over to the next. */
const CASCADE_BLEND = 0.1;

type CascadeCoord = {
  /** Map uv (xy) and receiver depth (z), both 0..1. */
  coord: Vec3Node;
  /** Receiver-plane depth slope per unit of map uv. */
  plane: Vec2Node;
};

/**
 * A fragment's position in one cascade's map, and how its depth changes
 * across the map's texels. Derivatives are taken here, at the top of the
 * fragment, in uniform control flow: the cascades are picked per fragment.
 */
function cascadeCoord(
  shadowMatrix: Mat4Node,
  worldPosition: Vec3Node,
  normal: Vec3Node,
  normalBias: FloatNode,
): CascadeCoord {
  const offset = worldPosition.add(normal.mul(normalBias));
  const clip = shadowMatrix.mul(vec4(offset, 1));
  const ndc = clip.xyz.div(clip.w);
  const coord = vec3(ndcToTargetUv(ndc.xy), clipDepthTo01(ndc.z)).toVar();
  const dx = dFdx(coord);
  const dy = dFdy(coord);
  const determinant = dx.x.mul(dy.y).sub(dx.y.mul(dy.x));
  const plane = select(
    abs(determinant).lessThan(RECEIVER_PLANE_EPSILON),
    vec2(0),
    vec2(
      dy.y.mul(dx.z).sub(dx.y.mul(dy.z)),
      dx.x.mul(dy.z).sub(dy.x.mul(dx.z)),
    ).div(determinant),
  ).toVar();
  return { coord, plane };
}

const edgeFade = (coord: Vec3Node): FloatNode =>
  smoothstep(0, EDGE_FADE, coord.x)
    .mul(smoothstep(0, EDGE_FADE, coord.x.oneMinus()))
    .mul(smoothstep(0, EDGE_FADE, coord.y))
    .mul(smoothstep(0, EDGE_FADE, coord.y.oneMinus()));

const isOutside = (coord: Vec3Node) =>
  coord.x
    .lessThan(0)
    .or(coord.x.greaterThan(1))
    .or(coord.y.lessThan(0))
    .or(coord.y.greaterThan(1))
    .or(coord.z.lessThan(0))
    .or(coord.z.greaterThan(1));

/**
 * One cascade's visibility at a fragment: 1 lit, 0 in shadow. `soft` takes
 * a 5x5 tent-weighted PCF; otherwise the 5-tap cross, for surfaces whose
 * own motion (waves) or layering (panes, leaves) would swallow the
 * difference. Each tap compares the receiver's depth carried along its
 * plane to the tap, so a slope does not self-shadow across the kernel.
 */
function sampleCascade(
  map: TextureInput,
  { coord, plane }: CascadeCoord,
  bias: FloatNode,
  soft: boolean,
): FloatNode {
  const texel = vec2(1).div(vec2(map.size(int(0)) as unknown as UVec2Node));
  const tapAt = (step: Vec2Node): FloatNode => {
    const offset = texel.mul(step);
    const receiver = coord.z.add(dot(plane, offset));
    const depth = map.sample(coord.xy.add(offset)).r;
    return select(receiver.sub(bias).greaterThan(depth), 0, 1);
  };
  const tap = (x: number, y: number) => tapAt(vec2(x, y));
  let shadow: FloatNode;
  if (soft) {
    // A loop, not 25 copies of the tap: the GPU compiler unrolls it, and the
    // shader stays small enough to build and compile quickly. Tent weights
    // (3 - |x|)(3 - |y|) sum to 81 over the 5x5.
    const sum = float(0).toVar();
    namedLoop({ start: int(-2), end: int(2), type: "int", condition: "<=", name: "pcfX" }, ({ pcfX }) => {
      namedLoop({ start: int(-2), end: int(2), type: "int", condition: "<=", name: "pcfY" }, ({ pcfY }) => {
        const weight = float(int(3).sub(abs(pcfX)).mul(int(3).sub(abs(pcfY))));
        sum.addAssign(tapAt(vec2(float(pcfX), float(pcfY))).mul(weight));
      });
    });
    shadow = sum.div(81);
  } else {
    shadow = tap(0, 0)
      .add(tap(-1, -1))
      .add(tap(1, -1))
      .add(tap(-1, 1))
      .add(tap(1, 1))
      .div(5);
  }
  return select(isOutside(coord), 1, mix(1, shadow, edgeFade(coord)));
}

export type SunShadowOptions = {
  /**
   * The 5-tap cross in the near cascades too, for surfaces whose own
   * motion or layering swallows soft shadow detail (water, panes, leaves).
   */
  isFast: boolean;
};

/**
 * The sun's cascaded shadow over one world's uniforms. `visibility` is 1
 * where the sun reaches the fragment and 0 under a caster, faded by
 * `shadowStrength`, with the cascades blended over the last tenth of each
 * split and the far one fading out to lit.
 */
export function sunShadow(u: ShaderLightingUniforms) {
  return ({
    worldPosition,
    normal,
    viewDepth,
    sunExposure,
    ndotl,
    options,
  }: {
    worldPosition: Vec3Node;
    normal: Vec3Node;
    viewDepth: FloatNode;
    /** The voxel's sunlight, 0..1: an unlit cave takes the shadow outright. */
    sunExposure: FloatNode;
    /** The shading light's incidence (a cross plant passes its fixed 0.5). */
    ndotl: FloatNode;
    options: SunShadowOptions;
  }): FloatNode => {
    const cascades = [
      cascadeCoord(u.shadowMatrix0, worldPosition, normal, u.shadowNormalBias),
      cascadeCoord(u.shadowMatrix1, worldPosition, normal, u.shadowNormalBias),
      cascadeCoord(u.shadowMatrix2, worldPosition, normal, u.shadowNormalBias),
    ];
    return Fn(() => {
      const unlit = mix(1, 0, u.shadowStrength);
      const visibility = float(1).toVar();
      If(ndotl.lessThanEqual(0), () => {
        visibility.assign(unlit);
      })
        .ElseIf(u.shadowStrength.lessThan(0.01), () => {
          visibility.assign(1);
        })
        .ElseIf(sunExposure.lessThan(0.05), () => {
          visibility.assign(unlit);
        })
        .Else(() => {
        const slopeBias = max(
          u.shadowSlopeBiasScale.mul(ndotl.oneMinus()),
          u.shadowSlopeBiasMin,
        );
        const topFace = smoothstep(0.5, 0.95, normal.y);
        const sideFace = smoothstep(
          0.5,
          0.95,
          max(abs(normal.x), abs(normal.z)),
        );
        const receiverScale = mix(
          mix(1, u.shadowSideFaceBiasScale, sideFace),
          u.shadowTopFaceBiasScale,
          topFace,
        );
        const bias = (scale: number) =>
          u.shadowBias.add(slopeBias.mul(scale)).mul(receiverScale);
        const soft = !options.isFast;
        const cascade = (index: number, scale: number, isSoft: boolean) =>
          sampleCascade(
            [u.shadowMap0, u.shadowMap1, u.shadowMap2][index],
            cascades[index],
            bias(scale),
            isSoft,
          );
        // Each band hands over to the next over its last tenth.
        const handover = (split: FloatNode) => {
          const start = split.mul(1 - CASCADE_BLEND);
          return viewDepth.sub(start).div(split.sub(start)).max(0);
        };

        If(viewDepth.lessThan(u.cascadeSplit0), () => {
          const t = handover(u.cascadeSplit0);
          const shadow0 = cascade(0, 1, soft).toVar();
          If(t.greaterThan(0), () => {
            shadow0.assign(mix(shadow0, cascade(1, 1.5, soft), t));
          });
          visibility.assign(mix(1, shadow0, u.shadowStrength));
        })
          .ElseIf(viewDepth.lessThan(u.cascadeSplit1), () => {
            const t = handover(u.cascadeSplit1);
            const shadow1 = cascade(1, 1.5, soft).toVar();
            If(t.greaterThan(0), () => {
              shadow1.assign(mix(shadow1, cascade(2, 2, false), t));
            });
            visibility.assign(mix(1, shadow1, u.shadowStrength));
          })
          .ElseIf(viewDepth.lessThan(u.cascadeSplit2), () => {
            const t = handover(u.cascadeSplit2);
            const shadow2 = mix(cascade(2, 2, false), 1, t);
            visibility.assign(mix(1, shadow2, u.shadowStrength));
          });
      });
      return visibility;
    })() as FloatNode;
  };
}
