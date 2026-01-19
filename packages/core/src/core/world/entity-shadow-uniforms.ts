import { IUniform, Matrix4, Texture, Vector3 } from "three";

import { ShaderLightingUniforms } from "./chunk-renderer";
import {
  SHADOW_MIN_LIGHT,
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
  uShadowStrength: IUniform<number>;
  uSunDirection: IUniform<Vector3>;
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
    uShadowStrength: { value: 1.0 },
    uSunDirection: { value: new Vector3(0.5, 1.0, 0.3).normalize() },
  };
}

export function updateEntityShadowUniforms(
  target: EntityShadowUniforms,
  source: ShaderLightingUniforms
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
  target.uSunDirection.value.copy(source.sunDirection.value);
}

export const ENTITY_SHADOW_VERTEX_PARS = `
uniform mat4 uShadowMatrix0;
uniform mat4 uShadowMatrix1;
uniform mat4 uShadowMatrix2;

varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;
varying float vViewDepth;
`;

export const ENTITY_SHADOW_VERTEX_MAIN = `
vec4 worldPos4 = vec4(worldPosition.xyz, 1.0);
vShadowCoord0 = uShadowMatrix0 * worldPos4;
vShadowCoord1 = uShadowMatrix1 * worldPos4;
vShadowCoord2 = uShadowMatrix2 * worldPos4;
vec4 viewPos = viewMatrix * worldPos4;
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
uniform float uShadowStrength;
uniform vec3 uSunDirection;

varying vec4 vShadowCoord0;
varying vec4 vShadowCoord1;
varying vec4 vShadowCoord2;
varying float vViewDepth;

${SHADOW_POISSON_DISK}

${SHADOW_SAMPLE_FUNCTIONS}

float getEntityShadow(vec3 worldNormal) {
  if (uShadowStrength < 0.01) {
    return 1.0;
  }

  float bias = uShadowBias + 0.008;
  float blendRegion = 0.1;

  float rawShadow;
  if (vViewDepth < uCascadeSplit0) {
    float shadow0 = sampleShadowMapPCSS(uShadowMap0, vShadowCoord0, bias);
    float blendStart = uCascadeSplit0 * (1.0 - blendRegion);
    if (vViewDepth > blendStart) {
      float shadow1 = sampleShadowMapPCSS(uShadowMap1, vShadowCoord1, bias * 1.5);
      float t = (vViewDepth - blendStart) / (uCascadeSplit0 - blendStart);
      rawShadow = mix(shadow0, shadow1, t);
    } else {
      rawShadow = shadow0;
    }
  } else if (vViewDepth < uCascadeSplit1) {
    float shadow1 = sampleShadowMapPCSS(uShadowMap1, vShadowCoord1, bias * 1.5);
    float blendStart = uCascadeSplit1 * (1.0 - blendRegion);
    if (vViewDepth > blendStart) {
      float shadow2 = sampleShadowMapFast(uShadowMap2, vShadowCoord2, bias * 2.0);
      float t = (vViewDepth - blendStart) / (uCascadeSplit1 - blendStart);
      rawShadow = mix(shadow1, shadow2, t);
    } else {
      rawShadow = shadow1;
    }
  } else if (vViewDepth < uCascadeSplit2) {
    float shadow2 = sampleShadowMapFast(uShadowMap2, vShadowCoord2, bias * 2.0);
    float fadeStart = uCascadeSplit2 * (1.0 - blendRegion);
    if (vViewDepth > fadeStart) {
      float t = (vViewDepth - fadeStart) / (uCascadeSplit2 - fadeStart);
      rawShadow = mix(shadow2, 1.0, t);
    } else {
      rawShadow = shadow2;
    }
  } else {
    return 1.0;
  }

  float shadowValue = mix(1.0, rawShadow, uShadowStrength);
  return max(shadowValue, ${SHADOW_MIN_LIGHT});
}
`;
