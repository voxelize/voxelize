import { Color, FrontSide } from "three";
import {
  cameraPosition,
  length,
  mix,
  positionWorld,
  smoothstep,
  uniform,
  vec4,
} from "three/tsl";
import { NodeMaterial } from "three/webgpu";

export type CloudsShadingUniforms = {
  uFogNear: { value: number };
  uFogFar: { value: number };
  uFogColor: { value: Color };
  uCloudColor: { value: Color };
  uCloudAlpha: { value: number };
};

export interface CloudsShadingMaterialBundle {
  material: NodeMaterial;
  syncUniforms: (next: CloudsShadingUniforms) => void;
}

export function createCloudsShadingMaterial(
  initial: CloudsShadingUniforms,
): CloudsShadingMaterialBundle {
  const fogNear = uniform(initial.uFogNear.value);
  const fogFar = uniform(initial.uFogFar.value);
  const fogColor = uniform(initial.uFogColor.value.clone());
  const cloudColor = uniform(initial.uCloudColor.value.clone());
  const cloudAlpha = uniform(initial.uCloudAlpha.value);

  const horizontalOffset = positionWorld.xz.sub(cameraPosition.xz);
  const depth = length(horizontalOffset).div(8);
  const fogFactor = smoothstep(fogNear, fogFar, depth);
  const rgb = mix(cloudColor, fogColor, fogFactor);

  const material = new NodeMaterial();
  material.fragmentNode = vec4(rgb, cloudAlpha);
  material.transparent = true;
  material.side = FrontSide;
  material.toneMapped = false;

  const syncUniforms = (next: CloudsShadingUniforms): void => {
    fogNear.value = next.uFogNear.value;
    fogFar.value = next.uFogFar.value;
    fogColor.value.copy(next.uFogColor.value);
    cloudColor.value.copy(next.uCloudColor.value);
    cloudAlpha.value = next.uCloudAlpha.value;
  };

  return { material, syncUniforms };
}
