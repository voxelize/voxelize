import {
  Color,
  DataTexture,
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

import { CustomChunkShaderMaterial } from "./chunk-materials";
import { makeWaterNormalTexture } from "./water-normal-texture";
import { WATER_OPTICS } from "./water-optics";

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
  /**
   * The shading light: held above a minimum elevation, tilted off the sun's
   * plane, and blended toward the moon through twilight, so terrain shading
   * and shadows stay readable at every hour. Not where the sun is drawn.
   */
  sunDirection: { value: Vector3 };
  /**
   * The celestial disc above the horizon as the sky box actually draws it
   * (`getVisibleDiscDirection`): the sun by day, the moon by night, never
   * clamped or tilted. Specular reflections read this, so the sun on the
   * water sits under the sun in the sky.
   */
  celestialDirection: { value: Vector3 };
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
  /** 0..1 scale on the caustic net seen on submerged faces from below. */
  bedCausticScale: { value: number };
  /**
   * The surface's underside while submerged: 0 off, 1 a clear Snell window
   * onto the scene above over a calm mirror of the water, 2 the previous
   * texel-stepped window and caustic web (kept for A/B captures).
   */
  surfaceUndersideScale: { value: number };
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
    stageTints: { value: Float32Array };
    /** The colour table: 16 linear RGB multipliers a face with a pigment
     * mask takes by its voxel stage. Entry 0 is the untinted material. */
    pigmentTints: { value: Float32Array };
    faceShades: { value: Vector4 };
    minLightLevel: { value: number };
    baseAmbient: { value: number };
    sunlightIntensity: { value: number };
    time: { value: number };
    lightIntensityAdjustment: { value: number };
    atlasSize: { value: number };
    showGreedyDebug: { value: number };
    fogHeightOrigin: { value: number };
    fogHeightDensity: { value: number };
    /** 0..1 blend from horizontal to true 3D fog distance (caves). */
    fogVerticalBlend: { value: number };
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
    waterNormalMap: { value: DataTexture };
    cameraSubmersion: { value: number };
    cameraWaterPlaneY: { value: number };
    underwaterAmbient: { value: Color };
  } = {
    fogColor: { value: new Color("#B1CCFD") },
    fogNear: { value: 100 },
    fogFar: { value: 200 },
    fogHeightOrigin: { value: 80 },
    fogHeightDensity: { value: 0.005 },
    fogVerticalBlend: { value: 0 },
    windDirection: { value: new Vector2(0.7, 0.7) },
    windOffset: { value: new Vector2(0, 0) },
    windSpeed: { value: 1.0 },
    ao: { value: new Vector4(45.0, 105.0, 180.0, 255.0) },
    stageTints: { value: new Float32Array(16 * 3).fill(1) },
    pigmentTints: { value: new Float32Array(16 * 3).fill(1) },
    faceShades: { value: new Vector4(0.7, 0.85, 0.62, 1.0) },
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
    // Baked once per world, at construction: measured 20-30ms of CPU, in
    // the load phase, shared by every fluid material.
    waterNormalMap: {
      value: makeWaterNormalTexture(WATER_OPTICS.surfaceNormalTexture),
    },
    cameraSubmersion: { value: 0 },
    cameraWaterPlaneY: { value: 0 },
    underwaterAmbient: { value: new Color(0, 0, 0) },
  };

  public shaderLightingUniforms: ShaderLightingUniforms = {
    sunDirection: { value: new Vector3(0.5, 1.0, 0.3).normalize() },
    celestialDirection: { value: new Vector3(0.5, 1.0, 0.0).normalize() },
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
    bedCausticScale: { value: 1 },
    surfaceUndersideScale: { value: 1 },
    skyTopColor: { value: new Color(0.4, 0.6, 0.9) },
    skyMiddleColor: { value: new Color(0.7, 0.8, 0.95) },
    shadowDebugMode: { value: 0 },
  };
}
