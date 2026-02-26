import {
  Fn,
  and,
  array,
  clamp,
  cos,
  dot,
  float,
  fract,
  mat2,
  max,
  mix,
  or,
  select,
  sin,
  smoothstep,
  step,
  texture,
  vec2,
} from "three/tsl";
import type { Node, ShaderNodeObject } from "three/tsl";

const POISSON_DISK = array([
  vec2(-0.94201624, -0.39906216),
  vec2(0.94558609, -0.76890725),
  vec2(-0.094184101, -0.9293887),
  vec2(0.34495938, 0.2938776),
  vec2(-0.91588581, 0.45771432),
  vec2(-0.81544232, -0.87912464),
  vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554),
]);

export const shadowEdgeFadeFn = Fn(({ coord }) => {
  const fadeWidth = float(0.08);
  const fx = smoothstep(0.0, fadeWidth, coord.x).mul(
    smoothstep(0.0, fadeWidth, float(1.0).sub(coord.x)),
  );
  const fy = smoothstep(0.0, fadeWidth, coord.y).mul(
    smoothstep(0.0, fadeWidth, float(1.0).sub(coord.y)),
  );

  return fx.mul(fy);
}).setLayout({
  name: "shadowMapEdgeFade",
  type: "float",
  inputs: [{ name: "coord", type: "vec3" }],
});

type ShadowMapNode = ShaderNodeObject<Node> & {
  sample?: (uvNode: ShaderNodeObject<Node>) => ShaderNodeObject<Node>;
};

const SHADOW_TEXEL_SIZE = vec2(1.0 / 4096.0);

const sampleShadowDepth = (
  shadowMap: ShadowMapNode,
  uvNode: ShaderNodeObject<Node>,
) =>
  shadowMap.sample ? shadowMap.sample(uvNode).r : texture(shadowMap, uvNode).r;

const shadowCompare = (
  receiverDepth: ShaderNodeObject<Node>,
  sampleDepth: ShaderNodeObject<Node>,
) => select(receiverDepth.greaterThan(sampleDepth), float(0.0), float(1.0));

export function sampleShadowFast({
  shadowMap,
  shadowCoord,
  slopeBias,
  shadowBias,
}) {
  const coord = shadowCoord.xyz.div(shadowCoord.w).mul(0.5).add(0.5);

  const outOfBounds = or(
    coord.x.lessThan(0.0),
    coord.x.greaterThan(1.0),
    coord.y.lessThan(0.0),
    coord.y.greaterThan(1.0),
    coord.z.lessThan(0.0),
    coord.z.greaterThan(1.0),
  );

  const bias = shadowBias.add(slopeBias);
  const zMinusBias = coord.z.sub(bias);
  const texelSize = SHADOW_TEXEL_SIZE;

  const centerShadow = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy),
  );
  const tap00 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-1.0, -1.0)))),
  );
  const tap10 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(1.0, -1.0)))),
  );
  const tap01 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-1.0, 1.0)))),
  );
  const tap11 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(1.0, 1.0)))),
  );

  const shadow = centerShadow
    .add(tap00)
    .add(tap10)
    .add(tap01)
    .add(tap11)
    .div(5.0);
  const fadedShadow = mix(1.0, shadow, shadowEdgeFadeFn({ coord }));

  return select(outOfBounds, float(1.0), fadedShadow);
}

