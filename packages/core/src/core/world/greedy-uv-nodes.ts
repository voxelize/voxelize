import { abs, float, floor, fract, mix, step, vec2 } from "three/tsl";
import type { Node, ShaderNodeObject, UniformNode } from "three/tsl";

export function createGreedyUVNode(params: {
  baseUV: ShaderNodeObject<Node>;
  worldPosition: ShaderNodeObject<Node>;
  worldNormal: ShaderNodeObject<Node>;
  isGreedy: ShaderNodeObject<Node>;
  atlasSize: ShaderNodeObject<UniformNode<number>>;
}): ShaderNodeObject<Node> {
  const { baseUV, worldPosition, worldNormal, isGreedy, atlasSize } = params;

  const one = float(1.0);
  const half = float(0.5);

  const cellSize = one.div(atlasSize);
  const padding = cellSize.div(4.0);

  const fractX = fract(worldPosition.x);
  const fractY = fract(worldPosition.y);
  const fractZ = fract(worldPosition.z);

  const absNormal = abs(worldNormal);
  const isY = step(half, absNormal.y);
  const isX = one.sub(isY).mul(step(half, absNormal.x));
  const isZ = one.sub(isY).sub(isX);

  const yPosUv = vec2(one.sub(fractX), fractZ);
  const yNegUv = vec2(fractX, one.sub(fractZ));
  const xPosUv = vec2(one.sub(fractZ), fractY);
  const xNegUv = vec2(fractZ, fractY);
  const zPosUv = vec2(fractX, fractY);
  const zNegUv = vec2(one.sub(fractX), fractY);

  const yUv = mix(yNegUv, yPosUv, step(0.0, worldNormal.y));
  const xUv = mix(xNegUv, xPosUv, step(0.0, worldNormal.x));
  const zUv = mix(zNegUv, zPosUv, step(0.0, worldNormal.z));

  const localUv = yUv.mul(isY).add(xUv.mul(isX)).add(zUv.mul(isZ));

  const cellMin = floor(baseUV.div(cellSize)).mul(cellSize);
  const innerMin = cellMin.add(padding);
  const innerSize = cellSize.sub(padding.mul(2.0));
  const greedyUv = innerMin.add(localUv.mul(innerSize));

  return mix(baseUV, greedyUv, step(half, isGreedy));
}
