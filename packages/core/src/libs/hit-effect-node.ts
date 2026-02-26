import type { Color } from "three";
import { mix, uniform } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

export function applyHitEffectToMaterial(
  material: MeshBasicNodeMaterial,
  hitAmount: { value: number },
  hitColor: Color,
): void {
  const uHitAmount = uniform(hitAmount);
  const uHitColor = uniform(hitColor);
  const baseColor = material.colorNode ?? uniform(material.color);
  material.colorNode = mix(baseColor, uHitColor, uHitAmount);
}
