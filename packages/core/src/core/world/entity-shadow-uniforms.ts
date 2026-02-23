import { IUniform, Matrix4, Texture, Vector3 } from "three";

import { ShaderLightingUniforms } from "./chunk-renderer";

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
