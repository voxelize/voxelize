import { Color, IUniform, Matrix4, Texture, Vector3, Vector4 } from "three";

import { ShaderLightingUniforms } from "./chunk-renderer";
import {
  SHADOW_POISSON_DISK,
  SHADOW_SAMPLE_FUNCTIONS,
} from "./shadow-sampling";

export type { ShaderLightingUniforms };

export interface EntityShadowUniforms {
  uShadowMap0: IUniform<Texture | null>;
  uShadowMap1: IUniform<Texture | null>;
  uShadowMap2: IUniform<Texture | null>;
  uShadowMatrix0: IUniform<Matrix4>;
  uShadowMatrix1: IUniform<Matrix4>;
  uShadowMatrix2: IUniform<Matrix4>;
  uCascadeSplit0: IUniform<number>;
  uCascadeSplit1: IUniform<number>;
  uCascadeSplit2: IUniform<number>;
  uShadowBias: IUniform<number>;
  uShadowNormalBias: IUniform<number>;
  uShadowStrength: IUniform<number>;
  uSunlightIntensity: IUniform<number>;
  uSunDirection: IUniform<Vector3>;
  uSunColor: IUniform<Color>;
  uWorldOffset: IUniform<Vector3>;
  uMinOccluderDepth: IUniform<number>;
  /**
   * The receiving body's own bounding sphere in world space (centre, radius;
   * radius 0 for none), read by `getEntityShadowAt`: an occluder inside it,
   * along the ray to the sun, is the body itself and casts nothing onto it.
   * A body shares one vector across all of its parts' uniforms.
   */
  uShadowSelfBounds: IUniform<Vector4>;
  /**
   * 1 when nothing inside `uShadowSelfBounds` may shade the surface on any
   * face: a first-person viewmodel, held at the eye while the body behind
   * it still casts. 0 (the default) keeps a body's own shadow on the faces
   * that look toward the sun, as a head shades the shoulders below it.
   */
  uShadowIgnoresSelf: IUniform<number>;
  /**
   * Carries the frame a surface is drawn in into the world its shadows are
   * cast in; identity for anything drawn in the world. A viewmodel drawn in
   * a scene of its own about the eye sets where that scene sits.
   */
  uShadowWorldMatrix: IUniform<Matrix4>;
  /** Near-cascade shadow-map depth per block along the light. */
  uShadowDepthPerBlock: IUniform<number>;
}

export function createEntityShadowUniforms(): EntityShadowUniforms {
  return {
    uShadowMap0: { value: null },
    uShadowMap1: { value: null },
    uShadowMap2: { value: null },
    uShadowMatrix0: { value: new Matrix4() },
    uShadowMatrix1: { value: new Matrix4() },
    uShadowMatrix2: { value: new Matrix4() },
    uCascadeSplit0: { value: 16 },
    uCascadeSplit1: { value: 48 },
    uCascadeSplit2: { value: 128 },
    uShadowBias: { value: 0.0005 },
    uShadowNormalBias: { value: 0.01 },
    uShadowStrength: { value: 1.0 },
    uSunlightIntensity: { value: 1.0 },
    uSunDirection: { value: new Vector3(0.5, 1.0, 0.3).normalize() },
    uSunColor: { value: new Color(1, 1, 1) },
    uWorldOffset: { value: new Vector3(0, 0, 0) },
    uMinOccluderDepth: { value: 0.0 },
    uShadowSelfBounds: { value: new Vector4(0, 0, 0, 0) },
    uShadowIgnoresSelf: { value: 0 },
    uShadowWorldMatrix: { value: new Matrix4() },
    uShadowDepthPerBlock: { value: 0.0 },
  };
}

export function updateEntityShadowUniforms(
  target: EntityShadowUniforms,
  source: ShaderLightingUniforms,
): void {
  target.uShadowMap0.value = source.shadowMap0.value;
  target.uShadowMap1.value = source.shadowMap1.value;
  target.uShadowMap2.value = source.shadowMap2.value;
  target.uShadowMatrix0.value.copy(source.shadowMatrix0.value);
  target.uShadowMatrix1.value.copy(source.shadowMatrix1.value);
  target.uShadowMatrix2.value.copy(source.shadowMatrix2.value);
  target.uCascadeSplit0.value = source.cascadeSplit0.value;
  target.uCascadeSplit1.value = source.cascadeSplit1.value;
  target.uCascadeSplit2.value = source.cascadeSplit2.value;
  target.uShadowBias.value = source.shadowBias.value;
  target.uShadowStrength.value = source.shadowStrength.value;
  target.uSunlightIntensity.value = source.sunlightIntensity.value;
  target.uSunDirection.value.copy(source.sunDirection.value);
  target.uSunColor.value.copy(source.sunColor.value);
  target.uShadowDepthPerBlock.value = shadowDepthPerBlock(
    source.shadowMatrix0.value,
    source.sunDirection.value,
  );
}

/**
 * How far the depth stored in a shadow map moves per block along the light:
 * the map is an orthographic projection, so this is one number per cascade,
 * the depth component of the light direction carried through its matrix.
 */
export function shadowDepthPerBlock(
  shadowMatrix: Matrix4,
  lightDirection: Vector3,
): number {
  const e = shadowMatrix.elements;
  const clipDepth =
    e[2] * lightDirection.x +
    e[6] * lightDirection.y +
    e[10] * lightDirection.z;
  return Math.abs(0.5 * clipDepth);
}

export const ENTITY_SHADOW_VERTEX_PARS = `
uniform mat4 uShadowMatrix0;
uniform mat4 uShadowMatrix1;
uniform mat4 uShadowMatrix2;
uniform vec3 uWorldOffset;
uniform mat4 uShadowWorldMatrix;

varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;
varying float vViewDepth;
`;