export function sampleShadowPCF({
  shadowMap,
  shadowCoord,
  slopeBias,
  shadowBias,
}) {
  const coord = shadowCoord.xyz.div(shadowCoord.w).mul(0.5).add(0.5);

  const outOfBounds = or(
    coord.x.lessThan(0.0),
    coord.x.greaterThan(1.0),
    coord.y.lessThan(0.0),
    coord.y.greaterThan(1.0),
    coord.z.lessThan(0.0),
    coord.z.greaterThan(1.0),
  );

  const bias = shadowBias.add(slopeBias);
  const texelSize = SHADOW_TEXEL_SIZE;
  const zMinusBias = coord.z.sub(bias);

  const w22 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-2.0, -2.0)))),
  ).mul(1.0);
  const w12 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-1.0, -2.0)))),
  ).mul(2.0);
  const w02 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(0.0, -2.0)))),
  ).mul(3.0);
  const w_12 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(1.0, -2.0)))),
  ).mul(2.0);
  const w_22 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(2.0, -2.0)))),
  ).mul(1.0);

  const w21 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-2.0, -1.0)))),
  ).mul(2.0);
  const w11 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-1.0, -1.0)))),
  ).mul(4.0);
  const w01 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(0.0, -1.0)))),
  ).mul(6.0);
  const w_11 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(1.0, -1.0)))),
  ).mul(4.0);
  const w_21 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(2.0, -1.0)))),
  ).mul(2.0);

  const w20 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-2.0, 0.0)))),
  ).mul(3.0);
  const w10 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-1.0, 0.0)))),
  ).mul(6.0);
  const w00 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy),
  ).mul(9.0);
  const w_10 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(1.0, 0.0)))),
  ).mul(6.0);
  const w_20 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(2.0, 0.0)))),
  ).mul(3.0);

  const w2_1 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-2.0, 1.0)))),
  ).mul(2.0);
  const w1_1 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-1.0, 1.0)))),
  ).mul(4.0);
  const w0_1 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(0.0, 1.0)))),
  ).mul(6.0);
  const w_1_1 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(1.0, 1.0)))),
  ).mul(4.0);
  const w_2_1 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(2.0, 1.0)))),
  ).mul(2.0);

  const w2_2 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-2.0, 2.0)))),
  ).mul(1.0);
  const w1_2 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(-1.0, 2.0)))),
  ).mul(2.0);
  const w0_2 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(0.0, 2.0)))),
  ).mul(3.0);
  const w_1_2 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(1.0, 2.0)))),
  ).mul(2.0);
  const w_2_2 = shadowCompare(
    zMinusBias,
    sampleShadowDepth(shadowMap, coord.xy.add(texelSize.mul(vec2(2.0, 2.0)))),
  ).mul(1.0);

  const weightedShadow = w22
    .add(w12)
    .add(w02)
    .add(w_12)
    .add(w_22)
    .add(w21)
    .add(w11)
    .add(w01)
    .add(w_11)
    .add(w_21)
    .add(w20)
    .add(w10)
    .add(w00)
    .add(w_10)
    .add(w_20)
    .add(w2_1)
    .add(w1_1)
    .add(w0_1)
    .add(w_1_1)
    .add(w_2_1)
    .add(w2_2)
    .add(w1_2)
    .add(w0_2)
    .add(w_1_2)
    .add(w_2_2);
  const shadow = weightedShadow.div(81.0);
  const fadedShadow = mix(1.0, shadow, shadowEdgeFadeFn({ coord }));

  return select(outOfBounds, float(1.0), fadedShadow);
}

