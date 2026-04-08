import { float, floor, positionLocal, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

import { snoise } from "./noise";

export interface SwayOptions {
  speed?: number;
  amplitude?: number;
  scale?: number;
  isRooted?: boolean;
  yScale?: number;
}

export function createSwayDisplacement(params: {
  options: SwayOptions;
  time: Node;
  windDirection: Node;
  windSpeed: Node;
}): Node {
  const { options, time, windDirection, windSpeed } = params;
  const {
    speed = 1.0,
    amplitude = 0.02,
    scale = 1.0,
    isRooted = false,
    yScale = 0.5,
  } = options;

  const swayScale = time.mul(0.00002 * speed);
  const windOffset = windDirection.mul(windSpeed).mul(time).mul(0.00005);

  const rootScale = isRooted
    ? positionLocal.y.sub(floor(positionLocal.y))
    : float(1.0);

  const swayNoise = snoise(
    vec3(
      positionLocal.x.mul(swayScale).add(windOffset.x),
      positionLocal.y.mul(swayScale).mul(yScale),
      positionLocal.z.mul(swayScale).add(windOffset.y),
    ),
  );

  const base = rootScale.mul(scale).mul(swayNoise);
  const dx = base.mul(2.0 * amplitude);
  const dz = base.mul(amplitude).mul(windSpeed).mul(0.5);

  return vec3(dx, 0.0, dz);
}
