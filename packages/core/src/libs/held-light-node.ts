import type { Color } from "three";
import type { Node, ShaderNodeObject } from "three/tsl";
import { uniform } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

import type { EntityShadowUniforms } from "../core/world/entity-shadow-uniforms";

import { applyEntityShadowToMaterial } from "./entity-shadow-node";

export function applyHeldLightToMaterial(
  material: MeshBasicNodeMaterial,
  shadowUniforms: EntityShadowUniforms,
  lightColor: { value: Color },
  worldNormal: ShaderNodeObject<Node>,
  shadowCoord0: ShaderNodeObject<Node>,
  viewDepth: ShaderNodeObject<Node>,
): void {
  applyEntityShadowToMaterial(
    material,
    shadowUniforms,
    worldNormal,
    shadowCoord0,
    viewDepth,
  );
  const uLightColor = uniform(lightColor);
  material.colorNode = material.colorNode!.mul(uLightColor);
}
