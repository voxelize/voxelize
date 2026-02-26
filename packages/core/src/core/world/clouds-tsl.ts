import { Color, FrontSide } from "three";
import {
  cameraPosition,
  length,
  mix,
  positionWorld,
  smoothstep,
  uniform,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

export function createCloudMaterial(uniforms: {
  fogColor: { value: Color };
  fogNear: { value: number };
  fogFar: { value: number };
  cloudColor: { value: Color };
  cloudAlpha: { value: number };
}): MeshBasicNodeMaterial {
  const fogColor = uniform(uniforms.fogColor.value).onRenderUpdate(
    () => uniforms.fogColor.value,
  );
  const fogNear = uniform(uniforms.fogNear.value).onRenderUpdate(
    () => uniforms.fogNear.value,
  );
  const fogFar = uniform(uniforms.fogFar.value).onRenderUpdate(
    () => uniforms.fogFar.value,
  );
  const cloudColor = uniform(uniforms.cloudColor.value).onRenderUpdate(
    () => uniforms.cloudColor.value,
  );
  const cloudAlpha = uniform(uniforms.cloudAlpha.value).onRenderUpdate(
    () => uniforms.cloudAlpha.value,
  );

  const depth = length(positionWorld.xz.sub(cameraPosition.xz)).div(8);
  const fogFactor = smoothstep(fogNear, fogFar, depth);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(cloudColor, fogColor, fogFactor);
  material.opacityNode = cloudAlpha;
  material.transparent = true;
  material.side = FrontSide;
  material.toneMapped = false;

  return material;
}