export function sampleShadowPCSS({
  shadowMap,
  shadowCoord,
  bias,
  minOccluderDepth,
}) {
  const coord = shadowCoord.xyz.div(shadowCoord.w).mul(0.5).add(0.5);

  const outOfBounds = or(
    coord.x.lessThan(0.0),
    coord.x.greaterThan(1.0),
    coord.y.lessThan(0.0),
    coord.y.greaterThan(1.0),
    coord.z.lessThan(0.0),
    coord.z.greaterThan(1.0),
  );

  const texelSize = SHADOW_TEXEL_SIZE;
  const searchRadius = float(3.0);

  const blockerOffset0 = POISSON_DISK.element(0)
    .mul(texelSize)
    .mul(searchRadius);
  const blockerOffset1 = POISSON_DISK.element(2)
    .mul(texelSize)
    .mul(searchRadius);
  const blockerOffset2 = POISSON_DISK.element(4)
    .mul(texelSize)
    .mul(searchRadius);
  const blockerOffset3 = POISSON_DISK.element(6)
    .mul(texelSize)
    .mul(searchRadius);

  const blockerDepth0 = sampleShadowDepth(
    shadowMap,
    coord.xy.add(blockerOffset0),
  );
  const blockerDepth1 = sampleShadowDepth(
    shadowMap,
    coord.xy.add(blockerOffset1),
  );
  const blockerDepth2 = sampleShadowDepth(
    shadowMap,
    coord.xy.add(blockerOffset2),
  );
  const blockerDepth3 = sampleShadowDepth(
    shadowMap,
    coord.xy.add(blockerOffset3),
  );

  const blockerDiff0 = coord.z.sub(blockerDepth0);
  const blockerDiff1 = coord.z.sub(blockerDepth1);
  const blockerDiff2 = coord.z.sub(blockerDepth2);
  const blockerDiff3 = coord.z.sub(blockerDepth3);

  const blockerHit0 = select(
    and(
      blockerDiff0.greaterThan(bias),
      blockerDiff0.greaterThanEqual(minOccluderDepth),
    ),
    float(1.0),
    float(0.0),
  );
  const blockerHit1 = select(
    and(
      blockerDiff1.greaterThan(bias),
      blockerDiff1.greaterThanEqual(minOccluderDepth),
    ),
    float(1.0),
    float(0.0),
  );
  const blockerHit2 = select(
    and(
      blockerDiff2.greaterThan(bias),
      blockerDiff2.greaterThanEqual(minOccluderDepth),
    ),
    float(1.0),
    float(0.0),
  );
  const blockerHit3 = select(
    and(
      blockerDiff3.greaterThan(bias),
      blockerDiff3.greaterThanEqual(minOccluderDepth),
    ),
    float(1.0),
    float(0.0),
  );

  const blockerSum = blockerDepth0
    .mul(blockerHit0)
    .add(blockerDepth1.mul(blockerHit1))
    .add(blockerDepth2.mul(blockerHit2))
    .add(blockerDepth3.mul(blockerHit3));
  const blockerCount = blockerHit0
    .add(blockerHit1)
    .add(blockerHit2)
    .add(blockerHit3);
  const noBlockers = blockerCount.lessThan(0.5);

  const safeBlockerCount = max(blockerCount, float(0.0001));
  const avgBlockerDepth = blockerSum.div(safeBlockerCount);
  const safeAvgBlockerDepth = max(avgBlockerDepth, float(0.0001));
  const penumbraSize = coord.z.sub(avgBlockerDepth).div(safeAvgBlockerDepth);
  const filterRadius = clamp(penumbraSize.mul(2.0), 1.0, 3.0);

  const spatialNoise = fract(
    sin(dot(coord.xy, vec2(12.9898, 78.233))).mul(43758.5453),
  );
  const angle = spatialNoise.mul(6.283185);
  const s = sin(angle);
  const c = cos(angle);
  const rotation = mat2(c, s.mul(-1.0), s, c);

  const centerDepth = sampleShadowDepth(shadowMap, coord.xy);
  const centerDiff = coord.z.sub(centerDepth);
  const centerShadow = select(
    and(
      centerDiff.greaterThan(bias),
      centerDiff.greaterThanEqual(minOccluderDepth),
    ),
    float(0.0),
    float(1.0),
  );

  const offset0 = rotation
    .mul(POISSON_DISK.element(0))
    .mul(texelSize)
    .mul(filterRadius);
  const offset1 = rotation
    .mul(POISSON_DISK.element(1))
    .mul(texelSize)
    .mul(filterRadius);
  const offset2 = rotation
    .mul(POISSON_DISK.element(2))
    .mul(texelSize)
    .mul(filterRadius);
  const offset3 = rotation
    .mul(POISSON_DISK.element(3))
    .mul(texelSize)
    .mul(filterRadius);
  const offset4 = rotation
    .mul(POISSON_DISK.element(4))
    .mul(texelSize)
    .mul(filterRadius);
  const offset5 = rotation
    .mul(POISSON_DISK.element(5))
    .mul(texelSize)
    .mul(filterRadius);
  const offset6 = rotation
    .mul(POISSON_DISK.element(6))
    .mul(texelSize)
    .mul(filterRadius);
  const offset7 = rotation
    .mul(POISSON_DISK.element(7))
    .mul(texelSize)
    .mul(filterRadius);

  const depth0 = sampleShadowDepth(shadowMap, coord.xy.add(offset0));
  const depth1 = sampleShadowDepth(shadowMap, coord.xy.add(offset1));
  const depth2 = sampleShadowDepth(shadowMap, coord.xy.add(offset2));
  const depth3 = sampleShadowDepth(shadowMap, coord.xy.add(offset3));
  const depth4 = sampleShadowDepth(shadowMap, coord.xy.add(offset4));
  const depth5 = sampleShadowDepth(shadowMap, coord.xy.add(offset5));
  const depth6 = sampleShadowDepth(shadowMap, coord.xy.add(offset6));
  const depth7 = sampleShadowDepth(shadowMap, coord.xy.add(offset7));

  const diff0 = coord.z.sub(depth0);
  const diff1 = coord.z.sub(depth1);
  const diff2 = coord.z.sub(depth2);
  const diff3 = coord.z.sub(depth3);
  const diff4 = coord.z.sub(depth4);
  const diff5 = coord.z.sub(depth5);
  const diff6 = coord.z.sub(depth6);
  const diff7 = coord.z.sub(depth7);

  const sample0 = select(
    and(diff0.greaterThan(bias), diff0.greaterThanEqual(minOccluderDepth)),
    float(0.0),
    float(1.0),
  );
  const sample1 = select(
    and(diff1.greaterThan(bias), diff1.greaterThanEqual(minOccluderDepth)),
    float(0.0),
    float(1.0),
  );
  const sample2 = select(
    and(diff2.greaterThan(bias), diff2.greaterThanEqual(minOccluderDepth)),
    float(0.0),
    float(1.0),
  );
  const sample3 = select(
    and(diff3.greaterThan(bias), diff3.greaterThanEqual(minOccluderDepth)),
    float(0.0),
    float(1.0),
  );
  const sample4 = select(
    and(diff4.greaterThan(bias), diff4.greaterThanEqual(minOccluderDepth)),
    float(0.0),
    float(1.0),
  );
  const sample5 = select(
    and(diff5.greaterThan(bias), diff5.greaterThanEqual(minOccluderDepth)),
    float(0.0),
    float(1.0),
  );
  const sample6 = select(
    and(diff6.greaterThan(bias), diff6.greaterThanEqual(minOccluderDepth)),
    float(0.0),
    float(1.0),
  );
  const sample7 = select(
    and(diff7.greaterThan(bias), diff7.greaterThanEqual(minOccluderDepth)),
    float(0.0),
    float(1.0),
  );

  const shadow = centerShadow
    .add(sample0)
    .add(sample1)
    .add(sample2)
    .add(sample3)
    .add(sample4)
    .add(sample5)
    .add(sample6)
    .add(sample7)
    .div(9.0);
  const fadedShadow = mix(1.0, shadow, shadowEdgeFadeFn({ coord }));
  const blockerShadow = select(noBlockers, float(1.0), fadedShadow);

  return select(outOfBounds, float(1.0), blockerShadow);
}

