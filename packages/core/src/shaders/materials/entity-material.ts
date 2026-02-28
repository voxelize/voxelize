import { Color, Vector3 } from "three";
import type { Texture } from "three";
import {
  float,
  vec3,
  min,
  texture,
  uniform,
  uv,
  normalLocal,
  normalWorld,
  positionWorld,
  cameraPosition,
} from "three/tsl";

import { entityShadowNode } from "../nodes/entity-shadow-node";
import { faceUVNode } from "../nodes/face-uv-node";
import { hitEffectNode } from "../nodes/hit-effect-node";
import { voxelFogNode } from "../nodes/voxel-fog-node";

type NodeRef = ReturnType<typeof float>;

interface EntityColorParams {
  colorMap: Texture;
  lightColor: NodeRef;
  hitEffect: NodeRef;
  partIndex?: NodeRef;
  useFaceUV?: boolean;
  atlasCols?: number;
  atlasRows?: number;
  receiveShadows?: boolean;
  shadowMap?: Texture;
  shadowCoord?: NodeRef;
  shadowMapSize?: number;
}

interface EntityColorSetup {
  colorNode: NodeRef;
  opacityNode: NodeRef;
  uniforms: {
    color: ReturnType<typeof uniform>;
    opacity: ReturnType<typeof uniform>;
    hitColor: ReturnType<typeof uniform>;
    maxBrightness: ReturnType<typeof uniform>;
    fogColor: ReturnType<typeof uniform>;
    fogNear: ReturnType<typeof uniform>;
    fogFar: ReturnType<typeof uniform>;
    fogHeightOrigin: ReturnType<typeof uniform>;
    fogHeightDensity: ReturnType<typeof uniform>;
    shadowStrength: ReturnType<typeof uniform>;
    shadowBias: ReturnType<typeof uniform>;
    shadowNormalBias: ReturnType<typeof uniform>;
    sunlightIntensity: ReturnType<typeof uniform>;
    sunDirection: ReturnType<typeof uniform>;
    cascadeSplit1: ReturnType<typeof uniform>;
  };
}

export function buildEntityColorNodes(
  params: EntityColorParams,
): EntityColorSetup {
  const {
    colorMap,
    lightColor,
    hitEffect,
    partIndex,
    useFaceUV = false,
    atlasCols = 6,
    atlasRows = 5,
    receiveShadows = false,
    shadowMap,
    shadowCoord,
    shadowMapSize = 64,
  } = params;

  const uColor = uniform(new Color(1, 1, 1));
  const uOpacity = uniform(1.0);
  const uHitColor = uniform(new Color(1, 0, 0));
  const uMaxBrightness = uniform(1.0);
  const uFogColor = uniform(new Color(0.694, 0.8, 0.992));
  const uFogNear = uniform(100.0);
  const uFogFar = uniform(200.0);
  const uFogHeightOrigin = uniform(80.0);
  const uFogHeightDensity = uniform(0.005);
  const uShadowStrength = uniform(1.0);
  const uShadowBias = uniform(0.0005);
  const uShadowNormalBias = uniform(0.01);
  const uSunlightIntensity = uniform(1.0);
  const uSunDirection = uniform(new Vector3(0.5, 1.0, 0.3).normalize());
  const uCascadeSplit1 = uniform(48.0);

  const finalUV =
    useFaceUV && partIndex
      ? faceUVNode(
          uv(),
          normalLocal,
          partIndex,
          float(atlasCols),
          float(atlasRows),
        )
      : uv();

  const texColor = texture(colorMap, finalUV);
  let color: NodeRef = texColor.xyz.mul(uColor);

  const clampedLight = min(lightColor, vec3(uMaxBrightness));
  color = color.mul(clampedLight);

  if (receiveShadows && shadowMap && shadowCoord) {
    const shadow = entityShadowNode({
      worldNormal: normalWorld,
      sunDirection: uSunDirection,
      viewDepth: positionWorld.sub(cameraPosition).length(),
      shadowMap,
      shadowCoord,
      cascadeSplit1: uCascadeSplit1,
      shadowBias: uShadowBias,
      shadowNormalBias: uShadowNormalBias,
      shadowStrength: uShadowStrength,
      sunlightIntensity: uSunlightIntensity,
      minOccluderDepth: float(0.0),
      shadowMapSize,
    });
    color = color.mul(shadow);
  }

  color = hitEffectNode(color, uHitColor, hitEffect);

  const colorNode = voxelFogNode(
    color,
    positionWorld,
    uFogColor,
    uFogNear,
    uFogFar,
    uFogHeightOrigin,
    uFogHeightDensity,
  );

  return {
    colorNode,
    opacityNode: texColor.w.mul(uOpacity),
    uniforms: {
      color: uColor,
      opacity: uOpacity,
      hitColor: uHitColor,
      maxBrightness: uMaxBrightness,
      fogColor: uFogColor,
      fogNear: uFogNear,
      fogFar: uFogFar,
      fogHeightOrigin: uFogHeightOrigin,
      fogHeightDensity: uFogHeightDensity,
      shadowStrength: uShadowStrength,
      shadowBias: uShadowBias,
      shadowNormalBias: uShadowNormalBias,
      sunlightIntensity: uSunlightIntensity,
      sunDirection: uSunDirection,
      cascadeSplit1: uCascadeSplit1,
    },
  };
}
