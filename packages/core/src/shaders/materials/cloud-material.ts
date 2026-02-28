import { Color } from "three";
import { positionWorld, uniform } from "three/tsl";

import { cloudColorNode } from "../nodes/cloud-node";

export function buildCloudNodes() {
  const uCloudColor = uniform(new Color(0.95, 0.95, 0.95));
  const uCloudAlpha = uniform(0.8);
  const uFogColor = uniform(new Color(0.7, 0.75, 0.85));
  const uFogNear = uniform(50.0);
  const uFogFar = uniform(200.0);

  const result = cloudColorNode(
    positionWorld,
    uCloudColor,
    uCloudAlpha,
    uFogColor,
    uFogNear,
    uFogFar,
  );

  return {
    colorNode: result.xyz,
    opacityNode: result.w,
    uniforms: {
      cloudColor: uCloudColor,
      cloudAlpha: uCloudAlpha,
      fogColor: uFogColor,
      fogNear: uFogNear,
      fogFar: uFogFar,
    },
  };
}
