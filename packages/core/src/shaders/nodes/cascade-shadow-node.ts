import {
  add,
  clamp,
  div,
  float,
  int,
  max,
  mix,
  mul,
  step,
  sub,
  texture,
  textureSize,
  vec2,
} from "three/tsl";

type TslNode = ReturnType<typeof float>;
type TextureInput = Parameters<typeof texture>[0];

const projectShadowCoordinate = ({
  shadowCoord,
  bias,
}: {
  shadowCoord: TslNode;
  bias: TslNode;
}) => {
  const invW = div(1.0, shadowCoord.w);
  const projected = mul(shadowCoord.xyz, invW);
  const uv = mul(projected.xy, 0.5).add(0.5);
  const depth = sub(mul(projected.z, 0.5).add(0.5), bias);

  const insideX = mul(step(0.0, uv.x), step(uv.x, 1.0));
  const insideY = mul(step(0.0, uv.y), step(uv.y, 1.0));
  const insideZ = mul(step(0.0, depth), step(depth, 1.0));
  const inside = mul(mul(insideX, insideY), insideZ);

  return { uv, depth, inside };
};

const sampleShadowFast = ({
  shadowMap,
  shadowCoord,
  bias,
}: {
  shadowMap: TextureInput;
  shadowCoord: TslNode;
  bias: TslNode;
}) => {
  const { uv, depth, inside } = projectShadowCoordinate({ shadowCoord, bias });
  const mapSize = textureSize(texture(shadowMap), int(0));
  const texelSize = div(vec2(1.0, 1.0), vec2(mapSize));

  const litCenter = step(depth, texture(shadowMap, uv).r);
  const lit00 = step(
    depth,
    texture(shadowMap, uv.add(mul(texelSize, vec2(-1.0, -1.0)))).r,
  );
  const lit10 = step(
    depth,
    texture(shadowMap, uv.add(mul(texelSize, vec2(1.0, -1.0)))).r,
  );
  const lit01 = step(
    depth,
    texture(shadowMap, uv.add(mul(texelSize, vec2(-1.0, 1.0)))).r,
  );
  const lit11 = step(
    depth,
    texture(shadowMap, uv.add(mul(texelSize, vec2(1.0, 1.0)))).r,
  );

  const litSum = add(add(add(add(litCenter, lit00), lit10), lit01), lit11);
  const pcf = div(litSum, 5.0);

  return mix(1.0, pcf, inside);
};

const sampleShadowPCSS = ({
  shadowMap,
  shadowCoord,
  bias,
}: {
  shadowMap: TextureInput;
  shadowCoord: TslNode;
  bias: TslNode;
}) => {
  const { uv, depth, inside } = projectShadowCoordinate({ shadowCoord, bias });
  const mapSize = textureSize(texture(shadowMap), int(0));
  const texelSize = div(vec2(1.0, 1.0), vec2(mapSize));
  const searchRadius = 3.0;

  const bSample0 = texture(
    shadowMap,
    uv.add(mul(mul(texelSize, vec2(-0.94201624, -0.39906216)), searchRadius)),
  ).r;
  const bSample1 = texture(
    shadowMap,
    uv.add(mul(mul(texelSize, vec2(0.94558609, -0.76890725)), searchRadius)),
  ).r;
  const bSample2 = texture(
    shadowMap,
    uv.add(mul(mul(texelSize, vec2(-0.0941841, -0.9293887)), searchRadius)),
  ).r;
  const bSample3 = texture(
    shadowMap,
    uv.add(mul(mul(texelSize, vec2(0.34495938, 0.2938776)), searchRadius)),
  ).r;

  const blocker0 = step(bias, sub(depth, bSample0));
  const blocker1 = step(bias, sub(depth, bSample1));
  const blocker2 = step(bias, sub(depth, bSample2));
  const blocker3 = step(bias, sub(depth, bSample3));
  const blockerCount = add(add(blocker0, blocker1), add(blocker2, blocker3));
  const blockerDepthSum = add(
    add(mul(bSample0, blocker0), mul(bSample1, blocker1)),
    add(mul(bSample2, blocker2), mul(bSample3, blocker3)),
  );
  const avgBlockerDepth = div(blockerDepthSum, max(blockerCount, 1.0));
  const penumbraSize = div(
    sub(depth, avgBlockerDepth),
    max(avgBlockerDepth, 0.0001),
  );
  const filterRadius = clamp(mul(penumbraSize, 2.0), 1.0, 3.0);
  const hasBlocker = step(0.5, blockerCount);

  const litCenter = step(depth, texture(shadowMap, uv).r);
  const lit0 = step(
    depth,
    texture(
      shadowMap,
      uv.add(mul(mul(texelSize, vec2(-0.94201624, -0.39906216)), filterRadius)),
    ).r,
  );
  const lit1 = step(
    depth,
    texture(
      shadowMap,
      uv.add(mul(mul(texelSize, vec2(0.94558609, -0.76890725)), filterRadius)),
    ).r,
  );
  const lit2 = step(
    depth,
    texture(
      shadowMap,
      uv.add(mul(mul(texelSize, vec2(-0.0941841, -0.9293887)), filterRadius)),
    ).r,
  );
  const lit3 = step(
    depth,
    texture(
      shadowMap,
      uv.add(mul(mul(texelSize, vec2(0.34495938, 0.2938776)), filterRadius)),
    ).r,
  );
  const lit4 = step(
    depth,
    texture(
      shadowMap,
      uv.add(mul(mul(texelSize, vec2(-0.91588581, 0.45771432)), filterRadius)),
    ).r,
  );
  const lit5 = step(
    depth,
    texture(
      shadowMap,
      uv.add(mul(mul(texelSize, vec2(-0.81544232, -0.87912464)), filterRadius)),
    ).r,
  );
  const lit6 = step(
    depth,
    texture(
      shadowMap,
      uv.add(mul(mul(texelSize, vec2(0.97484398, 0.75648379)), filterRadius)),
    ).r,
  );
  const lit7 = step(
    depth,
    texture(
      shadowMap,
      uv.add(mul(mul(texelSize, vec2(0.44323325, -0.97511554)), filterRadius)),
    ).r,
  );

  const litSum = add(
    add(add(add(litCenter, lit0), add(lit1, lit2)), add(lit3, lit4)),
    add(lit5, add(lit6, lit7)),
  );
  const pcf = div(litSum, 9.0);
  const pcss = mix(1.0, pcf, hasBlocker);

  return mix(1.0, pcss, inside);
};