export const createChunkShadowNode = ({
  vWorldNormal,
  uSunDirection,
  uShadowStrength,
  vLight,
  vViewDepth,
  uCascadeSplit0,
  uCascadeSplit1,
  uCascadeSplit2,
  uShadowMap0,
  uShadowMap1,
  uShadowMap2,
  vShadowCoord0,
  vShadowCoord1,
  vShadowCoord2,
  uShadowBias,
}) => {
  const ndotl = dot(vWorldNormal, uSunDirection);
  const baseShadow = mix(1.0, 0.0, uShadowStrength);
  const lowStrength = uShadowStrength.lessThan(0.01);
  const lowSunExposure = vLight.a.lessThan(0.05);

  const slopeBias = max(float(0.005).mul(float(1.0).sub(ndotl)), 0.001);
  const blendRegion = float(0.1);

  const shadow0 = sampleShadowPCF({
    shadowMap: uShadowMap0,
    shadowCoord: vShadowCoord0,
    slopeBias,
    shadowBias: uShadowBias,
  });
  const shadow1 = sampleShadowPCF({
    shadowMap: uShadowMap1,
    shadowCoord: vShadowCoord1,
    slopeBias: slopeBias.mul(1.5),
    shadowBias: uShadowBias,
  });
  const shadow2 = sampleShadowFast({
    shadowMap: uShadowMap2,
    shadowCoord: vShadowCoord2,
    slopeBias: slopeBias.mul(2.0),
    shadowBias: uShadowBias,
  });

  const blendStart0 = uCascadeSplit0.mul(float(1.0).sub(blendRegion));
  const blendStart1 = uCascadeSplit1.mul(float(1.0).sub(blendRegion));
  const fadeStart2 = uCascadeSplit2.mul(float(1.0).sub(blendRegion));

  const t01 = step(blendStart0, vViewDepth).mul(
    clamp(
      vViewDepth
        .sub(blendStart0)
        .div(max(uCascadeSplit0.sub(blendStart0), float(0.0001))),
      0.0,
      1.0,
    ),
  );
  const t12 = step(blendStart1, vViewDepth).mul(
    clamp(
      vViewDepth
        .sub(blendStart1)
        .div(max(uCascadeSplit1.sub(blendStart1), float(0.0001))),
      0.0,
      1.0,
    ),
  );
  const t2Fade = step(fadeStart2, vViewDepth).mul(
    clamp(
      vViewDepth
        .sub(fadeStart2)
        .div(max(uCascadeSplit2.sub(fadeStart2), float(0.0001))),
      0.0,
      1.0,
    ),
  );

  const cascade0Shadow = mix(shadow0, shadow1, t01);
  const cascade1Shadow = mix(shadow1, shadow2, t12);
  const cascade2Shadow = mix(shadow2, 1.0, t2Fade);

  const inCascade0 = step(vViewDepth, uCascadeSplit0);
  const inCascade1 = float(1.0)
    .sub(inCascade0)
    .mul(step(vViewDepth, uCascadeSplit1));
  const inCascade2 = float(1.0)
    .sub(inCascade0)
    .sub(inCascade1)
    .mul(step(vViewDepth, uCascadeSplit2));
  const inCascade3 = float(1.0).sub(inCascade0).sub(inCascade1).sub(inCascade2);

  const rawShadow = cascade0Shadow
    .mul(inCascade0)
    .add(cascade1Shadow.mul(inCascade1))
    .add(cascade2Shadow.mul(inCascade2))
    .add(inCascade3);
  const shadowed = mix(1.0, rawShadow, uShadowStrength);

  const activeShadow = select(lowSunExposure, baseShadow, shadowed);
  const withStrengthCheck = select(lowStrength, float(1.0), activeShadow);

  return select(ndotl.lessThanEqual(0.0), baseShadow, withStrengthCheck);
};

