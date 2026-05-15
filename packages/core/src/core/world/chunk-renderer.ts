import { Color, Matrix4, Texture, Vector2, Vector3, Vector4 } from "three";

import { CustomChunkShaderMaterial } from ".";

export interface ShaderLightingUniforms {
  sunDirection: { value: Vector3 };
  sunColor: { value: Color };
  ambientColor: { value: Color };
  shadowMap0: { value: Texture | null };
  shadowMap1: { value: Texture | null };
  shadowMap2: { value: Texture | null };
  shadowMatrix0: { value: Matrix4 };
  shadowMatrix1: { value: Matrix4 };
  shadowMatrix2: { value: Matrix4 };
  cascadeSplit0: { value: number };
  cascadeSplit1: { value: number };
  cascadeSplit2: { value: number };
  shadowBias: { value: number };
  shadowNormalBias: { value: number };
  shadowSlopeBiasScale: { value: number };
  shadowSlopeBiasMin: { value: number };
  shadowTopFaceBiasScale: { value: number };
  shadowSideFaceBiasScale: { value: number };
  shadowStrength: { value: number };
  sunlightIntensity: { value: number };
  waterTint: { value: Color };
  waterAbsorption: { value: number };
  waterLevel: { value: number };
  waterStreakStrength: { value: number };
  waterFresnelStrength: { value: number };
  skyTopColor: { value: Color };
  skyMiddleColor: { value: Color };
  shadowDebugMode: { value: number };
}

export class ChunkRenderer {
  public materials: Map<string, CustomChunkShaderMaterial> = new Map();

  public uniforms: {
    fogColor: { value: Color };
    fogNear: { value: number };
    fogFar: { value: number };
    ao: { value: Vector4 };
    minLightLevel: { value: number };
    baseAmbient: { value: number };
    sunlightIntensity: { value: number };
    time: { value: number };
    lightIntensityAdjustment: { value: number };
    atlasSize: { value: number };
    showGreedyDebug: { value: number };
    fogHeightOrigin: { value: number };
    fogHeightDensity: { value: number };
    windDirection: { value: Vector2 };
    windOffset: { value: Vector2 };
    windSpeed: { value: number };
    skyFogTopColor: { value: Color };
    skyFogMiddleColor: { value: Color };
    skyFogBottomColor: { value: Color };
    skyFogOffset: { value: number };
    skyFogVoidOffset: { value: number };
    skyFogExponent: { value: number };
    skyFogExponent2: { value: number };
    skyFogDimension: { value: number };
    skyFogStrength: { value: number };
  } = {
    fogColor: { value: new Color("#B1CCFD") },
    fogNear: { value: 100 },
    fogFar: { value: 200 },
    fogHeightOrigin: { value: 80 },
    fogHeightDensity: { value: 0.005 },
    windDirection: { value: new Vector2(0.7, 0.7) },
    windOffset: { value: new Vector2(0, 0) },
    windSpeed: { value: 1.0 },
    ao: { value: new Vector4(45.0, 105.0, 180.0, 255.0) },
    minLightLevel: { value: 0 },
    baseAmbient: { value: 0.001 },
    sunlightIntensity: { value: 1 },
    time: { value: 0 },
    lightIntensityAdjustment: { value: 0.8 },
    atlasSize: { value: 16 },
    showGreedyDebug: { value: 0 },
    skyFogTopColor: { value: new Color(0.4, 0.6, 0.9) },
    skyFogMiddleColor: { value: new Color(0.7, 0.8, 0.95) },
    skyFogBottomColor: { value: new Color(0.15, 0.18, 0.25) },
    skyFogOffset: { value: 0 },
    skyFogVoidOffset: { value: 1200 },
    skyFogExponent: { value: 0.6 },
    skyFogExponent2: { value: 1.2 },
    skyFogDimension: { value: 2000 },
    skyFogStrength: { value: 1.0 },
  };

  public shaderLightingUniforms: ShaderLightingUniforms = {
    sunDirection: { value: new Vector3(0.5, 1.0, 0.3).normalize() },
    sunColor: { value: new Color(1.0, 0.98, 0.9) },
    ambientColor: { value: new Color(0.15, 0.17, 0.2) },
    shadowMap0: { value: null },
    shadowMap1: { value: null },
    shadowMap2: { value: null },
    shadowMatrix0: { value: new Matrix4() },
    shadowMatrix1: { value: new Matrix4() },
    shadowMatrix2: { value: new Matrix4() },
    cascadeSplit0: { value: 16 },
    cascadeSplit1: { value: 48 },
    cascadeSplit2: { value: 128 },
    shadowBias: { value: 0.00018 },
    shadowNormalBias: { value: 0.0015 },
    shadowSlopeBiasScale: { value: 0.0012 },
    shadowSlopeBiasMin: { value: 0.00012 },
    shadowTopFaceBiasScale: { value: 0.2 },
    shadowSideFaceBiasScale: { value: 0.35 },
    shadowStrength: { value: 1.0 },
    sunlightIntensity: { value: 1.0 },
    waterTint: { value: new Color(0.26, 0.44, 0.68) },
    waterAbsorption: { value: 0.36 },
    waterLevel: { value: 86 },
    waterStreakStrength: { value: 0.08 },
    waterFresnelStrength: { value: 0.32 },
    skyTopColor: { value: new Color(0.4, 0.6, 0.9) },
    skyMiddleColor: { value: new Color(0.7, 0.8, 0.95) },
    shadowDebugMode: { value: 0 },
  };
}
