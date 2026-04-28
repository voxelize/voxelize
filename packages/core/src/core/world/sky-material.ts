import { BackSide, Color } from "three";
import {
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  uniform,
  vec4,
} from "three/tsl";
import { NodeMaterial } from "three/webgpu";

export type SkyShadingUniforms = {
  uTopColor: { value: Color };
  uMiddleColor: { value: Color };
  uBottomColor: { value: Color };
  uSkyOffset: { value: number };
  uVoidOffset: { value: number };
};

export interface SkyShadingMaterialBundle {
  material: NodeMaterial;
  syncUniforms: (next: SkyShadingUniforms) => void;
}

export function createSkyShadingMaterial(
  initial: SkyShadingUniforms,
): SkyShadingMaterialBundle {
  const topColor = uniform(initial.uTopColor.value.clone());
  const middleColor = uniform(initial.uMiddleColor.value.clone());
  const bottomColor = uniform(initial.uBottomColor.value.clone());
  const skyOffset = uniform(initial.uSkyOffset.value);
  const voidOffset = uniform(initial.uVoidOffset.value);
  const exponent = uniform(0.6);
  const exponent2 = uniform(1.2);

  const h = normalize(positionWorld.add(skyOffset)).y;
  const h2 = normalize(positionWorld.add(voidOffset)).y;

  const horizonColor = mix(
    middleColor,
    topColor,
    max(pow(max(h, 0), exponent), 0),
  );
  const finalRgb = mix(
    horizonColor,
    bottomColor,
    max(pow(max(h2.negate(), 0), exponent2), 0),
  );

  const material = new NodeMaterial();
  material.fragmentNode = vec4(finalRgb, 1);
  material.depthWrite = false;
  material.side = BackSide;

  const syncUniforms = (next: SkyShadingUniforms): void => {
    topColor.value.copy(next.uTopColor.value);
    middleColor.value.copy(next.uMiddleColor.value);
    bottomColor.value.copy(next.uBottomColor.value);
    skyOffset.value = next.uSkyOffset.value;
    voidOffset.value = next.uVoidOffset.value;
  };

  return { material, syncUniforms };
}