/**
 * Vertex-stage GLSL for self bounds that ride a transform instead of a
 * uniform: `entityShadowBoundsToWorld(toWorld, localSphere)` carries a
 * sphere (centre, radius) through `toWorld`, scaling the radius by its
 * largest axis. An instanced pool passes its instance matrix and the drawn
 * geometry's own sphere, so every instance is bounded by its own body; the
 * fragment stage hands the result to `getEntityShadowWithin`.
 */
export const ENTITY_SHADOW_BOUNDS_VERTEX_FUNCTIONS = `
vec4 entityShadowBoundsToWorld(mat4 toWorld, vec4 localSphere) {
  vec3 center = (toWorld * vec4(localSphere.xyz, 1.0)).xyz;
  float axisScale = sqrt(max(
    dot(toWorld[0].xyz, toWorld[0].xyz),
    max(dot(toWorld[1].xyz, toWorld[1].xyz), dot(toWorld[2].xyz, toWorld[2].xyz))
  ));
  return vec4(center, localSphere.w * axisScale);
}
`;

export const ENTITY_SHADOW_VERTEX_MAIN = `
vec4 shadowWorldPos = vec4(
  (uShadowWorldMatrix * vec4(worldPosition.xyz, 1.0)).xyz + uWorldOffset,
  1.0
);
vShadowCoord0 = uShadowMatrix0 * shadowWorldPos;
vShadowCoord1 = uShadowMatrix1 * shadowWorldPos;
vShadowCoord2 = uShadowMatrix2 * shadowWorldPos;
vec4 viewPos = viewMatrix * vec4(worldPosition.xyz, 1.0);
vViewDepth = -viewPos.z;
`;

export const ENTITY_SHADOW_FRAGMENT_PARS = `
uniform sampler2D uShadowMap0;
uniform sampler2D uShadowMap1;
uniform sampler2D uShadowMap2;
uniform float uCascadeSplit0;
uniform float uCascadeSplit1;
uniform float uCascadeSplit2;
uniform float uShadowBias;
uniform float uShadowNormalBias;
uniform float uShadowStrength;
uniform float uSunlightIntensity;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uMinOccluderDepth;
uniform vec4 uShadowSelfBounds;
uniform float uShadowIgnoresSelf;
uniform float uShadowDepthPerBlock;

varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;
varying float vViewDepth;

${SHADOW_POISSON_DISK}

${SHADOW_SAMPLE_FUNCTIONS}

float entityShadowWithBias(float bias) {
  float effectiveStrength = uShadowStrength * uSunlightIntensity;
  
  if (effectiveStrength < 0.01) {
    return 1.0;
  }

  float rawShadow = sampleShadowMapPCSS(uShadowMap0, vShadowCoord0, bias);

  float maxEntityDist = uCascadeSplit1;
  if (vViewDepth > maxEntityDist) {
    return 1.0;
  }
  float fadeStart = maxEntityDist * 0.7;
  if (vViewDepth > fadeStart) {
    float t = (vViewDepth - fadeStart) / (maxEntityDist - fadeStart);
    rawShadow = mix(rawShadow, 1.0, t);
  }

  float shadow = mix(1.0, rawShadow, effectiveStrength * 0.65);
  return max(shadow, 0.6);
}

float getEntityShadow(vec3 worldNormal) {
  float cosTheta = clamp(dot(worldNormal, uSunDirection), 0.0, 1.0);
  return entityShadowWithBias(uShadowBias + uShadowNormalBias * (1.0 - cosTheta));
}

// Shadow-map depth from worldPosition, toward the sun, to where the ray
// leaves selfBounds, the body's own bounding sphere in world space (centre,
// radius). Unbounded for radius 0, or for a point outside the sphere
// (bounds that do not describe this surface).
float entityShadowSelfDepthWithin(vec3 worldPosition, vec4 selfBounds) {
  float radius = selfBounds.w;
  vec3 offset = worldPosition - selfBounds.xyz;
  float inside = dot(offset, offset) - radius * radius;
  if (radius <= 0.0 || inside > 0.0) {
    return 1e9;
  }
  float along = dot(offset, uSunDirection);
  float exitDistance = -along + sqrt(along * along - inside);
  return exitDistance * uShadowDepthPerBlock;
}

float entityShadowSelfDepth(vec3 worldPosition) {
  return entityShadowSelfDepthWithin(worldPosition, uShadowSelfBounds);
}

// getEntityShadow for a body that knows its own bounds: the slope-scaled
// bias that keeps a sun-averted face out of its own body's shadow never
// reaches past those bounds, so whatever lies beyond them (a deck, a
// canopy, another body) still shades every face. For bounds that differ per
// draw or per instance (see ENTITY_SHADOW_BOUNDS_VERTEX_FUNCTIONS).
// With uShadowIgnoresSelf, nothing inside the bounds shades any face.
float getEntityShadowWithin(
  vec3 worldNormal,
  vec3 worldPosition,
  vec4 selfBounds
) {
  float cosTheta = clamp(dot(worldNormal, uSunDirection), 0.0, 1.0);
  float slopeBias = uShadowNormalBias * (1.0 - cosTheta);
  float selfDepth = entityShadowSelfDepthWithin(worldPosition, selfBounds);
  float selfBias = uShadowIgnoresSelf > 0.5
    ? (selfDepth < 1e8 ? selfDepth : 0.0)
    : min(slopeBias, selfDepth);
  return entityShadowWithBias(uShadowBias + selfBias);
}

// getEntityShadowWithin, bounded by uShadowSelfBounds.
float getEntityShadowAt(vec3 worldNormal, vec3 worldPosition) {
  return getEntityShadowWithin(worldNormal, worldPosition, uShadowSelfBounds);
}
`;
