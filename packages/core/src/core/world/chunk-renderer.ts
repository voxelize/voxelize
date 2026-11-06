import type { ChunkMaterial } from "./shading/chunk-material";
import {
  type ChunkUniforms,
  createChunkUniforms,
  createShaderLightingUniforms,
  makeSceneColorTexture,
  type ShaderLightingUniforms,
} from "./shading/chunk-uniforms";

export { makeSceneColorTexture };
export type { ChunkUniforms, ShaderLightingUniforms };

/**
 * The world's chunk materials, keyed by bucket (`makeChunkMaterialKey`),
 * and the shading inputs they read: `uniforms` (fog, sky, wind, water,
 * clock, the far seam) and `shaderLightingUniforms` (the sun, its cascades,
 * the water's look). Both are TSL nodes; hosts write `node.value`.
 */
export class ChunkRenderer {
  public materials: Map<string, ChunkMaterial> = new Map();

  public uniforms: ChunkUniforms = createChunkUniforms();

  public shaderLightingUniforms: ShaderLightingUniforms =
    createShaderLightingUniforms();
}
