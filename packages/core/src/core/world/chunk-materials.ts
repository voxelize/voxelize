import {
  BackSide,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  DoubleSide,
  FrontSide,
  type Material,
  Matrix4,
  NearestFilter,
  ShaderLib,
  ShaderMaterial,
  type Side,
  SRGBColorSpace,
  Texture,
  Uniform,
  UniformsUtils,
  Vector2,
} from "three";

import { Coords3 } from "../../types";
import { ThreeUtils } from "../../utils";

import { Block } from "./block";
import { BLOCK_LIGHT_TUNING } from "./block-light-transfer";
import { ChunkRenderer } from "./chunk-renderer";
import { forwardDraws } from "./forward-draws";
import { LightCones } from "./light-cones";
import { LocalLights } from "./local-lights";
import { QUAD_LIGHT_TWIST_NEUTRAL } from "./quad-light";
import { Registry } from "./registry";
import {
  createSwayTableShader,
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_FLUID_CHUNK_SHADERS,
  SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS,
  WATER_DEPTH_SIDE_OFF,
} from "./shaders";
import { bindSkyGlowUniforms } from "./sky";
import {
  bindSurfaceWeatherUniforms,
  SURFACE_OPEN_LIGHT,
  SURFACE_RESPONSE,
} from "./surface-weather";
import { AtlasTexture, type AtlasFilteringMode } from "./textures";
import { positionUnitsPerBlock } from "./vertex-quantization";

export const SHARED_OPAQUE_MATERIAL_KEY = "shared-opaque";
export const SHARED_CUTOUT_MATERIAL_KEY = "shared-cutout";
export const SHARED_CUTOUT_PLANT_MATERIAL_KEY = "shared-cutout-plant";
export const SHARED_CUTOUT_CUBE_MATERIAL_KEY = "shared-cutout-cube";

const UNIT_CUBE_FACE_DIRECTIONS = [
  "1,0,0",
  "-1,0,0",
  "0,1,0",
  "0,-1,0",
  "0,0,1",
  "0,0,-1",
];

/**
 * Chunk geometry that is not main-thread sorted arrives with fixed-point
 * positions whose dequantization lives in the mesh matrix. The shader still
 * needs the scale for displacement math (sway, waves) that reads the raw
 * `position` attribute before any matrix applies; without the define the
 * shader's fallback of 1.0 treats positions as block-space floats.
 */
export function applyQuantizedPositionDefine(
  material: ShaderMaterial,
  unitsPerBlock: number,
) {
  material.defines = {
    ...material.defines,
    POSITION_UNITS_PER_BLOCK: unitsPerBlock.toFixed(1),
  };
}

/**
 * Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture. Keep in mind that
 * if you want to change its map, you also have to change its `uniforms.map`.
 */
export type CustomChunkShaderMaterial = ShaderMaterial & {
  /**
   * The texture that this map runs on.
   */
  map: Texture;
};

/**
 * What the chunk material factory needs from the world: the renderer that
 * owns shared uniforms and the material registry, the per-world uniform
 * overrides, and the light cones whose bindings every chunk shader shares.
 */
export interface ChunkMaterialHost {
  chunkRenderer: ChunkRenderer;
  lightCones: LightCones;
  localLights: LocalLights;
  swayProfileTable: Uniform;
  hasCustomBlockMaterial(id: number): boolean;
  options: {
    chunkUniformsOverwrite: Partial<ChunkRenderer["uniforms"]>;
    textureUnitDimension: number;
    chunkSize: number;
    maxHeight: number;
    subChunks: number;
    swayProfileCapacity: number;
    blockTextureFiltering: AtlasFilteringMode;
  };
}

export function isSharedOpaqueMaterialBlock(block: Block) {
  // isOpaque describes voxel-face occlusion, not material transparency.
  // A stair, fence or thin spike leaves air in its voxel but its
  // actual surfaces use the very same atlas shader as a solid cube.
  return !block.isFluid && !block.isSeeThrough && blockCastsShadow(block);
}

/** Below this texel alpha a see-through chunk material discards the texel. */
export const SEE_THROUGH_ALPHA_TEST = 0.1;

