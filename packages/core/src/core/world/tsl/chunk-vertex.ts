import {
  cameraViewMatrix,
  modelNormalMatrix,
  modelWorldMatrix,
  normalLocal,
  positionLocal,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";

import { snoise } from "./noise";

export interface ChunkVertexResult {
  position: Node;
  worldPosition: Node;
  worldNormal: Node;
}

export interface ChunkVertexShaderLitResult extends ChunkVertexResult {
  viewDepth: Node;
  shadowCoords: [Node, Node, Node];
}

export function chunkVertexPosition(params: {
  shouldWave: Node;
  time: Node;
}): ChunkVertexResult {
  const { shouldWave, time } = params;

  const worldPosForWave = modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz;
  const waveTime = time.mul(0.0006);

  const wave1 = snoise(
    vec3(
      worldPosForWave.x.mul(0.15).add(waveTime.mul(0.3)),
      worldPosForWave.z.mul(0.15).sub(waveTime.mul(0.2)),
      0.0,
    ),
  ).mul(0.08);

  const wave2 = snoise(
    vec3(
      worldPosForWave.x.mul(0.4).sub(waveTime.mul(0.5)),
      worldPosForWave.z.mul(0.4).add(waveTime.mul(0.4)),
      10.0,
    ),
  ).mul(0.04);

  const wave3 = snoise(
    vec3(
      worldPosForWave.x.mul(0.8).add(waveTime.mul(0.7)),
      worldPosForWave.z.mul(0.8).sub(waveTime.mul(0.5)),
      20.0,
    ),
  ).mul(0.02);

  const waveDisplacement = wave1.add(wave2).add(wave3);
  const position = positionLocal.add(
    vec3(0.0, shouldWave.mul(waveDisplacement), 0.0),
  );

  const worldPosition = modelWorldMatrix.mul(vec4(position, 1.0));
  const worldNormal = modelNormalMatrix.mul(normalLocal).normalize();

  return { position, worldPosition, worldNormal };
}

export function chunkVertexPositionShaderLit(params: {
  shouldWave: Node;
  time: Node;
  shadowMatrices: [Node, Node, Node];
}): ChunkVertexShaderLitResult {
  const { shouldWave, time, shadowMatrices } = params;
  const { position, worldPosition, worldNormal } = chunkVertexPosition({
    shouldWave,
    time,
  });

  const viewPos = cameraViewMatrix.mul(worldPosition);
  const viewDepth = viewPos.z.negate();

  const normalOffset = worldNormal.mul(0.02);
  const offsetPosition = worldPosition.add(vec4(normalOffset, 0.0));

  const shadowCoords: [Node, Node, Node] = [
    shadowMatrices[0].mul(offsetPosition),
    shadowMatrices[1].mul(offsetPosition),
    shadowMatrices[2].mul(offsetPosition),
  ];

  return { position, worldPosition, worldNormal, viewDepth, shadowCoords };
}
