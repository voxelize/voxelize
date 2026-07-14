import {
  Color,
  FramebufferTexture,
  LinearFilter,
  Matrix4,
  RGBFormat,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from "three";

import { CustomChunkShaderMaterial } from ".";

export function makeSceneColorTexture(width = 1, height = 1, isSRGB = false) {
  const texture = new FramebufferTexture(width, height);
  // glCopyTexSubImage2D requires the destination texture to match the source
  // framebuffer's format. An sRGB render target (e.g. a postprocessing
  // composer buffer with UnsignedByteType under an sRGB output color space)
  // stores SRGB8_ALPHA8, so the capture must be SRGB8_ALPHA8 as well. The
  // default drawing buffer is linear and, with `alpha: false`, has no alpha
  // channel, so the capture must be RGB8 — valid against both RGB and RGBA
  // drawing buffers. The refraction shader only samples `.rgb`.
  if (isSRGB) {
    texture.colorSpace = SRGBColorSpace;
  } else {
    texture.format = RGBFormat;
    texture.internalFormat = "RGB8";
  }
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

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
    sceneColor: { value: FramebufferTexture };
    sceneTextureSize: { value: Vector2 };
    waterRefractionReady: { value: number };
    waterRefractionStrength: { value: number };
    cameraSubmersion: { value: number };
    cameraWaterPlaneY: { value: number };
    underwaterAmbient: { value: Color };
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
    minLightLevel: { value: 0.04 },
    baseAmbient: { value: 0.005 },
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
    sceneColor: { value: makeSceneColorTexture() },
    sceneTextureSize: { value: new Vector2(1, 1) },
    waterRefractionReady: { value: 0 },
    waterRefractionStrength: { value: 0.08 },
    cameraSubmersion: { value: 0 },
    cameraWaterPlaneY: { value: 0 },
    underwaterAmbient: { value: new Color(0, 0, 0) },
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
    shadowTopFaceBiasScale: { value: 1.0 },
    shadowSideFaceBiasScale: { value: 1.0 },
    shadowStrength: { value: 1.0 },
    sunlightIntensity: { value: 1.0 },
    waterTint: { value: new Color("#1F8BD8") },
    waterAbsorption: { value: 1 },
    waterLevel: { value: 86 },
    waterStreakStrength: { value: 0.1 },
    waterFresnelStrength: { value: 0.5 },
    skyTopColor: { value: new Color(0.4, 0.6, 0.9) },
    skyMiddleColor: { value: new Color(0.7, 0.8, 0.95) },
    shadowDebugMode: { value: 0 },
  };
}