/**
 * How a shared cutout bucket draws its texels. A closed cutout cube (a leaf
 * canopy, `isClosedCutoutCube`) draws in the opaque pass: a texel stands, at
 * full alpha, once it clears half coverage, or it is cut. Blended, a far or
 * grazing leaf face sampled a mip whose holes averaged its alpha down to a
 * half, and that half-alpha film read as plastic wrap over the canopy, the
 * sky pale through every side face. A tile's own texels are all 0 or 255,
 * so up close the cut is the tile's; at a distance the half-coverage test
 * keeps about as many texels as the tile has, so the canopy keeps its gaps.
 * The other cutouts (plants, light-attenuating panes) keep blending at
 * `SEE_THROUGH_ALPHA_TEST`.
 */
export function sharedCutoutBlending(isClosedCube: boolean): {
  transparent: boolean;
  alphaTest: number;
} {
  return isClosedCube
    ? { transparent: false, alphaTest: 0.5 }
    : { transparent: true, alphaTest: SEE_THROUGH_ALPHA_TEST };
}

/**
 * Detach a customized block without cloning the world's live uniforms/atlas.
 * `clone()` never sees the uniforms: three deep-copies them, and a render
 * target's texture (the shadow maps, the scene colour the water refracts
 * under order-independent transparency) cannot be copied, so every fork
 * would warn, only to throw the copies away.
 */
export function forkChunkMaterial(material: CustomChunkShaderMaterial) {
  const { uniforms } = material;
  material.uniforms = {};
  let own: CustomChunkShaderMaterial;
  try {
    own = material.clone() as CustomChunkShaderMaterial;
  } finally {
    material.uniforms = uniforms;
  }
  own.map = material.map;
  own.uniforms = { ...uniforms };
  return own;
}

/** The bucket materials many blocks draw with at once. */
export const SHARED_CHUNK_MATERIAL_KEYS = [
  SHARED_OPAQUE_MATERIAL_KEY,
  SHARED_CUTOUT_MATERIAL_KEY,
  SHARED_CUTOUT_PLANT_MATERIAL_KEY,
  SHARED_CUTOUT_CUBE_MATERIAL_KEY,
] as const;

/**
 * Why a face-level shader customization must not go ahead, or null when it
 * may. A face that is neither independent nor isolated draws with its
 * block's material, and for a block in a shared bucket that is the bucket's:
 * a shader set there replaces the shader of every block in the bucket. Per
 * stage faces of one cross-plant block once rewrote the shared plant
 * material that way, so every plant swayed with that one block's profile
 * and the per-block sway table went unread.
 */
export function sharedFaceCustomizationError(
  blockName: string,
  faceName: string | null,
  material: Material,
  materials: ReadonlyMap<string, Material>,
): Error | null {
  if (faceName === null) return null;
  const key = SHARED_CHUNK_MATERIAL_KEYS.find(
    (shared) => materials.get(shared) === material,
  );
  if (!key) return null;
  return new Error(
    `Face "${faceName}" of ${blockName} draws with the shared "${key}" material, so a shader set on it would replace every block's in that bucket. Customize the whole block (faceName null), make the face independent, or give the block a sway profile with setBlockSway.`,
  );
}

/**
 * A voxel box's own copy of a chunk material: every live uniform and the
 * atlas shared, so it draws with the program the chunks compiled, but its
 * greedy faces read their texels through `frame` (`VoxelBoxTexelFrame`), so
 * they ride the box. Its draws count as `material`'s, so a face texture
 * animated from that material's draws still advances.
 */
export function forkVoxelBoxMaterial(
  material: CustomChunkShaderMaterial,
  frame: { readonly value: Matrix4 },
) {
  const own = forkChunkMaterial(material);
  own.uniforms.uGreedyFrame = frame;
  own.uniforms.uHasGreedyFrame = { value: 1 };
  forwardDraws(own, material);
  return own;
}

/**
 * Whether a block's geometry is drawn into the sun's shadow maps. The block
 * may say so itself (`castsShadow`); otherwise the rule of thumb: solids
 * and light-attenuating cutouts (leaves) cast, fluids and clear see-through
 * blocks (glass, barriers) do not.
 */
