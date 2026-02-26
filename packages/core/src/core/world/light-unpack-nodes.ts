import { attribute, bitAnd, float, int, shiftRight, vec4 } from "three/tsl";
import type { Node, ShaderNodeObject } from "three/tsl";

type LightNode = ShaderNodeObject<Node>;

export const createLightUnpackNodes = (
  aoTable?: LightNode,
): {
  red: LightNode;
  green: LightNode;
  blue: LightNode;
  sunlight: LightNode;
  ao: LightNode;
  isFluid: LightNode;
  isGreedy: LightNode;
  shouldWave: LightNode;
  lightVec4: LightNode;
  aoFactor: LightNode;
} => {
  // Requires the source BufferAttribute to set `gpuType = THREE.IntType`.
  const light = attribute("light", "int");
  const packedLight = bitAnd(light, int(0xffff));

  const red = float(bitAnd(shiftRight(packedLight, int(8)), int(0xf))).div(15);
  const green = float(bitAnd(shiftRight(packedLight, int(4)), int(0xf))).div(
    15,
  );
  const blue = float(bitAnd(packedLight, int(0xf))).div(15);
  const sunlight = float(
    bitAnd(shiftRight(packedLight, int(12)), int(0xf)),
  ).div(15);

  const ao = bitAnd(shiftRight(light, int(16)), int(0x3));
  const isFluid = float(bitAnd(shiftRight(light, int(18)), int(0x1)));
  const isGreedy = float(bitAnd(shiftRight(light, int(19)), int(0x1)));
  const shouldWave = float(bitAnd(shiftRight(light, int(20)), int(0x1)));

  const lightVec4 = vec4(red, green, blue, sunlight);
  const aoLookup = aoTable ?? vec4(255);
  const aoFactor = float(aoLookup.element(ao)).div(255);

  return {
    red,
    green,
    blue,
    sunlight,
    ao,
    isFluid,
    isGreedy,
    shouldWave,
    lightVec4,
    aoFactor,
  };
};
