import type { Texture } from "three";
import {
  float,
  vec2,
  vec3,
  texture,
  step,
  smoothstep,
  mix,
  max,
  dot,
} from "three/tsl";

type NodeRef = ReturnType<typeof float>;

function shadowEdgeFade(coord: NodeRef): NodeRef {
  const fw = float(0.08);
  const fx = smoothstep(float(0), fw, coord.x).mul(
    smoothstep(float(0), fw, float(1).sub(coord.x)),
  );
  const fy = smoothstep(float(0), fw, coord.y).mul(
    smoothstep(float(0), fw, float(1).sub(coord.y)),
  );
  return fx.mul(fy);
}

function sampleShadowFast(
  shadowMap: Texture,
  shadowCoord: NodeRef,
  bias: NodeRef,
  texelSize: NodeRef,
): NodeRef {
  const coord = shadowCoord.xyz.div(shadowCoord.w).mul(0.5).add(0.5);

  const inBounds = step(float(0), coord.x)
    .mul(step(coord.x, float(1)))
    .mul(step(float(0), coord.y))
    .mul(step(coord.y, float(1)))
    .mul(step(float(0), coord.z))
    .mul(step(coord.z, float(1)));

  const zBiased = coord.z.sub(bias);

  const compare = (uv: NodeRef): NodeRef =>
    float(1).sub(step(texture(shadowMap, uv).x, zBiased));

  const s0 = compare(coord.xy);
  const s1 = compare(coord.xy.add(texelSize.mul(vec2(-1, -1))));
  const s2 = compare(coord.xy.add(texelSize.mul(vec2(1, -1))));
  const s3 = compare(coord.xy.add(texelSize.mul(vec2(-1, 1))));
  const s4 = compare(coord.xy.add(texelSize.mul(vec2(1, 1))));

  const shadow = s0.add(s1).add(s2).add(s3).add(s4).div(5.0);

  return mix(float(1), mix(float(1), shadow, shadowEdgeFade(coord)), inBounds);
}

interface CascadeShadowParams {
  worldNormal: NodeRef;
  sunDirection: NodeRef;
  sunExposure: NodeRef;
  viewDepth: NodeRef;
  shadowCoords: [NodeRef, NodeRef, NodeRef];
  shadowMaps: [Texture, Texture, Texture];
  cascadeSplits: [NodeRef, NodeRef, NodeRef];
  shadowBias: NodeRef;
  shadowStrength: NodeRef;
  shadowMapSize: number;
}

export function cascadeShadowNode(params: CascadeShadowParams): NodeRef {
  const {
    worldNormal,
    sunDirection,
    sunExposure,
    viewDepth,
    shadowCoords,
    shadowMaps,
    cascadeSplits,
    shadowBias,
    shadowStrength,
    shadowMapSize,
  } = params;

  const texelSize = vec2(1.0 / shadowMapSize, 1.0 / shadowMapSize);

  const NdotL = dot(worldNormal, sunDirection);
  const slopeBias = max(float(0.005).mul(float(1).sub(NdotL)), float(0.001));

  const shadow0 = sampleShadowFast(
    shadowMaps[0],
    shadowCoords[0],
    shadowBias.add(slopeBias),
    texelSize,
  );
  const shadow1 = sampleShadowFast(
    shadowMaps[1],
    shadowCoords[1],
    shadowBias.add(slopeBias.mul(1.5)),
    texelSize,
  );
  const shadow2 = sampleShadowFast(
    shadowMaps[2],
    shadowCoords[2],
    shadowBias.add(slopeBias.mul(2.0)),
    texelSize,
  );

  const inC0 = step(viewDepth, cascadeSplits[0]);
  const inC1 = step(viewDepth, cascadeSplits[1]).mul(float(1).sub(inC0));
  const inC2 = step(viewDepth, cascadeSplits[2])
    .mul(float(1).sub(inC0))
    .mul(float(1).sub(inC1));

  const rawShadow = shadow0
    .mul(inC0)
    .add(shadow1.mul(inC1))
    .add(shadow2.mul(inC2))
    .add(float(1).sub(inC0).sub(inC1).sub(inC2));

  const computedShadow = mix(float(1), rawShadow, shadowStrength);

  const facingSun = step(float(0.001), NdotL);
  const hasSunlight = step(float(0.05), sunExposure);
  const hasStrength = step(float(0.01), shadowStrength);

  const fullShadow = float(1).sub(shadowStrength);

  return mix(
    fullShadow,
    computedShadow,
    facingSun.mul(hasSunlight).mul(hasStrength),
  );
}