export function blockCastsShadow(
  block: Pick<
    Block,
    "castsShadow" | "isFluid" | "isSeeThrough" | "lightAttenuation"
  >,
) {
  if (typeof block.castsShadow === "boolean") return block.castsShadow;
  if (block.isFluid) return false;
  return !block.isSeeThrough || block.lightAttenuation > 0;
}

/**
 * The shared bucket a depth-writing cutout block collapses into, or `null`
 * for blocks that keep a per-id material. Plants live apart from leaves so
 * the plant-radius culling can hide a section's plants without taking its
 * canopy down, and because the two halves disagree on shadow casting
 * (`skipShadow` is a material property). Standalone cutouts that neither
 * sway nor attenuate light — doors, decor — stay per-id: folding them in
 * would silently change their shadow behavior.
 */
export function sharedCutoutMaterialKeyFor(block: Block): string | null {
  if (!block.isSeeThrough || block.isFluid) return null;
  const isDepthWritingCutout =
    block.transparentStandalone || block.lightAttenuation > 0;
  if (!isDepthWritingCutout) return null;
  if (block.isPlant) return SHARED_CUTOUT_PLANT_MATERIAL_KEY;
  if (isClosedCutoutCube(block)) return SHARED_CUTOUT_CUBE_MATERIAL_KEY;
  return block.lightAttenuation > 0 ? SHARED_CUTOUT_MATERIAL_KEY : null;
}

/**
 * Whether a cutout is a closed unit cube that meshes the faces between
 * same-id neighbours to a depth (`standaloneFaceDepth`), like a leaf canopy
 * whose inner layers show through its holes. Such a block draws
 * single-sided: every plane between two of them carries two faces back to
 * back, and drawn double-sided both would show from either side and fight
 * over one depth. Single-sided, each side of the plane sees only the face
 * turned toward it, and the voxel the camera stands in shows none of its
 * own. The mesher lays an inward copy of every face such a block turns to
 * empty space, so its surface still shows from inside (the mesher's
 * `is_cutout_mass`; the two must agree).
 */
export function isClosedCutoutCube(block: Block): boolean {
  if (!block.isSeeThrough || block.isFluid || block.isPlant) return false;
  if (!block.transparentStandalone || !(block.standaloneFaceDepth > 0)) {
    return false;
  }
  if (block.isDynamic) return false;

  if (block.aabbs.length !== 1) return false;
  const [box] = block.aabbs;
  const isUnitCube =
    box.minX === 0 &&
    box.minY === 0 &&
    box.minZ === 0 &&
    box.maxX === 1 &&
    box.maxY === 1 &&
    box.maxZ === 1;
  if (!isUnitCube) return false;

  if (block.faces.length !== UNIT_CUBE_FACE_DIRECTIONS.length) return false;
  const directions = new Set<string>();
  for (const face of block.faces) {
    if (face.independent || face.isolated) return false;
    directions.add(face.dir.join(","));
  }
  return UNIT_CUBE_FACE_DIRECTIONS.every((dir) => directions.has(dir));
}

export function makeChunkMaterialKey(
  world: {
    getBlockById(id: number): Block;
    hasCustomBlockMaterial(id: number): boolean;
  },
  id: number,
  faceName?: string,
  voxel?: Coords3,
) {
  const block = world.getBlockById(id);

  if (voxel) return `${id}-${faceName}-${voxel.join("-")}`;
  if (faceName) return `${id}-${faceName}`;
  if (!world.hasCustomBlockMaterial(id)) {
    if (isSharedOpaqueMaterialBlock(block)) return SHARED_OPAQUE_MATERIAL_KEY;
    const sharedCutoutKey = sharedCutoutMaterialKeyFor(block);
    if (sharedCutoutKey) return sharedCutoutKey;
  }
  return `${id}`;
}

