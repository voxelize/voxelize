import type { Texture } from "three";
import { float, uniform, positionLocal, vec2 } from "three/tsl";

import { swayNode } from "../nodes/sway-node";

import { buildDefaultChunkNodes } from "./chunk-material";
import { buildShaderLitChunkNodes } from "./shader-lit-chunk-material";

interface SwayChunkConfig {
  atlas: Texture;
  atlasSize: number;
  speed?: number;
  amplitude?: number;
  scale?: number;
  rooted?: boolean;
  yScale?: number;
}

export function buildSwayChunkNodes(config: SwayChunkConfig) {
  const {
    atlas,
    atlasSize,
    speed = 1,
    amplitude = 0.1,
    rooted = false,
    scale = 1,
    yScale = 1,
  } = config;

  const uTime = uniform(0.0);
  const uWindSpeed = uniform(1.0);

  const base = buildDefaultChunkNodes({ atlas, atlasSize });

  const positionNode = swayNode(
    positionLocal,
    uTime,
    vec2(1.0, 0.3),
    uWindSpeed,
    float(speed),
    float(amplitude),
    float(scale),
    float(yScale),
    float(rooted ? 1 : 0),
  );

  return {
    colorNode: base.colorNode,
    positionNode,
    uniforms: {
      ...base.uniforms,
      time: uTime,
      windSpeed: uWindSpeed,
    },
  };
}

interface SwayShaderLitChunkConfig extends SwayChunkConfig {
  shadowMaps: [Texture, Texture, Texture];
  shadowMapSize: number;
}

export function buildSwayShaderLitChunkNodes(config: SwayShaderLitChunkConfig) {
  const {
    atlas,
    atlasSize,
    shadowMaps,
    shadowMapSize,
    speed = 1,
    amplitude = 0.1,
    rooted = false,
    scale = 1,
    yScale = 1,
  } = config;

  const uTime = uniform(0.0);
  const uWindSpeed = uniform(1.0);

  const base = buildShaderLitChunkNodes({
    atlas,
    atlasSize,
    shadowMaps,
    shadowMapSize,
  });

  const positionNode = swayNode(
    positionLocal,
    uTime,
    vec2(1.0, 0.3),
    uWindSpeed,
    float(speed),
    float(amplitude),
    float(scale),
    float(yScale),
    float(rooted ? 1 : 0),
  );

  return {
    colorNode: base.colorNode,
    positionNode,
    uniforms: {
      ...base.uniforms,
      swayTime: uTime,
      windSpeed: uWindSpeed,
    },
  };
}
