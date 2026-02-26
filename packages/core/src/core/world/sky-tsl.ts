import { BackSide, Color } from "three";
import {
  add,
  float,
  max,
  mix,
  normalize,
  positionWorld,
  pow,
  uniform,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

export function createSkyMaterial(uniforms: {
  topColor: { value: Color };
  middleColor: { value: Color };
  bottomColor: { value: Color };
  skyOffset: { value: number };
  voidOffset: { value: number };
}): MeshBasicNodeMaterial {
  const topColor = uniform(uniforms.topColor.value);
  const middleColor = uniform(uniforms.middleColor.value);
  const bottomColor = uniform(uniforms.bottomColor.value);
  const skyOffset = uniform(uniforms.skyOffset.value);
  const voidOffset = uniform(uniforms.voidOffset.value);
  const exponent = uniform(0.6);
  const exponent2 = uniform(1.2);
  const zero = float(0);

  const h = normalize(add(positionWorld, skyOffset)).y;
  const h2 = normalize(add(positionWorld, voidOffset)).y;
  const topFactor = max(pow(max(h, zero), exponent), zero);
  const color = mix(middleColor, topColor, topFactor);
  const bottomFactor = max(pow(max(h2.mul(-1), zero), exponent2), zero);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = mix(color, bottomColor, bottomFactor);
  material.depthWrite = false;
  material.side = BackSide;
  material.toneMapped = false;

  return material;
}
