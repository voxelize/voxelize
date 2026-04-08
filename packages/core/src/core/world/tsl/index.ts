import { attribute, texture, uniform, uv, vec4 } from "three/tsl";
import type {
  Color,
  Matrix4,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";

import { applyChunkFog, applyShadowDebug } from "./chunk-fog";
import { applyDefaultLighting } from "./chunk-lighting";
import {
  applyShaderLighting,
  applyShaderLightingCross,
} from "./chunk-lighting-gpu";
import { getChunkShadow } from "./chunk-shadows";
import { createSwayDisplacement } from "./chunk-sway";
import type { SwayOptions } from "./chunk-sway";
import { applyGreedyDebug, computeChunkUV } from "./chunk-uv";
import {
  chunkVertexPosition,
  chunkVertexPositionShaderLit,
} from "./chunk-vertex";
import type { ChunkVertexShaderLitResult } from "./chunk-vertex";
import { applyUnderwaterCaustics, applyWaterSurface } from "./chunk-water";
import { unpackChunkLight } from "./light-unpack";

export type { SwayOptions };

export interface ChunkMaterialUniforms {
  time: { value: number };
  sunlightIntensity: { value: number };
  aoTable: { value: Vector4 };
  minLightLevel: { value: number };
  baseAmbient: { value: number };
  lightIntensityAdjustment: { value: number };
  fogNear: { value: number };
  fogFar: { value: number };
  fogColor: { value: Color };
  fogHeightOrigin: { value: number };
  fogHeightDensity: { value: number };
  windDirection: { value: Vector2 };
  windSpeed: { value: number };
  atlasSize: { value: number };
  showGreedyDebug: { value: number };
}

export interface ShaderLightingMaterialUniforms {
  sunDirection: { value: Vector3 };
  sunColor: { value: Color };
  ambientColor: { value: Color };
  shadowMap0: { value: Texture | null };
  shadowMap1: { value: Texture | null };
  shadowMap2: { value: Texture | null };
  shadowMatrix0: { value: Matrix4 };
  shadowMatrix1: { value: Matrix4 };
  shadowMatrix2: { value: Matrix4 };
  cascadeSplit0: { value: number };
  cascadeSplit1: { value: number };
  cascadeSplit2: { value: number };
  shadowBias: { value: number };
  shadowStrength: { value: number };
  lightVolume: { value: Texture | null };
  lightVolumeMin: { value: Vector3 };
  lightVolumeSize: { value: Vector3 };
  waterTint: { value: Color };
  waterAbsorption: { value: number };
  waterLevel: { value: number };
  skyTopColor: { value: Color };
  skyMiddleColor: { value: Color };
  shadowDebugMode: { value: number };
}

type ToUniformNodes<T> = {
  [K in keyof T]: T[K] extends { value: infer V } ? UniformNode<V> : never;
};

type ChunkUniformNodes = ToUniformNodes<ChunkMaterialUniforms>;
type ShaderLightingUniformNodes =
  ToUniformNodes<ShaderLightingMaterialUniforms>;

const chunkNodesCache = new WeakMap<ChunkMaterialUniforms, ChunkUniformNodes>();
const shaderLightingNodesCache = new WeakMap<
  ShaderLightingMaterialUniforms,
  ShaderLightingUniformNodes
>();

function getChunkUniformNodes(u: ChunkMaterialUniforms): ChunkUniformNodes {
  let nodes = chunkNodesCache.get(u);
  if (nodes) return nodes;

  nodes = {
    time: uniform(u.time.value),
    sunlightIntensity: uniform(u.sunlightIntensity.value),
    aoTable: uniform(u.aoTable.value),
    minLightLevel: uniform(u.minLightLevel.value),
    baseAmbient: uniform(u.baseAmbient.value),
    lightIntensityAdjustment: uniform(u.lightIntensityAdjustment.value),
    fogNear: uniform(u.fogNear.value),
    fogFar: uniform(u.fogFar.value),
    fogColor: uniform(u.fogColor.value),
    fogHeightOrigin: uniform(u.fogHeightOrigin.value),
    fogHeightDensity: uniform(u.fogHeightDensity.value),
    windDirection: uniform(u.windDirection.value),
    windSpeed: uniform(u.windSpeed.value),
    atlasSize: uniform(u.atlasSize.value),
    showGreedyDebug: uniform(u.showGreedyDebug.value),
  };
  chunkNodesCache.set(u, nodes);
  return nodes;
}

function getShaderLightingUniformNodes(
  u: ShaderLightingMaterialUniforms,
): ShaderLightingUniformNodes {
  let nodes = shaderLightingNodesCache.get(u);
  if (nodes) return nodes;

  nodes = {
    sunDirection: uniform(u.sunDirection.value),
    sunColor: uniform(u.sunColor.value),
    ambientColor: uniform(u.ambientColor.value),
    shadowMap0: uniform(u.shadowMap0.value),
    shadowMap1: uniform(u.shadowMap1.value),
    shadowMap2: uniform(u.shadowMap2.value),
    shadowMatrix0: uniform(u.shadowMatrix0.value),
    shadowMatrix1: uniform(u.shadowMatrix1.value),
    shadowMatrix2: uniform(u.shadowMatrix2.value),
    cascadeSplit0: uniform(u.cascadeSplit0.value),
    cascadeSplit1: uniform(u.cascadeSplit1.value),
    cascadeSplit2: uniform(u.cascadeSplit2.value),
    shadowBias: uniform(u.shadowBias.value),
    shadowStrength: uniform(u.shadowStrength.value),
    lightVolume: uniform(u.lightVolume.value),
    lightVolumeMin: uniform(u.lightVolumeMin.value),
    lightVolumeSize: uniform(u.lightVolumeSize.value),
    waterTint: uniform(u.waterTint.value),
    waterAbsorption: uniform(u.waterAbsorption.value),
    waterLevel: uniform(u.waterLevel.value),
    skyTopColor: uniform(u.skyTopColor.value),
    skyMiddleColor: uniform(u.skyMiddleColor.value),
    shadowDebugMode: uniform(u.shadowDebugMode.value),
  };
  shaderLightingNodesCache.set(u, nodes);
  return nodes;
}

export function syncChunkUniforms(u: ChunkMaterialUniforms): void {
  const n = chunkNodesCache.get(u);
  if (!n) return;
  n.time.value = u.time.value;
  n.sunlightIntensity.value = u.sunlightIntensity.value;
  n.minLightLevel.value = u.minLightLevel.value;
  n.baseAmbient.value = u.baseAmbient.value;
  n.lightIntensityAdjustment.value = u.lightIntensityAdjustment.value;
  n.fogNear.value = u.fogNear.value;
  n.fogFar.value = u.fogFar.value;
  n.fogHeightOrigin.value = u.fogHeightOrigin.value;
  n.fogHeightDensity.value = u.fogHeightDensity.value;
  n.windSpeed.value = u.windSpeed.value;
  n.atlasSize.value = u.atlasSize.value;
  n.showGreedyDebug.value = u.showGreedyDebug.value;
}

export function syncShaderLightingUniforms(
  u: ShaderLightingMaterialUniforms,
): void {
  const n = shaderLightingNodesCache.get(u);
  if (!n) return;
  n.cascadeSplit0.value = u.cascadeSplit0.value;
  n.cascadeSplit1.value = u.cascadeSplit1.value;
  n.cascadeSplit2.value = u.cascadeSplit2.value;
  n.shadowBias.value = u.shadowBias.value;
  n.shadowStrength.value = u.shadowStrength.value;
  n.waterAbsorption.value = u.waterAbsorption.value;
  n.waterLevel.value = u.waterLevel.value;
  n.shadowDebugMode.value = u.shadowDebugMode.value;
  n.shadowMap0.value = u.shadowMap0.value;
  n.shadowMap1.value = u.shadowMap1.value;
  n.shadowMap2.value = u.shadowMap2.value;
  n.lightVolume.value = u.lightVolume.value;
}

function buildShaderLightingColor(
  u: ChunkUniformNodes,
  su: ShaderLightingUniformNodes,
  vertexResult: ChunkVertexShaderLitResult,
  diffuseRgb: Node,
  debugColor: Node,
  lightVec4: Node,
  ao: Node,
  isFluid: Node,
  isCross: boolean,
): Node {
  const shadow = getChunkShadow({
    shadowMaps: [su.shadowMap0, su.shadowMap1, su.shadowMap2],
    shadowCoords: vertexResult.shadowCoords,
    cascadeSplits: [su.cascadeSplit0, su.cascadeSplit1, su.cascadeSplit2],
    viewDepth: vertexResult.viewDepth,
    worldNormal: vertexResult.worldNormal,
    sunDirection: su.sunDirection,
    lightAlpha: lightVec4.a,
    shadowBias: su.shadowBias,
    shadowStrength: su.shadowStrength,
  });

  const litFn = isCross ? applyShaderLightingCross : applyShaderLighting;
  const litResult = litFn({
    outgoingLight: debugColor,
    diffuseColor: debugColor,
    worldPosition: vertexResult.worldPosition,
    worldNormal: vertexResult.worldNormal,
    lightVec4,
    ao,
    isFluid,
    shadow,
    sunDirection: su.sunDirection,
    sunColor: su.sunColor,
    sunlightIntensity: u.sunlightIntensity,
    ambientColor: su.ambientColor,
    lightVolume: su.lightVolume,
    lightVolumeMin: su.lightVolumeMin,
    lightVolumeSize: su.lightVolumeSize,
  });

  const totalLightWithCaustics = applyUnderwaterCaustics({
    totalLight: litResult.totalLight,
    worldPosition: vertexResult.worldPosition,
    isFluid,
    waterLevel: su.waterLevel,
    time: u.time,
    shadow: litResult.shadow,
    sunlightIntensity: u.sunlightIntensity,
  });

  let outRgb: Node = diffuseRgb.mul(totalLightWithCaustics);

  if (!isCross) {
    outRgb = applyWaterSurface({
      outgoingLight: outRgb,
      worldPosition: vertexResult.worldPosition,
      worldNormal: vertexResult.worldNormal,
      isFluid,
      waterLevel: su.waterLevel,
      waterTint: su.waterTint,
      waterAbsorption: su.waterAbsorption,
      sunDirection: su.sunDirection,
      sunColor: su.sunColor,
      sunlightIntensity: u.sunlightIntensity,
      skyTopColor: su.skyTopColor,
      skyMiddleColor: su.skyMiddleColor,
      time: u.time,
    });
  }

  outRgb = applyChunkFog({
    color: outRgb,
    worldPosition: vertexResult.worldPosition,
    fogColor: u.fogColor,
    fogNear: u.fogNear,
    fogFar: u.fogFar,
    fogHeightOrigin: u.fogHeightOrigin,
    fogHeightDensity: u.fogHeightDensity,
  });

  outRgb = applyShadowDebug({
    color: outRgb,
    debugMode: su.shadowDebugMode,
    shadow: litResult.shadow,
    worldNormal: vertexResult.worldNormal,
    sunDirection: su.sunDirection,
    ao,
    viewDepth: vertexResult.viewDepth,
    cascadeSplits: [su.cascadeSplit0, su.cascadeSplit1, su.cascadeSplit2],
    sunExposure: litResult.sunExposure,
    tunnelDarkening: litResult.tunnelDarkening,
  });

  return outRgb;
}

function buildDefaultColor(
  u: ChunkUniformNodes,
  worldPosition: Node,
  debugColor: Node,
  lightVec4: Node,
  ao: Node,
  isFluid: Node,
): Node {
  const litRgb = applyDefaultLighting({
    outgoingLight: debugColor,
    lightVec4,
    ao,
    isFluid,
    sunlightIntensity: u.sunlightIntensity,
    minLightLevel: u.minLightLevel,
    baseAmbient: u.baseAmbient,
    lightIntensityAdjustment: u.lightIntensityAdjustment,
  });

  return applyChunkFog({
    color: litRgb,
    worldPosition,
    fogColor: u.fogColor,
    fogNear: u.fogNear,
    fogFar: u.fogFar,
    fogHeightOrigin: u.fogHeightOrigin,
    fogHeightDensity: u.fogHeightDensity,
  });
}

export function makeChunkNodeMaterial(opts: {
  isShaderLighting: boolean;
  isCross?: boolean;
  swayOptions?: SwayOptions;
  uniforms: ChunkMaterialUniforms;
  shaderLightingUniforms?: ShaderLightingMaterialUniforms;
  atlas: Texture;
  isTransparent?: boolean;
}): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.vertexColors = true;

  const u = getChunkUniformNodes(opts.uniforms);
  const su =
    opts.isShaderLighting && opts.shaderLightingUniforms
      ? getShaderLightingUniformNodes(opts.shaderLightingUniforms)
      : null;

  const lightAttr = attribute("light", "int");
  const { ao, isFluid, isGreedy, shouldWave, lightVec4 } = unpackChunkLight(
    lightAttr,
    u.aoTable,
  );

  const vertexResult = su
    ? chunkVertexPositionShaderLit({
        shouldWave,
        time: u.time,
        shadowMatrices: [su.shadowMatrix0, su.shadowMatrix1, su.shadowMatrix2],
      })
    : chunkVertexPosition({ shouldWave, time: u.time });

  let position = vertexResult.position;
  if (opts.swayOptions) {
    position = position.add(
      createSwayDisplacement({
        options: opts.swayOptions,
        time: u.time,
        windDirection: u.windDirection,
        windSpeed: u.windSpeed,
      }),
    );
  }

  material.positionNode = position;

  const atlasNode = texture(opts.atlas);
  const remappedUV = computeChunkUV({
    isGreedy,
    worldPosition: vertexResult.worldPosition,
    worldNormal: vertexResult.worldNormal,
    baseUV: uv(),
    atlasSize: u.atlasSize,
  });
  const texColor = atlasNode.uv(remappedUV);
  const vertColor = attribute("color", "vec3");
  const diffuseRgb = texColor.rgb.mul(vertColor);
  const debugColor = applyGreedyDebug({
    color: vec4(diffuseRgb, texColor.a),
    isGreedy,
    isShowDebug: u.showGreedyDebug,
  });

  const outRgb = su
    ? buildShaderLightingColor(
        u,
        su,
        vertexResult as ChunkVertexShaderLitResult,
        debugColor.rgb,
        debugColor,
        lightVec4,
        ao,
        isFluid,
        opts.isCross === true,
      )
    : buildDefaultColor(
        u,
        vertexResult.worldPosition,
        debugColor,
        lightVec4,
        ao,
        isFluid,
      );

  material.colorNode = vec4(outRgb, texColor.a);
  material.map = opts.atlas;
  material.userData.atlasNode = atlasNode;

  return material;
}
