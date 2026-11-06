import {
  cameraViewMatrix,
  clamp,
  materialColor,
  modelWorldMatrix,
  normalGeometry,
  normalize,
  positionWorld,
  cos,
  dot,
  float,
  Fn,
  If,
  int,
  mat2,
  mat3,
  max,
  min,
  mix,
  select,
  sin,
  smoothstep,
  sqrt,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import {
  type EntityShadowBodyInputs,
  type EntityShadowUniforms,
  materialShadowBody,
  sharedEntityShadowUniforms,
  unplacedShadowBody,
} from "../entity-shadow-uniforms";

import { clipDepthTo01, ndcToTargetUv } from "./conventions";
import type { FloatNode, Mat4Node, Vec3Node, Vec4Node } from "./types";

const POISSON_DISK = [
  [-0.94201624, -0.39906216],
  [0.94558609, -0.7689072],
  [-0.094184101, -0.9293887],
  [0.34495938, 0.2938776],
  [-0.91588581, 0.45771432],
  [-0.81544232, -0.87912464],
  [0.97484398, 0.75648379],
  [0.44323325, -0.97511554],
] as const;

const EDGE_FADE = 0.08;

/**
 * The sun's shadow on an entity (a character's parts, a creature, the
 * first-person arm), from the near cascade: PCSS (a blocker search, then a
 * rotated Poisson filter as wide as the penumbra), faded out past the
 * second split and floored at 0.6, so bodies keep their form in shade.
 * `u` is the world's lighting (`sharedEntityShadowUniforms`), `body` the
 * body's own inputs: where its shadow-map position is offset from its
 * world one, its bounds and whether it shades itself.
 */
export function entityShadow(
  u: EntityShadowUniforms,
  body: EntityShadowBodyInputs = unplacedShadowBody(),
) {
  const map = u.uShadowMap0;

  /** The near cascade's PCSS visibility at a shadow-map position. */
  const pcss = (shadowCoord: Vec4Node, bias: FloatNode): FloatNode =>
    Fn(() => {
      const ndc = shadowCoord.xyz.div(shadowCoord.w);
      const coord = vec3(ndcToTargetUv(ndc.xy), clipDepthTo01(ndc.z)).toVar();
      const visibility = float(1).toVar();
      const isInside = coord.x
        .greaterThanEqual(0)
        .and(coord.x.lessThanEqual(1))
        .and(coord.y.greaterThanEqual(0))
        .and(coord.y.lessThanEqual(1))
        .and(coord.z.greaterThanEqual(0))
        .and(coord.z.lessThanEqual(1));
      If(isInside, () => {
        const texel = vec2(1).div(vec2(map.size(int(0)) as never));
        const occludes = (depth: FloatNode) => {
          const diff = coord.z.sub(depth);
          return diff.greaterThan(bias).and(diff.greaterThanEqual(body.minOccluderDepth));
        };
        const blockerSum = float(0).toVar();
        const blockerCount = float(0).toVar();
        for (let i = 0; i < 4; i++) {
          const [x, y] = POISSON_DISK[i * 2];
          const depth = map.sample(coord.xy.add(vec2(x, y).mul(texel).mul(3))).r;
          If(occludes(depth), () => {
            blockerSum.addAssign(depth);
            blockerCount.addAssign(1);
          });
        }
        If(blockerCount.greaterThanEqual(0.5), () => {
          const avgBlocker = blockerSum.div(blockerCount);
          const penumbra = coord.z.sub(avgBlocker).div(avgBlocker);
          const radius = clamp(penumbra.mul(2), 1, 3);
          const noise = dot(coord.xy, vec2(12.9898, 78.233))
            .sin()
            .mul(43758.5453)
            .fract();
          const angle = noise.mul(Math.PI * 2);
          const rotation = mat2(cos(angle), sin(angle).negate(), sin(angle), cos(angle));
          let lit: FloatNode = select(occludes(map.sample(coord.xy).r), 0, 1);
          for (const [x, y] of POISSON_DISK) {
            const offset = rotation.mul(vec2(x, y)).mul(texel).mul(radius);
            lit = lit.add(select(occludes(map.sample(coord.xy.add(offset)).r), 0, 1));
          }
          const fade = smoothstep(0, EDGE_FADE, coord.x)
            .mul(smoothstep(0, EDGE_FADE, coord.x.oneMinus()))
            .mul(smoothstep(0, EDGE_FADE, coord.y))
            .mul(smoothstep(0, EDGE_FADE, coord.y.oneMinus()));
          visibility.assign(mix(1, lit.div(9), fade));
        });
      });
      return visibility;
    })() as FloatNode;

  /** The world position's place in the shadow map (the body's offset applied). */
  const shadowPosition = (worldPosition: Vec3Node): Vec4Node =>
    vec4(
      body.worldMatrix.mul(vec4(worldPosition, 1)).xyz.add(body.worldOffset),
      1,
    );

  /**
   * Visibility under `bias`: the map read at the body's shadow-space
   * position, the fade measured along the camera from its world position.
   */
  const withBias = (
    worldPosition: Vec3Node,
    shadowPositionWorld: Vec3Node,
    bias: FloatNode,
  ): FloatNode =>
    Fn(() => {
      const strength = u.uShadowStrength.mul(u.uSunlightIntensity);
      const viewDepth = cameraViewMatrix.mul(vec4(worldPosition, 1)).z.negate();
      const visibility = float(1).toVar();
      If(
        strength.greaterThanEqual(0.01).and(viewDepth.lessThanEqual(u.uCascadeSplit1)),
        () => {
          const raw = pcss(
            u.uShadowMatrix0.mul(vec4(shadowPositionWorld, 1)),
            bias,
          ).toVar();
          const fadeStart = u.uCascadeSplit1.mul(0.7);
          If(viewDepth.greaterThan(fadeStart), () => {
            raw.assign(
              mix(raw, 1, viewDepth.sub(fadeStart).div(u.uCascadeSplit1.sub(fadeStart))),
            );
          });
          visibility.assign(max(mix(1, raw, strength.mul(0.65)), 0.6));
        },
      );
      return visibility;
    })() as FloatNode;

  /**
   * Shadow-map depth from `worldPosition` toward the sun to where the ray
   * leaves `bounds` (the body's own sphere in world space), unbounded for a
   * radius of 0 or a point outside it.
   */
  const selfDepthWithin = (worldPosition: Vec3Node, bounds: Vec4Node): FloatNode => {
    const offset = worldPosition.sub(bounds.xyz);
    const inside = dot(offset, offset).sub(bounds.w.mul(bounds.w));
    const along = dot(offset, u.uSunDirection);
    const exit = sqrt(max(along.mul(along).sub(inside), 0)).sub(along);
    return select(
      bounds.w.lessThanEqual(0).or(inside.greaterThan(0)),
      float(1e9),
      exit.mul(u.uShadowDepthPerBlock),
    );
  };

  /**
   * The plain entity shadow: slope-scaled bias off the sun-averted faces.
   * `normal` is in the body's shadow space (`shadowNormal`).
   */
  const at = (normal: Vec3Node, worldPosition: Vec3Node): FloatNode => {
    const cosTheta = clamp(dot(normal, u.uSunDirection), 0, 1);
    return withBias(
      worldPosition,
      shadowPosition(worldPosition).xyz,
      u.uShadowBias.add(u.uShadowNormalBias.mul(cosTheta.oneMinus())),
    );
  };

  /** A world-space normal turned into the body's shadow space. */
  const shadowNormal = (worldNormal: Vec3Node): Vec3Node =>
    mat3(body.worldMatrix).mul(worldNormal).normalize();

  /**
   * For a body that knows its bounds: the slope bias that keeps a
   * sun-averted face out of its own body's shadow never reaches past them,
   * so whatever lies beyond still shades every face. With `ignoresSelf`,
   * nothing inside the bounds shades any face.
   */
  const within = (
    normal: Vec3Node,
    worldPosition: Vec3Node,
    bounds: Vec4Node = body.selfBounds,
  ): FloatNode => {
    const cosTheta = clamp(dot(normal, u.uSunDirection), 0, 1);
    const slopeBias = u.uShadowNormalBias.mul(cosTheta.oneMinus());
    const position = shadowPosition(worldPosition).xyz.toVar();
    const selfDepth = selfDepthWithin(position, bounds);
    const selfBias = select(
      body.ignoresSelf.greaterThan(0.5),
      select(selfDepth.lessThan(1e8), selfDepth, 0),
      min(slopeBias, selfDepth),
    );
    return withBias(worldPosition, position, u.uShadowBias.add(selfBias));
  };

  return { at, within, shadowNormal, shadowPosition };
}

export type EntityShadowShading = ReturnType<typeof entityShadow>;

/**
 * A body part's colour under the sun's shadow: `base` (by default the
 * material's colour times its map, three's own colour node) times the
 * entity shadow at the fragment, from the geometry's own normal carried to
 * the world. For a basic material's `colorNode`, so the world's fog lands
 * over the shadowed colour. `"within"` caps the slope bias at the body's
 * own bounds; `"at"` is the plain slope bias.
 */
export function shadowedBodyColor(
  u: EntityShadowUniforms,
  options: {
    base?: Vec4Node;
    bias?: "at" | "within";
    body?: EntityShadowBodyInputs;
  } = {},
): Vec4Node {
  const shadow = entityShadow(u, options.body);
  const base = options.base ?? vec4(materialColor as never);
  // A shape without normals carries zero vectors, which do not normalize.
  const raw = mat3(modelWorldMatrix).mul(normalGeometry);
  const worldNormal = select(
    dot(raw, raw).greaterThan(0),
    normalize(raw),
    vec3(0, 1, 0),
  );
  const normal = shadow.shadowNormal(worldNormal);
  const visibility =
    options.bias === "within"
      ? shadow.within(normal, positionWorld)
      : shadow.at(normal, positionWorld);
  return vec4(base.rgb.mul(visibility), base.a);
}

let bodyColor: Vec4Node | null = null;

/**
 * The colour node of a body part drawn with a basic material: its colour
 * and map under the world's sun, bounded by the body it belongs to (the
 * material's `setShadowBody`). One node, so every such part of every body
 * shares one graph.
 */
export function shadowedBodyColorNode(): Vec4Node {
  bodyColor ??= shadowedBodyColor(sharedEntityShadowUniforms, {
    bias: "within",
    body: materialShadowBody(),
  });
  return bodyColor;
}

/**
 * A body's bounding sphere (`sphere`: centre and radius in its own space)
 * carried to the world by `toWorld`, the radius scaled by the matrix's
 * largest axis and widened by `margin`: the bounds `within` caps the
 * self-shadow bias at. A radius of 0 (no bounds yet) stays 0.
 */
export function shadowBoundsToWorld(
  toWorld: Mat4Node,
  sphere: Vec4Node,
  margin: FloatNode | number = 0,
): Vec4Node {
  const axis = (i: number) =>
    (toWorld as unknown as { element(i: unknown): Vec4Node }).element(int(i))
      .xyz;
  const scale = sqrt(
    max(dot(axis(0), axis(0)), max(dot(axis(1), axis(1)), dot(axis(2), axis(2)))),
  );
  const center = toWorld.mul(vec4(sphere.xyz, 1)).xyz;
  const radius = sphere.w.mul(scale);
  return vec4(center, select(radius.greaterThan(0), radius.add(margin), radius));
}