export function makeChunkShaderMaterial(
  world: ChunkMaterialHost,
  fragmentShader?: string,
  vertexShader?: string,
  uniforms: Record<string, Uniform> = {},
): CustomChunkShaderMaterial {
  const actualFragmentShader =
    fragmentShader ?? SHADER_LIGHTING_CHUNK_SHADERS.fragment;
  const actualVertexShader =
    vertexShader ?? SHADER_LIGHTING_CHUNK_SHADERS.vertex;

  const chunksUniforms = {
    ...world.chunkRenderer.uniforms,
    ...world.options.chunkUniformsOverwrite,
  };

  const shaderLightingUniforms = {
    uSunDirection: world.chunkRenderer.shaderLightingUniforms.sunDirection,
    uCelestialDirection:
      world.chunkRenderer.shaderLightingUniforms.celestialDirection,
    uSunColor: world.chunkRenderer.shaderLightingUniforms.sunColor,
    uAmbientColor: world.chunkRenderer.shaderLightingUniforms.ambientColor,
    uShadowMap0: world.chunkRenderer.shaderLightingUniforms.shadowMap0,
    uShadowMap1: world.chunkRenderer.shaderLightingUniforms.shadowMap1,
    uShadowMap2: world.chunkRenderer.shaderLightingUniforms.shadowMap2,
    uShadowMatrix0: world.chunkRenderer.shaderLightingUniforms.shadowMatrix0,
    uShadowMatrix1: world.chunkRenderer.shaderLightingUniforms.shadowMatrix1,
    uShadowMatrix2: world.chunkRenderer.shaderLightingUniforms.shadowMatrix2,
    uCascadeSplit0: world.chunkRenderer.shaderLightingUniforms.cascadeSplit0,
    uCascadeSplit1: world.chunkRenderer.shaderLightingUniforms.cascadeSplit1,
    uCascadeSplit2: world.chunkRenderer.shaderLightingUniforms.cascadeSplit2,
    uShadowBias: world.chunkRenderer.shaderLightingUniforms.shadowBias,
    uShadowNormalBias:
      world.chunkRenderer.shaderLightingUniforms.shadowNormalBias,
    uShadowSlopeBiasScale:
      world.chunkRenderer.shaderLightingUniforms.shadowSlopeBiasScale,
    uShadowSlopeBiasMin:
      world.chunkRenderer.shaderLightingUniforms.shadowSlopeBiasMin,
    uShadowTopFaceBiasScale:
      world.chunkRenderer.shaderLightingUniforms.shadowTopFaceBiasScale,
    uShadowSideFaceBiasScale:
      world.chunkRenderer.shaderLightingUniforms.shadowSideFaceBiasScale,
    uShadowStrength: world.chunkRenderer.shaderLightingUniforms.shadowStrength,
    uWaterTint: world.chunkRenderer.shaderLightingUniforms.waterTint,
    uWaterAbsorption:
      world.chunkRenderer.shaderLightingUniforms.waterAbsorption,
    uWaterStreakStrength:
      world.chunkRenderer.shaderLightingUniforms.waterStreakStrength,
    uWaterFresnelStrength:
      world.chunkRenderer.shaderLightingUniforms.waterFresnelStrength,
    uBedCausticScale:
      world.chunkRenderer.shaderLightingUniforms.bedCausticScale,
    uDirectSunlight: world.chunkRenderer.shaderLightingUniforms.directSunlight,
    uSurfaceUndersideScale:
      world.chunkRenderer.shaderLightingUniforms.surfaceUndersideScale,
    uSurfaceUndersideTuning:
      world.chunkRenderer.shaderLightingUniforms.surfaceUndersideTuning,
    uWaterSurfaceCrisp:
      world.chunkRenderer.shaderLightingUniforms.waterSurfaceCrisp,
    // Block-light model switches and their derived constants, shared with
    // the CPU mirrors (block-light-transfer.ts).
    uBlockLightCurve: BLOCK_LIGHT_TUNING.curve,
    uBlockLightToneMap: BLOCK_LIGHT_TUNING.toneMap,
    uBlockLightKernel: BLOCK_LIGHT_TUNING.kernel,
    uBlockLightDiamond: BLOCK_LIGHT_TUNING.diamond,
    uBlockLightGain: BLOCK_LIGHT_TUNING.gain,
    uBlockLightDominanceKnee: BLOCK_LIGHT_TUNING.dominanceKnee,
    uBlockLightKernelCore: BLOCK_LIGHT_TUNING.kernelCore,
    uBlockLightKernelGain: BLOCK_LIGHT_TUNING.kernelGain,
    uBlockLightAdaptation: BLOCK_LIGHT_TUNING.adaptation,
    uBlockLightCeilingWeight: BLOCK_LIGHT_TUNING.ceilingWeight,
    uBlockLightWarmFloor: BLOCK_LIGHT_TUNING.warmFloor,
    uBlockLightHueLevels: BLOCK_LIGHT_TUNING.hueLevels,
    uBlockLightMountFade: BLOCK_LIGHT_TUNING.mountFade,
    uBlockLightHueRamp: BLOCK_LIGHT_TUNING.hueRamp,
    uBlockLightBilinear: BLOCK_LIGHT_TUNING.bilinear,
    uSkyTopColor: world.chunkRenderer.shaderLightingUniforms.skyTopColor,
    uSkyMiddleColor: world.chunkRenderer.shaderLightingUniforms.skyMiddleColor,
    uShadowDebugMode:
      world.chunkRenderer.shaderLightingUniforms.shadowDebugMode,
  };

  const material = new ShaderMaterial({
    vertexColors: true,
    fragmentShader: actualFragmentShader,
    vertexShader: actualVertexShader,
    uniforms: {
      ...UniformsUtils.clone(ShaderLib.basic.uniforms),
      uLightIntensityAdjustment: chunksUniforms.lightIntensityAdjustment,
      uSunlightIntensity: chunksUniforms.sunlightIntensity,
      uAOTable: chunksUniforms.ao,
      uStageTints: chunksUniforms.stageTints,
      uPigmentTints: chunksUniforms.pigmentTints,
      uFaceShades: chunksUniforms.faceShades,
      uMinLightLevel: chunksUniforms.minLightLevel,
      uBaseAmbient: chunksUniforms.baseAmbient,
      uFogNear: chunksUniforms.fogNear,
      uFogFar: chunksUniforms.fogFar,
      uFogColor: chunksUniforms.fogColor,
      uFogHeightOrigin: chunksUniforms.fogHeightOrigin,
      uFogHeightDensity: chunksUniforms.fogHeightDensity,
      uFogVerticalBlend: chunksUniforms.fogVerticalBlend,
      uSkyFogTopColor: chunksUniforms.skyFogTopColor,
      uSkyFogMiddleColor: chunksUniforms.skyFogMiddleColor,
      uSkyFogBottomColor: chunksUniforms.skyFogBottomColor,
      uSkyFogOffset: chunksUniforms.skyFogOffset,
      uSkyFogVoidOffset: chunksUniforms.skyFogVoidOffset,
      uSkyFogExponent: chunksUniforms.skyFogExponent,
      uSkyFogExponent2: chunksUniforms.skyFogExponent2,
      uSkyFogDimension: chunksUniforms.skyFogDimension,
      uSkyFogStrength: chunksUniforms.skyFogStrength,
      ...bindSkyGlowUniforms({
        sunDirection: chunksUniforms.skyGlowSunDirection,
        color: chunksUniforms.skyGlowColor,
        sunHaloColor: chunksUniforms.skySunHaloColor,
        moonHaloColor: chunksUniforms.skyMoonHaloColor,
        sunDiscColor: chunksUniforms.skySunDiscColor,
        moonDiscColor: chunksUniforms.skyMoonDiscColor,
        discRadii: chunksUniforms.skyDiscRadii,
      }),
      uSceneColor: chunksUniforms.sceneColor,
      uSceneTextureSize: chunksUniforms.sceneTextureSize,
      uWaterRefractionReady: chunksUniforms.waterRefractionReady,
      uWaterDepth: chunksUniforms.waterDepth,
      uWaterDepthState: chunksUniforms.waterDepthState,
      uWaterDepthViewport: chunksUniforms.waterDepthViewport,
      uWaterDepthClip: chunksUniforms.waterDepthClip,
      // Per material: only a pane's two forks take a side.
      uWaterDepthSide: { value: WATER_DEPTH_SIDE_OFF },
      uWaterRefractionStrength: chunksUniforms.waterRefractionStrength,
      uWaterNormalMap: chunksUniforms.waterNormalMap,
      uCameraSubmersion: chunksUniforms.cameraSubmersion,
      uCameraWaterPlaneY: chunksUniforms.cameraWaterPlaneY,
      uUnderwaterAmbient: chunksUniforms.underwaterAmbient,
      uUnderwaterViewScale: chunksUniforms.underwaterViewScale,
      uWindDirection: chunksUniforms.windDirection,
      uWindOffset: chunksUniforms.windOffset,
      uWindSpeed: chunksUniforms.windSpeed,
      uTime: chunksUniforms.time,
      uAtlasSize: chunksUniforms.atlasSize,
      uShowGreedyDebug: chunksUniforms.showGreedyDebug,
      uFarCoverMask: chunksUniforms.farCoverMask,
      uFarCover: chunksUniforms.farCover,
      uFarSeam: chunksUniforms.farSeam,
      ...bindSurfaceWeatherUniforms(chunksUniforms),
      // Per material: how it takes the weather (SURFACE_RESPONSE). Forks
      // share it with the material they draw for.
      uSurfaceResponse: { value: new Vector2(...SURFACE_RESPONSE.solid) },
      uSurfaceOpenLight: { value: new Vector2(...SURFACE_OPEN_LIGHT.solid) },
      uChunkReveal: { value: 1 },
      // Per material: a chunk's greedy faces take their texels from where
      // they are drawn; a voxel box's forks turn on a frame of their own.
      uGreedyFrame: { value: new Matrix4() },
      uHasGreedyFrame: { value: 0 },
      ...world.lightCones.uniformBindings,
      ...world.localLights.uniformBindings,
      ...shaderLightingUniforms,
      ...uniforms,
    },
  }) as CustomChunkShaderMaterial;

  Object.defineProperty(material, "renderStage", {
    get: function () {
      return material.uniforms.renderStage.value;
    },

    set: function (stage) {
      material.uniforms.renderStage.value = parseFloat(stage);
    },
  });

  material.map = AtlasTexture.makeUnknownTexture(
    world.options.textureUnitDimension,
  );
  material.uniforms.map = { value: material.map };

  // A geometry without a light twist (a held block, a preview) keeps the
  // per-triangle light: the neutral bytes carry no twist and no corner.
  Object.assign(material.defaultAttributeValues, {
    biomeTint: [0, 0, 0],
    lightTwist: [...QUAD_LIGHT_TWIST_NEUTRAL],
  });
  return material;
}

