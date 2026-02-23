import {
  add,
  cubeTexture,
  cross,
  div,
  dot,
  float,
  length,
  max,
  mix,
  mul,
  normalize,
  step,
  sub,
  vec3,
  vec4,
} from "three/tsl";

type TslNode = ReturnType<typeof float>;
type CubeTextureInput = Parameters<typeof cubeTexture>[0];

const unpackDepth = (depthSample: TslNode) => {
  return dot(
    depthSample,
    vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0),
  );
};

const samplePointShadow = ({
  shadowMap,
  direction,
  biasedDistance,
  shadowFar,
}: {
  shadowMap: CubeTextureInput;
  direction: TslNode;
  biasedDistance: TslNode;
  shadowFar: TslNode;
}) => {
  const depthSample = cubeTexture(shadowMap, direction);
  const closestDepth = mul(unpackDepth(depthSample), shadowFar);
  return step(biasedDistance, closestDepth);
};

export type PointLightShadowParams = {
  shadowMap: CubeTextureInput;
  lightToFragment: TslNode;
  lightDistance: TslNode;
  shadowFar: TslNode;
  shadowBias: TslNode;
  shadowStrength: TslNode;
};

export const pointLightShadowNode = ({
  shadowMap,
  lightToFragment,
  lightDistance,
  shadowFar,
  shadowBias,
  shadowStrength,
}: PointLightShadowParams) => {
  const direction = normalize(lightToFragment);
  const tangent = normalize(cross(direction, vec3(0.0, 1.0, 0.0)));
  const tangentFallback = normalize(cross(direction, vec3(1.0, 0.0, 0.0)));
  const useFallback = step(length(tangent), 0.001);
  const safeTangent = mix(tangent, tangentFallback, useFallback);
  const bitangent = cross(direction, safeTangent);
  const diskRadius = mul(0.02, div(lightDistance, max(shadowFar, 0.0001)));
  const scaledBias = mul(shadowBias, add(1.0, mul(lightDistance, 0.1)));
  const biasedDistance = sub(lightDistance, scaledBias);

  const litCenter = samplePointShadow({
    shadowMap,
    direction,
    biasedDistance,
    shadowFar,
  });
  const litPlusTangent = samplePointShadow({
    shadowMap,
    direction: normalize(add(direction, mul(safeTangent, diskRadius))),
    biasedDistance,
    shadowFar,
  });
  const litMinusTangent = samplePointShadow({
    shadowMap,
    direction: normalize(sub(direction, mul(safeTangent, diskRadius))),
    biasedDistance,
    shadowFar,
  });
  const litPlusBitangent = samplePointShadow({
    shadowMap,
    direction: normalize(add(direction, mul(bitangent, diskRadius))),
    biasedDistance,
    shadowFar,
  });
  const litMinusBitangent = samplePointShadow({
    shadowMap,
    direction: normalize(sub(direction, mul(bitangent, diskRadius))),
    biasedDistance,
    shadowFar,
  });

  const litSum = add(
    add(litCenter, litPlusTangent),
    add(litMinusTangent, add(litPlusBitangent, litMinusBitangent)),
  );
  const softShadow = div(litSum, 5.0);
  const withinRange = step(lightDistance, shadowFar);
  const shadowFactor = mix(1.0, softShadow, withinRange);

  return mix(1.0, shadowFactor, shadowStrength);
};
