import { IUniform, Matrix4, Texture, Vector3 } from "three";

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
  uWorldOffset: IUniform<Vector3>;
  uMinOccluderDepth: IUniform<number>;
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
    uWorldOffset: { value: new Vector3(0, 0, 0) },
    uMinOccluderDepth: { value: 0.0 },
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
}

export const ENTITY_SHADOW_VERTEX_PARS = `
uniform mat4 uShadowMatrix0;
uniform mat4 uShadowMatrix1;
uniform mat4 uShadowMatrix2;
uniform vec3 uWorldOffset;

varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;
varying float vViewDepth;
`;

export const ENTITY_SHADOW_VERTEX_MAIN = `
vec4 shadowWorldPos = vec4(worldPosition.xyz + uWorldOffset, 1.0);
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
uniform float uMinOccluderDepth;

varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;
varying float vViewDepth;

${SHADOW_POISSON_DISK}

${SHADOW_SAMPLE_FUNCTIONS}

float getEntityShadow(vec3 worldNormal) {
  float effectiveStrength = uShadowStrength * uSunlightIntensity;
  
  if (effectiveStrength < 0.01) {
    return 1.0;
  }

  float cosTheta = clamp(dot(worldNormal, uSunDirection), 0.0, 1.0);
  float bias = uShadowBias + uShadowNormalBias * (1.0 - cosTheta);

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
`;