export type CascadeShadowParams = {
  viewDepth: TslNode;
  shadowCoord0: TslNode;
  shadowCoord1: TslNode;
  shadowCoord2: TslNode;
  shadowMap0: TextureInput;
  shadowMap1: TextureInput;
  shadowMap2: TextureInput;
  cascadeSplit0: TslNode;
  cascadeSplit1: TslNode;
  cascadeSplit2: TslNode;
  baseBias: TslNode;
  shadowStrength: TslNode;
};

export const cascadeShadowNode = ({
  viewDepth,
  shadowCoord0,
  shadowCoord1,
  shadowCoord2,
  shadowMap0,
  shadowMap1,
  shadowMap2,
  cascadeSplit0,
  cascadeSplit1,
  cascadeSplit2,
  baseBias,
  shadowStrength,
}: CascadeShadowParams) => {
  const c0 = sampleShadowPCSS({
    shadowMap: shadowMap0,
    shadowCoord: shadowCoord0,
    bias: baseBias,
  });
  const c1 = sampleShadowPCSS({
    shadowMap: shadowMap1,
    shadowCoord: shadowCoord1,
    bias: mul(baseBias, 1.5),
  });
  const c2 = sampleShadowFast({
    shadowMap: shadowMap2,
    shadowCoord: shadowCoord2,
    bias: mul(baseBias, 2.0),
  });

  const blendRegion = 0.1;
  const t0 = clamp(
    div(
      sub(viewDepth, mul(cascadeSplit0, 1.0 - blendRegion)),
      mul(cascadeSplit0, blendRegion),
    ),
    0.0,
    1.0,
  );
  const t1 = clamp(
    div(
      sub(viewDepth, mul(cascadeSplit1, 1.0 - blendRegion)),
      mul(cascadeSplit1, blendRegion),
    ),
    0.0,
    1.0,
  );

  const nearMix = mix(c0, c1, t0);
  const midMix = mix(c1, c2, t1);
  const blend01 = step(cascadeSplit0, viewDepth);
  const blend12 = step(cascadeSplit1, viewDepth);
  const cascaded = mix(nearMix, midMix, blend01);
  const raw = mix(cascaded, c2, blend12);
  const farFade = clamp(
    div(sub(cascadeSplit2, viewDepth), mul(cascadeSplit2, 0.2)),
    0.0,
    1.0,
  );
  const fadedShadow = mix(1.0, raw, farFade);

  return mix(1.0, fadedShadow, shadowStrength);
};
