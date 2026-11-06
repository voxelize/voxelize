import {
  Color,
  DataTexture,
  FramebufferTexture,
  LinearFilter,
  Matrix4,
  type Texture,
  type TextureNode,
  type UniformArrayNode,
  type UniformNode,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";

import {
  createSurfaceWeatherUniforms,
  type SurfaceWeatherUniforms,
} from "../surface-weather";
import { makeWaterNormalTexture } from "../water-normal-texture";
import { WATER_OPTICS } from "../water-optics";

import { textureSlot, uniformArray, worldUniform } from "./uniforms";

/**
 * A uniform array the CPU edits in place: `value` is the array of three
 * objects (or numbers) writers mutate, `node` the TSL buffer that copies
 * them to the GPU once a render.
 */
export type ArrayUniform<T, N extends ArrayElementType> = {
  readonly value: T[];
  readonly node: UniformArrayNode<N>;
};

type ArrayElementType = "vec2" | "vec3" | "vec4" | "color";

export function arrayUniform<
  T extends Vector2 | Vector3 | Vector4 | Color,
  N extends ArrayElementType,
>(values: T[], type: N): ArrayUniform<T, N> {
  return {
    value: values,
    node: uniformArray(values, type) as unknown as UniformArrayNode<N>,
  };
}

/**
 * The frame a scene colour capture lands in: the frame drawn before the
 * water (`World.captureWaterRefraction`). Linear filtered so the refracted
 * floor bends smoothly between texels.
 */
export function makeSceneColorTexture(width = 1, height = 1): FramebufferTexture {
  const texture = new FramebufferTexture(width, height);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

/**
 * Every world-wide input the chunk shading reads, as TSL nodes: `node.value`
 * is what the host writes, as it wrote the `{ value }` records these
 * replace. One set per world (`ChunkRenderer.uniforms`).
 */
export function createChunkUniforms() {
  return {
    // Weather on surfaces (surface-weather.ts): off until a host sets it.
    ...createSurfaceWeatherUniforms(),
    fogColor: worldUniform(new Color("#B1CCFD")),
    fogNear: worldUniform(100),
    fogFar: worldUniform(200),
    fogHeightOrigin: worldUniform(80),
    fogHeightDensity: worldUniform(0.005),
    /** 0..1 blend from horizontal to true 3D fog distance (caves). */
    fogVerticalBlend: worldUniform(0),
    windDirection: worldUniform(new Vector2(0.7, 0.7)),
    windOffset: worldUniform(new Vector2(0, 0)),
    windSpeed: worldUniform(1.0),
    ao: worldUniform(new Vector4(45.0, 105.0, 180.0, 255.0)),
    /** Biome tints by stage index (linear RGB multipliers). */
    stageTints: arrayUniform(
      Array.from({ length: 16 }, () => new Vector3(1, 1, 1)),
      "vec3",
    ),
    /**
     * The colour table: 16 linear RGB multipliers a face with a pigment mask
     * takes by its voxel stage. Entry 0 is the untinted material.
     */
    pigmentTints: arrayUniform(
      Array.from({ length: 16 }, () => new Vector3(1, 1, 1)),
      "vec3",
    ),
    faceShades: worldUniform(new Vector4(0.7, 0.85, 0.62, 1.0)),
    minLightLevel: worldUniform(0.04),
    baseAmbient: worldUniform(0.005),
    sunlightIntensity: worldUniform(1),
    time: worldUniform(0),
    lightIntensityAdjustment: worldUniform(0.8),
    atlasSize: worldUniform(16),
    showGreedyDebug: worldUniform(0),
    /**
     * The far layer's chunk-coverage mask and its placement, written by
     * `FarTerrain`: chunk fragments read them to yield their outer half
     * chunk to the far layer across a dithered band (see far-seam.ts).
     */
    farCoverMask: textureSlot("color"),
    /** x, y: mask origin in chunk columns; z: blocks per chunk; w: texels per side. */
    farCover: worldUniform(new Vector4(0, 0, 16, 1)),
    /** The seam band's ramp scale; 0 keeps the loaded edge hard. */
    farSeam: worldUniform(0),
    skyFogTopColor: worldUniform(new Color(0.4, 0.6, 0.9)),
    skyFogMiddleColor: worldUniform(new Color(0.7, 0.8, 0.95)),
    skyFogBottomColor: worldUniform(new Color(0.15, 0.18, 0.25)),
    skyFogOffset: worldUniform(0),
    skyFogVoidOffset: worldUniform(1200),
    skyFogExponent: worldUniform(0.6),
    skyFogExponent2: worldUniform(1.2),
    skyFogDimension: worldUniform(2000),
    skyFogStrength: worldUniform(1.0),
    /**
     * The sky's own light, the same values the sky dome draws with
     * (`Sky.glow`), so every fogged surface glows toward the sun and moon
     * exactly as the sky behind it does. Black adds nothing.
     */
    skyGlowSunDirection: worldUniform(new Vector3(0, 1, 0)),
    skyGlowColor: worldUniform(new Color(0, 0, 0)),
    skySunHaloColor: worldUniform(new Color(0, 0, 0)),
    skyMoonHaloColor: worldUniform(new Color(0, 0, 0)),
    skySunDiscColor: worldUniform(new Color(0, 0, 0)),
    skyMoonDiscColor: worldUniform(new Color(0, 0, 0)),
    skyDiscRadii: worldUniform(new Vector2(0.07, 0.07)),
    /**
     * What the water refracts: a copy of the frame drawn before it, or with
     * order-independent transparency the scene target's own colour, read
     * while the blended layers draw elsewhere.
     */
    sceneColor: textureSlot("color", makeSceneColorTexture()),
    sceneTextureSize: worldUniform(new Vector2(1, 1)),
    waterRefractionReady: worldUniform(0),
    /**
     * The depth of the water near the panes in view, and how to read it
     * (`WaterDepthPass`): which side of the water each pane fragment draws.
     */
    waterDepth: textureSlot("depth"),
    waterDepthState: worldUniform(0),
    waterDepthViewport: worldUniform(new Vector2(1, 1)),
    waterDepthClip: worldUniform(new Vector2(0.1, 1000)),
    /**
     * Behind each pixel, the nearest place the water near the panes ends
     * (`WaterDepthPass`), and the frame's own depth as the water starts to
     * draw: the two ends of the run of water a tank window shows.
     */
    waterExitDepth: textureSlot("depth"),
    waterExitReady: worldUniform(0),
    sceneDepth: textureSlot("depth"),
    sceneDepthReady: worldUniform(0),
    waterRefractionStrength: worldUniform(0.08),
    // Baked once per world, at construction: measured 20-30ms of CPU, in
    // the load phase, shared by every fluid material.
    waterNormalMap: textureSlot(
      "color",
      makeWaterNormalTexture(WATER_OPTICS.surfaceNormalTexture),
    ),
    cameraSubmersion: worldUniform(0),
    cameraWaterPlaneY: worldUniform(0),
    underwaterAmbient: worldUniform(new Color(0, 0, 0)),
    /** The water's view extinction against its tuned clarity (sun-scaled). */
    underwaterViewScale: worldUniform(1),
  };
}

/**
 * The sun, the cascades and the water: the lighting half of the chunk
 * shading's inputs (`ChunkRenderer.shaderLightingUniforms`).
 */
export function createShaderLightingUniforms() {
  return {
    /**
     * The shading light: held above a minimum elevation, tilted off the
     * sun's plane, and blended toward the moon through twilight, so terrain
     * shading and shadows stay readable at every hour. Not where the sun is
     * drawn.
     */
    sunDirection: worldUniform(new Vector3(0.5, 1.0, 0.3).normalize()),
    /**
     * The celestial disc above the horizon as the sky box actually draws it
     * (`getVisibleDiscDirection`): the sun by day, the moon by night, never
     * clamped or tilted. Specular reflections read this, so the sun on the
     * water sits under the sun in the sky.
     */
    celestialDirection: worldUniform(new Vector3(0.5, 1.0, 0.0).normalize()),
    sunColor: worldUniform(new Color(1.0, 0.98, 0.9)),
    ambientColor: worldUniform(new Color(0.15, 0.17, 0.2)),
    shadowMap0: textureSlot("depth"),
    shadowMap1: textureSlot("depth"),
    shadowMap2: textureSlot("depth"),
    shadowMatrix0: worldUniform(new Matrix4()),
    shadowMatrix1: worldUniform(new Matrix4()),
    shadowMatrix2: worldUniform(new Matrix4()),
    cascadeSplit0: worldUniform(16),
    cascadeSplit1: worldUniform(48),
    cascadeSplit2: worldUniform(128),
    shadowBias: worldUniform(0.00018),
    shadowNormalBias: worldUniform(0.0015),
    shadowSlopeBiasScale: worldUniform(0.0012),
    shadowSlopeBiasMin: worldUniform(0.00012),
    shadowTopFaceBiasScale: worldUniform(1.0),
    shadowSideFaceBiasScale: worldUniform(1.0),
    shadowStrength: worldUniform(1.0),
    /**
     * The sun's intensity as the sky gives it (the chunk set's own copy
     * keeps a floor of 0.05): what entity shadows fade with at night.
     */
    sunlightIntensity: worldUniform(1.0),
    /**
     * How much shadow-map depth one block toward the sun spans (cascade 0),
     * for an entity measuring its own body in the map.
     */
    shadowDepthPerBlock: worldUniform(0),
    /**
     * The share of the sun (the moon by night) that reaches the world as a
     * direct beam, 0..1: 1 under a clear sky, falling as cloud veils the
     * disc. What only a beam draws (glints on water, caustics, the disc
     * seen through the surface from below) scales by it; diffuse daylight
     * (`sunlightIntensity`) does not. A host with weather lowers it.
     */
    directSunlight: worldUniform(1.0),
    waterTint: worldUniform(new Color("#1F8BD8")),
    waterAbsorption: worldUniform(1),
    waterLevel: worldUniform(86),
    waterStreakStrength: worldUniform(0.1),
    waterFresnelStrength: worldUniform(0.5),
    /** 0..1 scale on the caustic net seen on submerged faces from below. */
    bedCausticScale: worldUniform(1),
    skyTopColor: worldUniform(new Color(0.4, 0.6, 0.9)),
    skyMiddleColor: worldUniform(new Color(0.7, 0.8, 0.95)),
    shadowDebugMode: worldUniform(0),
  };
}

export type ChunkUniforms = ReturnType<typeof createChunkUniforms> &
  SurfaceWeatherUniforms;
export type ShaderLightingUniforms = ReturnType<
  typeof createShaderLightingUniforms
>;

/** A texture input: `node.value` swaps the texture it reads. */
export type TextureInput = TextureNode & { value: Texture };
export type ScalarInput = UniformNode<number>;
export type { DataTexture };
