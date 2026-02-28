import { Fn, float, max, pow, mix, normalize } from "three/tsl";

export const skyColorNode = /* @__PURE__ */ Fn(
  ([
    worldPosition,
    topColor,
    middleColor,
    bottomColor,
    skyOffset,
    voidOffset,
    exponent,
    exponent2,
  ]: [
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
    ReturnType<typeof float>,
  ]) => {
    const h = normalize(worldPosition.add(skyOffset)).y;
    const h2 = normalize(worldPosition.add(voidOffset)).y;

    const skyColor = mix(
      middleColor,
      topColor,
      max(pow(max(h, 0.0), exponent), 0.0),
    );
    return mix(
      skyColor,
      bottomColor,
      max(pow(max(h2.negate(), 0.0), exponent2), 0.0),
    );
  },
);
