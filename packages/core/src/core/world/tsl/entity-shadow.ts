import {
  cameraViewMatrix,
  clamp,
  dot,
  float,
  Fn,
  If,
  max,
  mix,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";

import { sampleShadowMapPCSS } from "./chunk-shadows";

export interface EntityShadowVertexResult {
  shadowCoords: [Node, Node, Node];
  viewDepth: Node;
}

export function computeEntityShadowCoords(params: {
  worldPosition: Node;
  shadowMatrices: [Node, Node, Node];
  worldOffset: Node;
}): EntityShadowVertexResult {
  const { worldPosition, shadowMatrices, worldOffset } = params;

  const shadowWorldPos = vec4(worldPosition.xyz.add(worldOffset), 1.0);

  const shadowCoords: [Node, Node, Node] = [
    shadowMatrices[0].mul(shadowWorldPos),
    shadowMatrices[1].mul(shadowWorldPos),
    shadowMatrices[2].mul(shadowWorldPos),
  ];

  const viewPos = cameraViewMatrix.mul(vec4(worldPosition.xyz, 1.0));
  const viewDepth = viewPos.z.negate();

  return { shadowCoords, viewDepth };
}

export function getEntityShadow(params: {
  worldNormal: Node;
  viewDepth: Node;
  shadowCoords: [Node, Node, Node];
  shadowMaps: [Node, Node, Node];
  cascadeSplits: [Node, Node, Node];
  shadowBias: Node;
  shadowNormalBias: Node;
  shadowStrength: Node;
  sunlightIntensity: Node;
  sunDirection: Node;
  minOccluderDepth: Node;
}): Node {
  const {
    worldNormal,
    viewDepth,
    shadowCoords,
    shadowMaps,
    cascadeSplits,
    shadowBias,
    shadowNormalBias,
    shadowStrength,
    sunlightIntensity,
    sunDirection,
    minOccluderDepth,
  } = params;

  return Fn(() => {
    const result = float(1.0).toVar();
    const effectiveStrength = shadowStrength.mul(sunlightIntensity);

    If(effectiveStrength.greaterThanEqual(0.01), () => {
      const cosTheta = clamp(dot(worldNormal, sunDirection), 0.0, 1.0);
      const bias = shadowBias.add(
        shadowNormalBias.mul(float(1.0).sub(cosTheta)),
      );

      const rawShadow = sampleShadowMapPCSS(
        shadowMaps[0],
        shadowCoords[0],
        bias,
        minOccluderDepth,
      ).toVar();

      const maxEntityDist = cascadeSplits[1];

      If(viewDepth.lessThanEqual(maxEntityDist), () => {
        const fadeStart = maxEntityDist.mul(0.7);

        If(viewDepth.greaterThan(fadeStart), () => {
          const t = viewDepth.sub(fadeStart).div(maxEntityDist.sub(fadeStart));
          rawShadow.assign(mix(rawShadow, float(1.0), t));
        });

        result.assign(
          max(mix(float(1.0), rawShadow, effectiveStrength.mul(0.65)), 0.6),
        );
      });
    });

    return result;
  })();
}
