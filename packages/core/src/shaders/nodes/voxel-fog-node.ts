import {
  Fn,
  float,
  smoothstep,
  mix,
  max,
  exp,
  dot,
  sqrt,
  cameraPosition,
} from "three/tsl";

export const voxelFogNode = /* @__PURE__ */ Fn(
  ([
    inputColor,
    worldPosition,
    fogColor,
    fogNear,
    fogFar,
    fogHeightOrigin,
    fogHeightDensity,
  ]: [
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
  ]) => {
    const fogDiff = worldPosition.xz.sub(cameraPosition.xz);
    const depth = sqrt(dot(fogDiff, fogDiff));
    const distFog = smoothstep(fogNear, fogFar, depth);
    const heightFog = float(1.0).sub(
      exp(
        fogHeightDensity
          .negate()
          .mul(max(float(0.0), fogHeightOrigin.sub(worldPosition.y))),
      ),
    );
    const heightDistScale = smoothstep(
      fogNear.mul(0.3),
      fogFar.mul(0.6),
      depth,
    );
    const fogFactor = max(distFog, heightFog.mul(heightDistScale));

    return mix(inputColor, fogColor, fogFactor);
  },
);
