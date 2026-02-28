import { Fn, float, vec3, mix, floor } from "three/tsl";

import { simplexNoise3d } from "./simplex-noise-node";

export const swayNode = /* @__PURE__ */ Fn(
  ([
    position,
    time,
    windDirection,
    windSpeed,
    speed,
    amplitude,
    scale,
    yScale,
    isRooted,
  ]: [
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
  ]) => {
    const swayScale = time.mul(0.00002).mul(speed);
    const windOffset = windDirection.mul(windSpeed).mul(time).mul(0.00005);

    const rootFactor = position.y.sub(floor(position.y));
    const rootScale = mix(float(1.0), rootFactor, isRooted);

    const noisePos = vec3(
      position.x.mul(swayScale).add(windOffset.x),
      position.y.mul(swayScale).mul(yScale),
      position.z.mul(swayScale).add(windOffset.y),
    );
    const swayNoise = simplexNoise3d(noisePos);

    const offsetX = rootScale.mul(scale).mul(swayNoise).mul(2.0).mul(amplitude);
    const offsetZ = rootScale
      .mul(scale)
      .mul(swayNoise)
      .mul(amplitude)
      .mul(windSpeed)
      .mul(0.5);

    return position.add(vec3(offsetX, float(0), offsetZ));
  },
);