/**
 * Whether a face carries a whole texture of its own instead of a slot in the
 * shared atlas. Independent faces own one per block face; isolated faces own
 * one per voxel, plus the face-keyed default below for when there is no
 * voxel to ask (a held block, a drop, an inventory thumbnail).
 */
export function isOwnTextureFace(face: Block["faces"][0]) {
  return face.independent || face.isolated;
}

/**
 * Textures minted by {@link makeOwnFaceTexture}, one per material, and so
 * ours to release when that material moves on. Everything else a face
 * material can be holding belongs to somebody else: the shared unknown
 * texture is handed to every unpainted surface at once, and a texture passed
 * in by a caller is theirs to keep repainting and to dispose.
 */
const mintedFaceTextures = new WeakSet<Texture>();

/**
 * The texture an own-texture face should carry for `source`. Block art is
 * pixel art, so a texture minted here samples the way the atlas does. Mint
 * one per material rather than sharing: the sharing that matters — one GPU
 * upload per image — already happens at the texture's source.
 */
export function makeOwnFaceTexture(
  source: Color | HTMLImageElement | Texture,
): Texture {
  if (ThreeUtils.isTexture(source)) return source;

  const texture = ThreeUtils.isColor(source)
    ? new CanvasTexture(makeSolidColorCanvas(source))
    : new Texture(source);

  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  mintedFaceTextures.add(texture);

  return texture;
}

