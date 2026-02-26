import {
  Fn,
  dot,
  exp,
  float,
  max,
  mix,
  smoothstep,
  sqrt,
  sub,
  vec2,
  vec3,
} from "three/tsl";
import type { Color } from "three/tsl";
import type { Node, ShaderNodeObject, UniformNode } from "three/tsl";

type FogNodeParams = {
  worldPosition: ShaderNodeObject<Node>;
  cameraPosition: ShaderNodeObject<Node>;
  fogColor: ShaderNodeObject<UniformNode<Color>>;
  fogNear: ShaderNodeObject<UniformNode<number>>;
  fogFar: ShaderNodeObject<UniformNode<number>>;
  fogHeightOrigin: ShaderNodeObject<UniformNode<number>>;
  fogHeightDensity: ShaderNodeObject<UniformNode<number>>;
};

const applyFogNode = Fn(
  ({
    inputColor,
    worldPosition,
    cameraPosition,
    fogColor,
    fogNear,
    fogFar,
    fogHeightOrigin,
    fogHeightDensity,
  }: FogNodeParams & { inputColor: ShaderNodeObject<Node> }) => {
    const fogDiff = vec2(sub(worldPosition.xz, cameraPosition.xz));
    const depth = sqrt(dot(fogDiff, fogDiff));
    const distFog = smoothstep(fogNear, fogFar, depth);
    const heightFog = sub(
      float(1.0),
      exp(
        sub(
          float(0.0),
          fogHeightDensity.mul(
            max(float(0.0), sub(fogHeightOrigin, worldPosition.y)),
          ),
        ),
      ),
    );
    const heightDistScale = smoothstep(
      fogNear.mul(0.3),
      fogFar.mul(0.6),
      depth,
    );
    const fogFactor = max(distFog, heightFog.mul(heightDistScale));

    return mix(vec3(inputColor), fogColor, fogFactor);
  },
);

export function createFogNode(
  params: FogNodeParams,
): (inputColor: ShaderNodeObject<Node>) => ShaderNodeObject<Node> {
  return (inputColor) => applyFogNode({ ...params, inputColor });
}
