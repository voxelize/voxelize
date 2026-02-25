import {
  add,
  clamp,
  div,
  float,
  int,
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

const sampleShadowCompare = ({
  shadowMap,
  uv,
  depth,
}: {
  shadowMap: TextureInput;
  uv: TslNode;
  depth: TslNode;
}) => {
  return texture(shadowMap, uv).compare(depth);
};

const projectShadowCoordinate = ({
  shadowCoord,
  bias,
  flipY,
  useDirectDepth,
}: {
  shadowCoord: TslNode;
  bias: TslNode;
  flipY: TslNode;
  useDirectDepth: TslNode;
}) => {
  const invW = div(1.0, shadowCoord.w);
  const projected = mul(shadowCoord.xyz, invW);
  const uvX = mul(projected.x, 0.5).add(0.5);
  const uvYRaw = mul(projected.y, 0.5).add(0.5);
  const uvYFlipped = sub(1.0, uvYRaw);
  const uvY = mix(uvYRaw, uvYFlipped, step(0.5, flipY));
  const uv = vec2(uvX, uvY);
  const legacyDepth = mul(projected.z, 0.5).add(0.5);
  const directDepth = projected.z;
  const depth = sub(
    mix(legacyDepth, directDepth, step(0.5, useDirectDepth)),
    bias,
  );

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
  flipY,
  useDirectDepth,
}: {
  shadowMap: TextureInput;
  shadowCoord: TslNode;
  bias: TslNode;
  flipY: TslNode;
  useDirectDepth: TslNode;
}) => {
  const { uv, depth, inside } = projectShadowCoordinate({
    shadowCoord,
    bias,
    flipY,
    useDirectDepth,
  });
  const mapSize = textureSize(texture(shadowMap), int(0));
  const texelSize = div(vec2(1.0, 1.0), vec2(mapSize));

  const litCenter = sampleShadowCompare({
    shadowMap,
    uv,
    depth,
  });
  const lit00 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(mul(texelSize, vec2(-1.0, -1.0))),
    depth,
  });
  const lit10 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(mul(texelSize, vec2(1.0, -1.0))),
    depth,
  });
  const lit01 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(mul(texelSize, vec2(-1.0, 1.0))),
    depth,
  });
  const lit11 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(mul(texelSize, vec2(1.0, 1.0))),
    depth,
  });

  const litSum = add(add(add(add(litCenter, lit00), lit10), lit01), lit11);
  const pcf = div(litSum, 5.0);

  return mix(1.0, pcf, inside);
};

const sampleShadowPCSS = ({
  shadowMap,
  shadowCoord,
  bias,
  flipY,
  useDirectDepth,
}: {
  shadowMap: TextureInput;
  shadowCoord: TslNode;
  bias: TslNode;
  flipY: TslNode;
  useDirectDepth: TslNode;
}) => {
  const { uv, depth, inside } = projectShadowCoordinate({
    shadowCoord,
    bias,
    flipY,
    useDirectDepth,
  });
  const mapSize = textureSize(texture(shadowMap), int(0));
  const texelSize = div(vec2(1.0, 1.0), vec2(mapSize));
  const filterRadius = 2.0;

  const litCenter = sampleShadowCompare({
    shadowMap,
    uv,
    depth,
  });
  const lit0 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(
      mul(mul(texelSize, vec2(-0.94201624, -0.39906216)), filterRadius),
    ),
    depth,
  });
  const lit1 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(
      mul(mul(texelSize, vec2(0.94558609, -0.76890725)), filterRadius),
    ),
    depth,
  });
  const lit2 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(mul(mul(texelSize, vec2(-0.0941841, -0.9293887)), filterRadius)),
    depth,
  });
  const lit3 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(mul(mul(texelSize, vec2(0.34495938, 0.2938776)), filterRadius)),
    depth,
  });
  const lit4 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(
      mul(mul(texelSize, vec2(-0.91588581, 0.45771432)), filterRadius),
    ),
    depth,
  });
  const lit5 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(
      mul(mul(texelSize, vec2(-0.81544232, -0.87912464)), filterRadius),
    ),
    depth,
  });
  const lit6 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(mul(mul(texelSize, vec2(0.97484398, 0.75648379)), filterRadius)),
    depth,
  });
  const lit7 = sampleShadowCompare({
    shadowMap,
    uv: uv.add(
      mul(mul(texelSize, vec2(0.44323325, -0.97511554)), filterRadius),
    ),
    depth,
  });

  const litSum = add(
    add(add(add(litCenter, lit0), add(lit1, lit2)), add(lit3, lit4)),
    add(lit5, add(lit6, lit7)),
  );
  const pcf = div(litSum, 9.0);

  return mix(1.0, pcf, inside);
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
  flipY: TslNode;
  useDirectDepth: TslNode;
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
  flipY,
  useDirectDepth,
}: CascadeShadowParams) => {
  const c0 = sampleShadowPCSS({
    shadowMap: shadowMap0,
    shadowCoord: shadowCoord0,
    bias: baseBias,
    flipY,
    useDirectDepth,
  });
  const c1 = sampleShadowPCSS({
    shadowMap: shadowMap1,
    shadowCoord: shadowCoord1,
    bias: mul(baseBias, 1.5),
    flipY,
    useDirectDepth,
  });
  const c2 = sampleShadowFast({
    shadowMap: shadowMap2,
    shadowCoord: shadowCoord2,
    bias: mul(baseBias, 2.0),
    flipY,
    useDirectDepth,
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
