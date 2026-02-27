import { Color } from "three";
import { positionWorld, uniform } from "three/tsl";

import { skyColorNode } from "../nodes/sky-color-node";

export function buildSkyNodes() {
  const uTopColor = uniform(new Color(0.25, 0.45, 0.9));
  const uMiddleColor = uniform(new Color(0.7, 0.8, 0.95));
  const uBottomColor = uniform(new Color(0.12, 0.08, 0.06));
  const uSkyOffset = uniform(0.0);
  const uVoidOffset = uniform(0.0);
  const uExponent = uniform(1.0);
  const uExponent2 = uniform(2.0);

  const colorNode = skyColorNode(
    positionWorld,
    uTopColor,
    uMiddleColor,
    uBottomColor,
    uSkyOffset,
    uVoidOffset,
    uExponent,
    uExponent2,
  );

  return {
    colorNode,
    uniforms: {
      topColor: uTopColor,
      middleColor: uMiddleColor,
      bottomColor: uBottomColor,
      skyOffset: uSkyOffset,
      voidOffset: uVoidOffset,
      exponent: uExponent,
      exponent2: uExponent2,
    },
  };
}
