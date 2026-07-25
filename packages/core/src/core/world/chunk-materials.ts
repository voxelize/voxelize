import {
  DoubleSide,
  FrontSide,
  ShaderLib,
  ShaderMaterial,
  Texture,
  Uniform,
  UniformsUtils,
} from "three";

import { Coords3 } from "../../types";

import { Block } from "./block";
import { ChunkRenderer } from "./chunk-renderer";
import { LightCones } from "./light-cones";
import { Registry } from "./registry";
import {
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_FLUID_CHUNK_SHADERS,
} from "./shaders";
import { AtlasTexture } from "./textures";

export const SHARED_OPAQUE_MATERIAL_KEY = "shared-opaque";

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
  options: {
    chunkUniformsOverwrite: Partial<ChunkRenderer["uniforms"]>;
    textureUnitDimension: number;
  };
}

export function isSharedOpaqueMaterialBlock(block: Block) {
  return block.isOpaque && !block.isFluid && !block.isSeeThrough;
}

export function makeChunkMaterialKey(
  world: { getBlockById(id: number): Block },
  id: number,
  faceName?: string,
  voxel?: Coords3,
) {
  const block = world.getBlockById(id);

  return voxel
    ? `${id}-${faceName}-${voxel.join("-")}`
    : faceName
      ? `${id}-${faceName}`
      : isSharedOpaqueMaterialBlock(block)
        ? SHARED_OPAQUE_MATERIAL_KEY
        : `${id}`;
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
    uWaterLevel: world.chunkRenderer.shaderLightingUniforms.waterLevel,
    uWaterStreakStrength:
      world.chunkRenderer.shaderLightingUniforms.waterStreakStrength,
    uWaterFresnelStrength:
      world.chunkRenderer.shaderLightingUniforms.waterFresnelStrength,
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
      uFaceShades: chunksUniforms.faceShades,
      uMinLightLevel: chunksUniforms.minLightLevel,
      uBaseAmbient: chunksUniforms.baseAmbient,
      uFogNear: chunksUniforms.fogNear,
      uFogFar: chunksUniforms.fogFar,
      uFogColor: chunksUniforms.fogColor,
      uFogHeightOrigin: chunksUniforms.fogHeightOrigin,
      uFogHeightDensity: chunksUniforms.fogHeightDensity,
      uSkyFogTopColor: chunksUniforms.skyFogTopColor,
      uSkyFogMiddleColor: chunksUniforms.skyFogMiddleColor,
      uSkyFogBottomColor: chunksUniforms.skyFogBottomColor,
      uSkyFogOffset: chunksUniforms.skyFogOffset,
      uSkyFogVoidOffset: chunksUniforms.skyFogVoidOffset,
      uSkyFogExponent: chunksUniforms.skyFogExponent,
      uSkyFogExponent2: chunksUniforms.skyFogExponent2,
      uSkyFogDimension: chunksUniforms.skyFogDimension,
      uSkyFogStrength: chunksUniforms.skyFogStrength,
      uSceneColor: chunksUniforms.sceneColor,
      uSceneTextureSize: chunksUniforms.sceneTextureSize,
      uWaterRefractionReady: chunksUniforms.waterRefractionReady,
      uWaterRefractionStrength: chunksUniforms.waterRefractionStrength,
      uCameraSubmersion: chunksUniforms.cameraSubmersion,
      uCameraWaterPlaneY: chunksUniforms.cameraWaterPlaneY,
      uUnderwaterAmbient: chunksUniforms.underwaterAmbient,
      uWindDirection: chunksUniforms.windDirection,
      uWindOffset: chunksUniforms.windOffset,
      uWindSpeed: chunksUniforms.windSpeed,
      uTime: chunksUniforms.time,
      uAtlasSize: chunksUniforms.atlasSize,
      uShowGreedyDebug: chunksUniforms.showGreedyDebug,
      uChunkReveal: { value: 1 },
      ...world.lightCones.uniformBindings,
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

  return material;
}

export async function loadChunkMaterials(
  world: ChunkMaterialHost & {
    registry: Registry;
    getBlockById(id: number): Block;
  },
) {
  const { textureUnitDimension } = world.options;

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
  ) => {
    const mat = makeChunkShaderMaterial(
      world,
      isFluid ? SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment : undefined,
    );

    mat.side = transparent ? DoubleSide : FrontSide;
    mat.transparent = transparent;
    if (transparent) {
      mat.depthWrite = !isFluid && transparentStandalone;
      mat.alphaTest = 0.1;
      mat.uniforms.alphaTest.value = 0.1;
    }
    mat.map = map;
    mat.uniforms.map.value = map;
    mat.userData.skipShadow =
      isFluid || (transparent && lightAttenuation === 0);

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
  const atlas = new AtlasTexture(countPerSide, textureUnitDimension);
  const sharedOpaqueMaterial = make(false, atlas, false, 1, false);

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
        );
    const key = makeChunkMaterialKey(world, block.id);
    world.chunkRenderer.materials.set(key, mat);

    block.faces.forEach((face) => {
      if (!face.independent || face.isolated) return;

      const independentMat = make(
        block.isSeeThrough,
        AtlasTexture.makeUnknownTexture(textureUnitDimension),
        block.isFluid,
        block.lightAttenuation,
        block.transparentStandalone,
      );
      const independentKey = makeChunkMaterialKey(world, block.id, face.name);
      world.chunkRenderer.materials.set(independentKey, independentMat);
    });
  });
}
