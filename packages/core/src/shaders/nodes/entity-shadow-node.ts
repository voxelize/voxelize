import type { Texture } from "three";
import { float, vec2, dot, clamp, mix, max, step, smoothstep } from "three/tsl";

import { sampleShadowPCSS } from "./pcss-shadow-node";

type NodeRef = ReturnType<typeof float>;

export interface EntityShadowParams {
  worldNormal: NodeRef;
  sunDirection: NodeRef;
  viewDepth: NodeRef;
  shadowMap: Texture;
  shadowCoord: NodeRef;
  cascadeSplit1: NodeRef;
  shadowBias: NodeRef;
  shadowNormalBias: NodeRef;
  shadowStrength: NodeRef;
  sunlightIntensity: NodeRef;
  minOccluderDepth: NodeRef;
  shadowMapSize: number;
}

export function entityShadowNode(params: EntityShadowParams): NodeRef {
  const {
    worldNormal,
    sunDirection,
    viewDepth,
    shadowMap,
    shadowCoord,
    cascadeSplit1,
    shadowBias,
    shadowNormalBias,
    shadowStrength,
    sunlightIntensity,
    minOccluderDepth,
    shadowMapSize,
  } = params;

  const texelSize = vec2(1.0 / shadowMapSize, 1.0 / shadowMapSize);
  const effectiveStrength = shadowStrength.mul(sunlightIntensity);
  const hasStrength = step(float(0.01), effectiveStrength);

  const cosTheta = clamp(dot(worldNormal, sunDirection), float(0), float(1));
  const bias = shadowBias.add(shadowNormalBias.mul(float(1).sub(cosTheta)));

  const rawShadow = sampleShadowPCSS({
    shadowMap,
    shadowCoord,
    bias,
    texelSize,
    minOccluderDepth,
  });

  const maxEntityDist = cascadeSplit1;
  const inRange = step(viewDepth, maxEntityDist);

  const fadeStart = maxEntityDist.mul(0.7);
  const fadeFactor = smoothstep(fadeStart, maxEntityDist, viewDepth);
  const fadedShadow = mix(rawShadow, float(1), fadeFactor);

  const shadow = mix(float(1), fadedShadow, effectiveStrength.mul(0.65));
  const clamped = max(shadow, float(0.6));

  return mix(float(1), clamped, hasStrength.mul(inRange));
}
