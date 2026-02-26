import { DataTexture } from "three";
import type { Node, ShaderNodeObject } from "three/tsl";
import { texture, uniform } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

import type { EntityShadowUniforms } from "../core/world/entity-shadow-uniforms";
import { createEntityShadowNode } from "../core/world/shadow-nodes";

const placeholder2D = new DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
);
placeholder2D.needsUpdate = true;

export function applyEntityShadowToMaterial(
  material: MeshBasicNodeMaterial,
  shadowUniforms: EntityShadowUniforms,
  worldNormal: ShaderNodeObject<Node>,
  shadowCoord0: ShaderNodeObject<Node>,
  viewDepth: ShaderNodeObject<Node>,
): void {
  const uShadowMap0 = texture(
    shadowUniforms.uShadowMap0.value ?? placeholder2D,
  ).onRenderUpdate(() => shadowUniforms.uShadowMap0.value ?? placeholder2D);

  const shadowFactor = createEntityShadowNode({
    worldNormal,
    uShadowStrength: uniform(shadowUniforms.uShadowStrength),
    uSunlightIntensity: uniform(shadowUniforms.uSunlightIntensity),
    uSunDirection: uniform(shadowUniforms.uSunDirection),
    uShadowBias: uniform(shadowUniforms.uShadowBias),
    uShadowNormalBias: uniform(shadowUniforms.uShadowNormalBias),
    uShadowMap0,
    vShadowCoord0: shadowCoord0,
    uMinOccluderDepth: uniform(shadowUniforms.uMinOccluderDepth),
    uCascadeSplit1: uniform(shadowUniforms.uCascadeSplit1),
    vViewDepth: viewDepth,
  });

  const baseColor = material.colorNode ?? uniform(material.color);
  material.colorNode = baseColor.mul(shadowFactor);
}
