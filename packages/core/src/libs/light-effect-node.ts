import type { Color } from "three";
import { uniform } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

export function applyLightEffectToMaterial(
  material: MeshBasicNodeMaterial,
  lightColor: { value: Color },
): void {
  const uLightColor = uniform(lightColor);
  const baseColor = material.colorNode ?? uniform(material.color);
  material.colorNode = baseColor.mul(uLightColor);
}
