import type { Vector2 } from "three";
import { dot, floor, float, sin, vec3 } from "three/tsl";
import type { Node, ShaderNodeObject, UniformNode } from "three/tsl";

const createFallbackSwayNoiseNode = (
  position: ShaderNodeObject<Node>,
): ShaderNodeObject<Node> => sin(dot(position, vec3(12.9898, 78.233, 37.719)));

export function createSwayPositionNode(params: {
  position: ShaderNodeObject<Node>;
  time: ShaderNodeObject<UniformNode<number>>;
  windDirection: ShaderNodeObject<UniformNode<Vector2>>;
  windSpeed: ShaderNodeObject<UniformNode<number>>;
  options?: {
    speed?: number;
    amplitude?: number;
    scale?: number;
    rooted?: boolean;
    yScale?: number;
  };
}): ShaderNodeObject<Node> {
  const { position, time, windDirection, windSpeed, options } = params;
  const {
    speed = 1,
    amplitude = 0.1,
    scale = 1,
    rooted = false,
    yScale = 1,
  } = options ?? {};

  const swayScale = time.mul(0.00002).mul(speed);
  const windOffset = windDirection.mul(windSpeed).mul(time).mul(0.00005);
  const rootScale = rooted ? position.y.sub(floor(position.y)) : float(1.0);
  const swayNoise = createFallbackSwayNoiseNode(
    vec3(
      position.x.mul(swayScale).add(windOffset.x),
      position.y.mul(swayScale).mul(yScale),
      position.z.mul(swayScale).add(windOffset.y),
    ),
  );

  const xOffset = rootScale.mul(scale).mul(swayNoise).mul(2.0).mul(amplitude);
  const zOffset = rootScale
    .mul(scale)
    .mul(swayNoise)
    .mul(amplitude)
    .mul(windSpeed)
    .mul(0.5);

  return vec3(position.x.add(xOffset), position.y, position.z.add(zOffset));
}