/** Point an own-texture face's material at `texture`. */
export function setOwnFaceTexture(
  material: CustomChunkShaderMaterial,
  texture: Texture,
) {
  const previous = material.map;

  material.map = texture;
  material.uniforms.map.value = texture;
  material.needsUpdate = true;

  if (previous && previous !== texture && mintedFaceTextures.has(previous)) {
    previous.dispose();
  }
}

function makeSolidColorCanvas(color: Color) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Cannot build a solid color texture without a 2d context");
  }

  context.fillStyle = color.getStyle();
  context.fillRect(0, 0, 1, 1);

  return canvas;
}

/**
 * Turns each fluid chunk material to the side the camera sees it from: the
 * back while the camera is under water, so the water's surface shows from
 * below, the front otherwise. Only a fluid that counts as water turns. Lava
 * seen from under water is still the top of a lava pool, and drawn by its
 * back it vanished, leaving the floor under it.
 */
export function setFluidMaterialSides(
  materials: Iterable<Material>,
  isCameraUnderwater: boolean,
  isWater: (blockId: number) => boolean,
) {
  for (const material of materials) {
    if (!material.userData.isFluid) continue;
    const blockId: number | undefined = material.userData.fluidBlockId;
    const side =
      isCameraUnderwater && (blockId === undefined || isWater(blockId))
        ? BackSide
        : FrontSide;
    if (material.side === side) continue;
    material.side = side;
    material.needsUpdate = true;
  }
}

