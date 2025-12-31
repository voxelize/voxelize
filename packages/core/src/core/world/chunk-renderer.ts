import {
  Color,
  Data3DTexture,
  Matrix4,
  Texture,
  Vector3,
  Vector4,
} from "three";

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
  shadowStrength: { value: number };
  lightVolume: { value: Data3DTexture | null };
  lightVolumeMin: { value: Vector3 };
  lightVolumeSize: { value: Vector3 };
  waterTint: { value: Color };
  waterAbsorption: { value: number };
  waterLevel: { value: number };
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
  } = {
    fogColor: { value: new Color("#B1CCFD") },
    fogNear: { value: 100 },
    fogFar: { value: 200 },
    ao: { value: new Vector4(100.0, 170.0, 210.0, 255.0) },
    minLightLevel: { value: 0 },
    baseAmbient: { value: 0.001 },
    sunlightIntensity: { value: 1 },
    time: { value: performance.now() },
    lightIntensityAdjustment: { value: 0.8 },
    atlasSize: { value: 16 },
    showGreedyDebug: { value: 0 },
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
    shadowBias: { value: 0.0005 },
    shadowStrength: { value: 1.0 },
    lightVolume: { value: null },
    lightVolumeMin: { value: new Vector3() },
    lightVolumeSize: { value: new Vector3(128, 64, 128) },
    waterTint: { value: new Color(0.3, 0.5, 0.8) },
    waterAbsorption: { value: 0.5 },
    waterLevel: { value: 86 },
    skyTopColor: { value: new Color(0.4, 0.6, 0.9) },
    skyMiddleColor: { value: new Color(0.7, 0.8, 0.95) },
    shadowDebugMode: { value: 0 },
  };
}