export const createEntityShadowNode = ({
  worldNormal,
  uShadowStrength,
  uSunlightIntensity,
  uSunDirection,
  uShadowBias,
  uShadowNormalBias,
  uShadowMap0,
  vShadowCoord0,
  uMinOccluderDepth,
  uCascadeSplit1,
  vViewDepth,
}) => {
  const effectiveStrength = uShadowStrength.mul(uSunlightIntensity);
  const lowStrength = effectiveStrength.lessThan(0.01);

  const cosTheta = clamp(dot(worldNormal, uSunDirection), 0.0, 1.0);
  const bias = uShadowBias.add(uShadowNormalBias.mul(float(1.0).sub(cosTheta)));
  const rawShadow = sampleShadowPCSS({
    shadowMap: uShadowMap0,
    shadowCoord: vShadowCoord0,
    bias,
    minOccluderDepth: uMinOccluderDepth,
  });

  const maxEntityDist = uCascadeSplit1;
  const fadeStart = maxEntityDist.mul(0.7);
  const fadeT = step(fadeStart, vViewDepth).mul(
    clamp(
      vViewDepth
        .sub(fadeStart)
        .div(max(maxEntityDist.sub(fadeStart), float(0.0001))),
      0.0,
      1.0,
    ),
  );
  const fadedShadow = mix(rawShadow, 1.0, fadeT);
  const shaded = max(mix(1.0, fadedShadow, effectiveStrength.mul(0.65)), 0.6);
  const distanceShadow = select(
    vViewDepth.greaterThan(maxEntityDist),
    1.0,
    shaded,
  );

  return select(lowStrength, float(1.0), distanceShadow);
};