export async function loadChunkMaterials(
  world: ChunkMaterialHost & {
    registry: Registry;
    getBlockById(id: number): Block;
  },
) {
  const { textureUnitDimension } = world.options;
  const positionUnits = positionUnitsPerBlock(world.options);

  const perSide = (total: number) => {
    let countPerSide = 1;
    const sqrt = Math.ceil(Math.sqrt(total));
    while (countPerSide < sqrt) {
      countPerSide *= 2;
    }

    return countPerSide;
  };

  const make = (
    transparent: boolean,
    map: Texture,
    isFluid: boolean,
    lightAttenuation: number,
    transparentStandalone: boolean,
    castsShadow: boolean,
  ) => {
    const mat = makeChunkShaderMaterial(
      world,
      isFluid
        ? SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment
        : transparent
          ? SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS.fragment
          : undefined,
    );

    mat.side = isFluid ? FrontSide : transparent ? DoubleSide : FrontSide;
    mat.transparent = transparent;
    if (transparent) {
      // Light-attenuating see-through solids are the leaf-like cutouts
      // (alphaTest already discards their holes); they occlude like the
      // near-opaque surfaces they are. Without the depth write, fluid —
      // which renders after every other transparent so its refraction
      // capture can see them — blends its tint straight over canopies,
      // and same-order foliage meshes wash over each other by sort luck.
      // Glass keeps attenuation 0 and stays non-writing so stacked panes
      // still layer; the part of a pane in front of the water draws after it
      // instead (WaterDepthPass). Drawn order-independently, every
      // see-through mesh is split by its texels instead (SeeThroughTexelSplit).
      mat.depthWrite =
        !isFluid && (transparentStandalone || lightAttenuation > 0);
      mat.alphaTest = SEE_THROUGH_ALPHA_TEST;
      mat.uniforms.alphaTest.value = SEE_THROUGH_ALPHA_TEST;
    }
    mat.map = map;
    mat.uniforms.map.value = map;
    mat.userData.skipShadow = !castsShadow;
    mat.userData.isFluid = isFluid;
    mat.uniforms.uSurfaceResponse.value.set(
      ...(isFluid
        ? SURFACE_RESPONSE.fluid
        : transparent
          ? SURFACE_RESPONSE.seeThrough
          : SURFACE_RESPONSE.solid),
    );
    // A see-through block's faces carry its own voxel's light.
    if (transparent) {
      mat.uniforms.uSurfaceOpenLight.value.set(
        ...SURFACE_OPEN_LIGHT.seeThrough,
      );
    }

    // Sorted-transparent meshes (the depth-non-writing ones the main-thread
    // sorter rewrites) keep full-float positions; everything else is
    // quantized. This mirrors `isMainThreadSortedBlock`, so every material
    // serves exactly one vertex format.
    if (!(transparent && !mat.depthWrite)) {
      applyQuantizedPositionDefine(mat, positionUnits);
    }

    return mat;
  };

  const blocks = Array.from(world.registry.blocksById.values());

  const textureGroups = new Set<string>();
  let ungroupedFaces = 0;
  for (const block of blocks) {
    for (const face of block.faces) {
      if (face.independent || face.isolated) continue;
      if (face.textureGroup) {
        textureGroups.add(face.textureGroup);
      } else {
        ungroupedFaces++;
      }
    }
  }
  const totalSlots = textureGroups.size + ungroupedFaces;
  const countPerSide = perSide(totalSlots);
  const atlas = new AtlasTexture(
    countPerSide,
    textureUnitDimension,
    undefined,
    world.options.blockTextureFiltering,
  );
  const sharedOpaqueMaterial = make(false, atlas, false, 1, false, true);
  world.chunkRenderer.materials.set(
    SHARED_OPAQUE_MATERIAL_KEY,
    sharedOpaqueMaterial,
  );

  const swayShaders = createSwayTableShader(
    SHADER_LIGHTING_CHUNK_SHADERS,
    world.options.swayProfileCapacity,
  );
  const makeSharedCutout = (
    isShadowCasting: boolean,
    side: Side = DoubleSide,
    isClosedCube = false,
  ) => {
    const mat = makeChunkShaderMaterial(
      world,
      swayShaders.fragmentShader,
      swayShaders.vertexShader,
      { uSwayParams: world.swayProfileTable },
    );
    const blending = sharedCutoutBlending(isClosedCube);
    mat.side = side;
    mat.transparent = blending.transparent;
    mat.depthWrite = true;
    mat.alphaTest = blending.alphaTest;
    mat.uniforms.alphaTest.value = blending.alphaTest;
    mat.map = atlas;
    mat.uniforms.map.value = atlas;
    mat.userData.skipShadow = !isShadowCasting;
    mat.uniforms.uSurfaceResponse.value.set(...SURFACE_RESPONSE.cutout);
    mat.uniforms.uSurfaceOpenLight.value.set(...SURFACE_OPEN_LIGHT.seeThrough);
    applyQuantizedPositionDefine(mat, positionUnits);
    return mat;
  };
  world.chunkRenderer.materials.set(
    SHARED_CUTOUT_MATERIAL_KEY,
    makeSharedCutout(true),
  );
  world.chunkRenderer.materials.set(
    SHARED_CUTOUT_CUBE_MATERIAL_KEY,
    makeSharedCutout(true, FrontSide, true),
  );
  world.chunkRenderer.materials.set(
    SHARED_CUTOUT_PLANT_MATERIAL_KEY,
    makeSharedCutout(false),
  );

  world.chunkRenderer.uniforms.atlasSize.value = countPerSide;

  blocks.forEach((block) => {
    const mat = isSharedOpaqueMaterialBlock(block)
      ? sharedOpaqueMaterial
      : make(
          block.isSeeThrough,
          atlas,
          block.isFluid,
          block.lightAttenuation,
          block.transparentStandalone,
          blockCastsShadow(block),
        );
    if (isClosedCutoutCube(block)) mat.side = FrontSide;
    if (block.isFluid) mat.userData.fluidBlockId = block.id;
    // Keyed per id, not through makeChunkMaterialKey: a block that collapses
    // into a shared cutout bucket still needs its own material reachable so
    // customizeMaterialShaders can opt it out into a bespoke shader.
    world.chunkRenderer.materials.set(`${block.id}`, mat);

    // A face that owns its texture gets a material keyed by face name. For an
    // independent face that is the material its chunk geometry renders with.
    // For an isolated face — whose pixels belong to a voxel — it is the
    // face's default: what the block looks like with no voxel behind it,
    // which is the only honest answer a display mesh can be given.
    block.faces.forEach((face) => {
      if (!isOwnTextureFace(face)) return;

      const ownTextureMat = make(
        block.isSeeThrough,
        AtlasTexture.makeUnknownTexture(textureUnitDimension),
        block.isFluid,
        block.lightAttenuation,
        block.transparentStandalone,
        blockCastsShadow(block),
      );
      if (block.isFluid) ownTextureMat.userData.fluidBlockId = block.id;
      const ownTextureKey = makeChunkMaterialKey(world, block.id, face.name);
      world.chunkRenderer.materials.set(ownTextureKey, ownTextureMat);
    });
  });
}
