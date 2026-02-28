import type { Texture } from "three";
import { float, vec3, vec4, positionLocal, uniform } from "three/tsl";

import { skinPosition } from "../nodes/bone-sampling-node";

type NodeRef = ReturnType<typeof float>;

interface DepthMaterialParams {
  boneTexture: Texture;
  boneTextureWidth: number;
  boneTextureHeight: number;
}

export function buildSkinnedDepthNodes(params: DepthMaterialParams) {
  const { boneTexture, boneTextureWidth, boneTextureHeight } = params;

  const uTexWidth = uniform(boneTextureWidth);
  const uTexHeight = uniform(boneTextureHeight);

  const skinIdx = vec4(0, 0, 0, 0);
  const skinWt = vec4(1, 0, 0, 0);
  const boneOffset = float(0);
  const pivotOffset = vec3(0, 0, 0);

  const positionNode = skinPosition(
    positionLocal,
    pivotOffset,
    skinIdx,
    skinWt,
    boneOffset,
    boneTexture,
    uTexWidth,
    uTexHeight,
  );

  return {
    positionNode,
    uniforms: {
      texWidth: uTexWidth,
      texHeight: uTexHeight,
    },
  };
}
