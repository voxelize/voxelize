import { Fn, float, vec2, abs, fract, floor, step, mix } from "three/tsl";

export const greedyUVNode = /* @__PURE__ */ Fn(
  ([mapUv, worldPosition, worldNormal, atlasSize, isGreedy]: [
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
  ]) => {
    const absNormal = abs(worldNormal);
    const isYDom = step(float(0.5), absNormal.y);
    const isXDom = step(float(0.5), absNormal.x).mul(float(1.0).sub(isYDom));
    const isZDom = float(1.0).sub(isYDom).sub(isXDom);

    const ySign = step(float(0), worldNormal.y);
    const yUv = mix(
      vec2(fract(worldPosition.x), float(1).sub(fract(worldPosition.z))),
      vec2(float(1).sub(fract(worldPosition.x)), fract(worldPosition.z)),
      ySign,
    );

    const xSign = step(float(0), worldNormal.x);
    const xUv = mix(
      vec2(fract(worldPosition.z), fract(worldPosition.y)),
      vec2(float(1).sub(fract(worldPosition.z)), fract(worldPosition.y)),
      xSign,
    );

    const zSign = step(float(0), worldNormal.z);
    const zUv = mix(
      vec2(fract(worldPosition.x), fract(worldPosition.y)),
      vec2(float(1).sub(fract(worldPosition.x)), fract(worldPosition.y)),
      zSign,
    );

    const localUv = yUv.mul(isYDom).add(xUv.mul(isXDom)).add(zUv.mul(isZDom));

    const cellSize = float(1).div(atlasSize);
    const padding = cellSize.div(4.0);
    const cellMin = floor(mapUv.div(cellSize)).mul(cellSize);
    const innerMin = cellMin.add(padding);
    const innerSize = cellSize.sub(padding.mul(2.0));
    const greedyResult = innerMin.add(localUv.mul(innerSize));

    return mix(mapUv, greedyResult, isGreedy);
  },
);
