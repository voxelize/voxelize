import type { Texture } from "three";
import { float, vec3 } from "three/tsl";

import { entityShadowNode } from "./entity-shadow-node";
import { hitEffectNode } from "./hit-effect-node";
import { voxelFogNode } from "./voxel-fog-node";

type NodeRef = ReturnType<typeof float>;

export function withShadow(
  color: NodeRef,
  params: {
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
  },
): NodeRef {
  return color.mul(entityShadowNode(params));
}

export function withUpwardShadow(
  color: NodeRef,
  params: Omit<Parameters<typeof withShadow>[1], "worldNormal">,
): NodeRef {
  return withShadow(color, { ...params, worldNormal: vec3(0, 1, 0) });
}

export function withLight(color: NodeRef, lightColor: NodeRef): NodeRef {
  return color.mul(lightColor);
}

export function withHitEffect(
  color: NodeRef,
  hitColor: NodeRef,
  hitFactor: NodeRef,
): NodeRef {
  return hitEffectNode(color, hitColor, hitFactor);
}

export function withFog(
  color: NodeRef,
  params: {
    worldPosition: NodeRef;
    fogColor: NodeRef;
    fogNear: NodeRef;
    fogFar: NodeRef;
    fogHeightOrigin: NodeRef;
    fogHeightDensity: NodeRef;
  },
): NodeRef {
  return voxelFogNode(
    color,
    params.worldPosition,
    params.fogColor,
    params.fogNear,
    params.fogFar,
    params.fogHeightOrigin,
    params.fogHeightDensity,
  );
}
