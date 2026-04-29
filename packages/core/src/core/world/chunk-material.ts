import { FrontSide, IntType, Matrix4, Texture } from "three";
import {
  abs,
  add,
  attribute,
  bitAnd,
  cameraPosition,
  clamp,
  div,
  dot,
  exp,
  float,
  floor,
  fract,
  greaterThan,
  int,
  lessThan,
  length,
  max,
  mix,
  mul,
  normalWorld,
  normalize,
  positionView,
  positionWorld,
  pow,
  select,
  shiftRight,
  smoothstep,
  step,
  sub,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

import type { ChunkRenderer } from "./chunk-renderer";

export type ChunkShadowTextureTuple = readonly [Texture, Texture, Texture];
export type ChunkShadowMatrixTuple = readonly [Matrix4, Matrix4, Matrix4];
export type ChunkShadowSplitTuple = readonly [number, number, number];
export type ChunkShadowMapSizeTuple = readonly [number, number, number];

export interface ChunkShadowInputs {
  shadowMaps: ChunkShadowTextureTuple;
  shadowMatrices: ChunkShadowMatrixTuple;
  cascadeSplits: ChunkShadowSplitTuple;
  shadowMapSizes: ChunkShadowMapSizeTuple;
  shadowBias: number;
  shadowStrength: number;
}

function buildShadowTslUniforms(inputs: ChunkShadowInputs) {
  return {
    matrices: [
      uniform(inputs.shadowMatrices[0].clone()),
      uniform(inputs.shadowMatrices[1].clone()),
      uniform(inputs.shadowMatrices[2].clone()),
    ] as const,
    splits: [
      uniform(inputs.cascadeSplits[0]),
      uniform(inputs.cascadeSplits[1]),
      uniform(inputs.cascadeSplits[2]),
    ] as const,
    mapSizes: [
      uniform(inputs.shadowMapSizes[0]),
      uniform(inputs.shadowMapSizes[1]),
      uniform(inputs.shadowMapSizes[2]),
    ] as const,
    bias: uniform(inputs.shadowBias),
    strength: uniform(inputs.shadowStrength),
  };
}

type SharedShadowUniforms = ReturnType<typeof buildShadowTslUniforms>;

function buildSharedTslUniforms(renderer: ChunkRenderer) {
  const u = renderer.uniforms;
  return {
    atlasSize: uniform(u.atlasSize.value),
    aoTable: uniform(u.ao.value.clone()),
    sunlightIntensity: uniform(u.sunlightIntensity.value),
    minLightLevel: uniform(u.minLightLevel.value),
    baseAmbient: uniform(u.baseAmbient.value),
    lightIntensityAdjustment: uniform(u.lightIntensityAdjustment.value),
    sunColor: uniform(u.sunColor.value.clone()),
    ambientColor: uniform(u.ambientColor.value.clone()),
    fogColor: uniform(u.fogColor.value.clone()),
    fogNear: uniform(u.fogNear.value),
    fogFar: uniform(u.fogFar.value),
    fogHeightOrigin: uniform(u.fogHeightOrigin.value),
    fogHeightDensity: uniform(u.fogHeightDensity.value),
    skyFogTopColor: uniform(u.skyFogTopColor.value.clone()),
    skyFogMiddleColor: uniform(u.skyFogMiddleColor.value.clone()),
    skyFogBottomColor: uniform(u.skyFogBottomColor.value.clone()),
    skyFogOffset: uniform(u.skyFogOffset.value),
    skyFogVoidOffset: uniform(u.skyFogVoidOffset.value),
    skyFogExponent: uniform(u.skyFogExponent.value),
    skyFogExponent2: uniform(u.skyFogExponent2.value),
    skyFogDimension: uniform(u.skyFogDimension.value),
    skyFogStrength: uniform(u.skyFogStrength.value),
  };
}

type SharedChunkTslUniforms = ReturnType<typeof buildSharedTslUniforms>;

const sharedByRenderer = new WeakMap<ChunkRenderer, SharedChunkTslUniforms>();
const shadowByRenderer = new WeakMap<ChunkRenderer, SharedShadowUniforms>();

function getOrCreateShared(renderer: ChunkRenderer): SharedChunkTslUniforms {
  const existing = sharedByRenderer.get(renderer);
  if (existing) return existing;
  const shared = buildSharedTslUniforms(renderer);
  sharedByRenderer.set(renderer, shared);
  return shared;
}

function getOrCreateShadow(
  renderer: ChunkRenderer,
  inputs: ChunkShadowInputs,
): SharedShadowUniforms {
  const existing = shadowByRenderer.get(renderer);
  if (existing) return existing;
  const created = buildShadowTslUniforms(inputs);
  shadowByRenderer.set(renderer, created);
  return created;
}

export function syncChunkSharedTslUniforms(renderer: ChunkRenderer): void {
  const shared = sharedByRenderer.get(renderer);
  if (shared) {
    const u = renderer.uniforms;
    shared.atlasSize.value = u.atlasSize.value;
    shared.aoTable.value.copy(u.ao.value);
    shared.sunlightIntensity.value = u.sunlightIntensity.value;
    shared.minLightLevel.value = u.minLightLevel.value;
    shared.baseAmbient.value = u.baseAmbient.value;
    shared.lightIntensityAdjustment.value = u.lightIntensityAdjustment.value;
    shared.sunColor.value.copy(u.sunColor.value);
    shared.ambientColor.value.copy(u.ambientColor.value);
    shared.fogColor.value.copy(u.fogColor.value);
    shared.fogNear.value = u.fogNear.value;
    shared.fogFar.value = u.fogFar.value;
    shared.fogHeightOrigin.value = u.fogHeightOrigin.value;
    shared.fogHeightDensity.value = u.fogHeightDensity.value;
    shared.skyFogTopColor.value.copy(u.skyFogTopColor.value);
    shared.skyFogMiddleColor.value.copy(u.skyFogMiddleColor.value);
    shared.skyFogBottomColor.value.copy(u.skyFogBottomColor.value);
    shared.skyFogOffset.value = u.skyFogOffset.value;
    shared.skyFogVoidOffset.value = u.skyFogVoidOffset.value;
    shared.skyFogExponent.value = u.skyFogExponent.value;
    shared.skyFogExponent2.value = u.skyFogExponent2.value;
    shared.skyFogDimension.value = u.skyFogDimension.value;
    shared.skyFogStrength.value = u.skyFogStrength.value;
  }
}

export function syncChunkShadowTslUniforms(
  renderer: ChunkRenderer,
  inputs: ChunkShadowInputs,
): void {
  const shadow = shadowByRenderer.get(renderer);
  if (!shadow) {
    return;
  }
  shadow.matrices[0].value.copy(inputs.shadowMatrices[0]);
  shadow.matrices[1].value.copy(inputs.shadowMatrices[1]);
  shadow.matrices[2].value.copy(inputs.shadowMatrices[2]);
  shadow.splits[0].value = inputs.cascadeSplits[0];
  shadow.splits[1].value = inputs.cascadeSplits[1];
  shadow.splits[2].value = inputs.cascadeSplits[2];
  shadow.mapSizes[0].value = inputs.shadowMapSizes[0];
  shadow.mapSizes[1].value = inputs.shadowMapSizes[1];
  shadow.mapSizes[2].value = inputs.shadowMapSizes[2];
  shadow.bias.value = inputs.shadowBias;
  shadow.strength.value = inputs.shadowStrength;
}

export interface ChunkNodeMaterialUniformShim {
  map: { value: Texture | null };
  alphaTest: { value: number };
  renderStage: { value: number };
}

export type ChunkNodeMaterial = MeshBasicNodeMaterial & {
  map: Texture;
  uniforms: ChunkNodeMaterialUniformShim;
};

export function createChunkNodeMaterial(
  initialMap: Texture,
  renderer: ChunkRenderer,
  shadowInputs?: ChunkShadowInputs,
): ChunkNodeMaterial {
  const shared = getOrCreateShared(renderer);
  const shadow = shadowInputs
    ? getOrCreateShadow(renderer, shadowInputs)
    : null;

  const material = new MeshBasicNodeMaterial({
    map: initialMap,
    side: FrontSide,
  });

  const lightInt = int(attribute("light", "int"));
  const aoIndex = bitAnd(shiftRight(lightInt, int(16)), int(0x3));
  const isFluidBit = bitAnd(shiftRight(lightInt, int(18)), int(0x1));
  const isGreedyBit = bitAnd(shiftRight(lightInt, int(19)), int(0x1));
  const sunInt = bitAnd(shiftRight(lightInt, int(12)), int(0xf));
  const rInt = bitAnd(shiftRight(lightInt, int(8)), int(0xf));
  const gInt = bitAnd(shiftRight(lightInt, int(4)), int(0xf));
  const bInt = bitAnd(lightInt, int(0xf));

  const ao = shared.aoTable;
  const aoSampled = select(
    aoIndex.equal(int(0)),
    ao.x,
    select(
      aoIndex.equal(int(1)),
      ao.y,
      select(aoIndex.equal(int(2)), ao.z, ao.w),
    ),
  );

  const vAO = varying(div(float(aoSampled), 255));
  const vIsFluid = varying(float(isFluidBit));
  const vIsGreedy = varying(float(isGreedyBit));
  const vSunNorm = varying(div(float(sunInt), 15));
  const vTorch = varying(div(vec3(float(rInt), float(gInt), float(bInt)), 15));

  // Greedy face atlas UV correction: greedy-meshed quads stretch a single
  // tile UV across many world units, so re-derive a tile-local UV from the
  // world position projected onto the face's dominant axis, then map it back
  // into the atlas cell with quarter-cell padding to avoid neighbour bleed.
  const cellSize = div(float(1), shared.atlasSize);
  const padding = mul(cellSize, 0.25);
  const innerSize = sub(cellSize, mul(padding, 2));

  const absN = abs(normalWorld);
  const fx = fract(positionWorld.x);
  const fy = fract(positionWorld.y);
  const fz = fract(positionWorld.z);

  const isYDom = greaterThan(absN.y, 0.5);
  const isXDom = greaterThan(absN.x, 0.5);
  const yPos = greaterThan(normalWorld.y, 0);
  const xPos = greaterThan(normalWorld.x, 0);
  const zPos = greaterThan(normalWorld.z, 0);

  const localUvY = select(
    yPos,
    vec2(sub(float(1), fx), fz),
    vec2(fx, sub(float(1), fz)),
  );
  const localUvX = select(xPos, vec2(sub(float(1), fz), fy), vec2(fz, fy));
  const localUvZ = select(zPos, vec2(fx, fy), vec2(sub(float(1), fx), fy));
  const localUvNonY = select(isXDom, localUvX, localUvZ);
  const localUv = select(isYDom, localUvY, localUvNonY);

  const baseUv = uv();
  const cellMin = mul(floor(div(baseUv, cellSize)), cellSize);
  const innerMin = add(cellMin, padding);
  const correctedUv = add(innerMin, mul(localUv, innerSize));
  const finalUv = select(greaterThan(vIsGreedy, 0.5), correctedUv, baseUv);

  const mapNode = texture(initialMap, finalUv);
  const sampled = mapNode;

  // Colored sky/sun ambient parity with the shader-lighting GLSL path: the
  // sun contribution is tinted by the time-of-day sun color, and the sky
  // ambient by the time-of-day ambient color (cool at night, warm at day).
  // A constant cool floor matches the GLSL `globalAmbient`, preventing warm
  // textures from looking red under near-zero illumination.
  const sunWeight = add(
    mul(
      mul(vSunNorm, vSunNorm),
      mul(shared.sunlightIntensity, shared.lightIntensityAdjustment),
    ),
    mul(shared.minLightLevel, vSunNorm),
  );
  const tunnelDarkening = mul(vSunNorm, vSunNorm);
  const sunColorVec = vec3(shared.sunColor);
  const ambientColorVec = vec3(shared.ambientColor);
  const sunIllum = mul(sunColorVec, sunWeight);
  const skyAmbient = mul(ambientColorVec, tunnelDarkening);
  const globalFloor = vec3(0.04, 0.045, 0.06);
  const ambientFloor = vec3(shared.baseAmbient);
  const s = clamp(
    add(add(add(sunIllum, skyAmbient), globalFloor), ambientFloor),
    0,
    1,
  );

  const torchScaled = mul(vTorch, shared.lightIntensityAdjustment);
  const torch = mul(torchScaled, torchScaled);
  const sLuma = dot(s, vec3(0.299, 0.587, 0.114));
  const torchAttenuation = sub(float(1), mul(sLuma, 0.8));
  const combinedLight = add(s, mul(torch, torchAttenuation));

  const aoFactor = mix(vAO, float(1), mul(vIsFluid, 0.8));

  const baseLit = mul(mul(sampled.rgb, combinedLight), aoFactor);

  let litRgb = baseLit;
  if (shadow && shadowInputs) {
    const wpos4 = vec4(positionWorld.x, positionWorld.y, positionWorld.z, 1);
    const viewDepth = max(float(0), sub(float(0), positionView.z));
    const ndotl = clamp(dot(normalWorld, vec3(0, 1, 0)), 0, 1);
    const baseSlopeBias = add(shadow.bias, mul(sub(float(1), ndotl), 0.0015));

    const lightClip0 = mul(shadow.matrices[0], wpos4);
    const lightNdc0 = div(lightClip0.xyz, lightClip0.w);
    const shadowUv0 = vec2(
      add(mul(lightNdc0.x, 0.5), 0.5),
      add(mul(lightNdc0.y, -0.5), 0.5),
    );
    const centeredX0 = sub(mul(shadowUv0.x, 2), 1);
    const centeredY0 = sub(mul(shadowUv0.y, 2), 1);
    const edgeFade0 = mul(
      clamp(
        sub(float(1), mul(max(abs(centeredX0), abs(centeredY0)), float(1.05))),
        0,
        1,
      ),
      clamp(
        sub(float(1), mul(max(abs(centeredX0), abs(centeredY0)), float(1.05))),
        0,
        1,
      ),
    );
    const inside0 = mul(
      edgeFade0,
      mul(step(float(0), lightNdc0.z), step(lightNdc0.z, float(1))),
    );
    const slopeBias0 = baseSlopeBias;
    const texel0 = div(float(1), shadow.mapSizes[0]);
    const shadowDepth0 = texture(shadowInputs.shadowMaps[0], shadowUv0).r;
    const shadowDepth0L = texture(
      shadowInputs.shadowMaps[0],
      add(shadowUv0, vec2(mul(texel0, -1), 0)),
    ).r;
    const shadowDepth0R = texture(
      shadowInputs.shadowMaps[0],
      add(shadowUv0, vec2(texel0, 0)),
    ).r;
    const shadowDepth0D = texture(
      shadowInputs.shadowMaps[0],
      add(shadowUv0, vec2(0, mul(texel0, -1))),
    ).r;
    const shadowDepth0U = texture(
      shadowInputs.shadowMaps[0],
      add(shadowUv0, vec2(0, texel0)),
    ).r;
    const occluded0 = div(
      add(
        add(
          add(
            add(
              step(shadowDepth0, sub(lightNdc0.z, slopeBias0)),
              step(shadowDepth0L, sub(lightNdc0.z, slopeBias0)),
            ),
            step(shadowDepth0R, sub(lightNdc0.z, slopeBias0)),
          ),
          step(shadowDepth0D, sub(lightNdc0.z, slopeBias0)),
        ),
        step(shadowDepth0U, sub(lightNdc0.z, slopeBias0)),
      ),
      5,
    );
    const visibility0 = sub(float(1), mul(inside0, occluded0));

    const lightClip1 = mul(shadow.matrices[1], wpos4);
    const lightNdc1 = div(lightClip1.xyz, lightClip1.w);
    const shadowUv1 = vec2(
      add(mul(lightNdc1.x, 0.5), 0.5),
      add(mul(lightNdc1.y, -0.5), 0.5),
    );
    const centeredX1 = sub(mul(shadowUv1.x, 2), 1);
    const centeredY1 = sub(mul(shadowUv1.y, 2), 1);
    const edgeBase1 = clamp(
      sub(float(1), mul(max(abs(centeredX1), abs(centeredY1)), float(1.05))),
      0,
      1,
    );
    const edgeFade1 = mul(edgeBase1, edgeBase1);
    const inside1 = mul(
      edgeFade1,
      mul(step(float(0), lightNdc1.z), step(lightNdc1.z, float(1))),
    );
    const slopeBias1 = mul(baseSlopeBias, 1.5);
    const texel1 = div(float(1), shadow.mapSizes[1]);
    const shadowDepth1 = texture(shadowInputs.shadowMaps[1], shadowUv1).r;
    const shadowDepth1L = texture(
      shadowInputs.shadowMaps[1],
      add(shadowUv1, vec2(mul(texel1, -1), 0)),
    ).r;
    const shadowDepth1R = texture(
      shadowInputs.shadowMaps[1],
      add(shadowUv1, vec2(texel1, 0)),
    ).r;
    const shadowDepth1D = texture(
      shadowInputs.shadowMaps[1],
      add(shadowUv1, vec2(0, mul(texel1, -1))),
    ).r;
    const shadowDepth1U = texture(
      shadowInputs.shadowMaps[1],
      add(shadowUv1, vec2(0, texel1)),
    ).r;
    const occluded1 = div(
      add(
        add(
          add(
            add(
              step(shadowDepth1, sub(lightNdc1.z, slopeBias1)),
              step(shadowDepth1L, sub(lightNdc1.z, slopeBias1)),
            ),
            step(shadowDepth1R, sub(lightNdc1.z, slopeBias1)),
          ),
          step(shadowDepth1D, sub(lightNdc1.z, slopeBias1)),
        ),
        step(shadowDepth1U, sub(lightNdc1.z, slopeBias1)),
      ),
      5,
    );
    const visibility1 = sub(float(1), mul(inside1, occluded1));

    const lightClip2 = mul(shadow.matrices[2], wpos4);
    const lightNdc2 = div(lightClip2.xyz, lightClip2.w);
    const shadowUv2 = vec2(
      add(mul(lightNdc2.x, 0.5), 0.5),
      add(mul(lightNdc2.y, -0.5), 0.5),
    );
    const centeredX2 = sub(mul(shadowUv2.x, 2), 1);
    const centeredY2 = sub(mul(shadowUv2.y, 2), 1);
    const edgeBase2 = clamp(
      sub(float(1), mul(max(abs(centeredX2), abs(centeredY2)), float(1.05))),
      0,
      1,
    );
    const edgeFade2 = mul(edgeBase2, edgeBase2);
    const inside2 = mul(
      edgeFade2,
      mul(step(float(0), lightNdc2.z), step(lightNdc2.z, float(1))),
    );
    const slopeBias2 = mul(baseSlopeBias, 2);
    const texel2 = div(float(1), shadow.mapSizes[2]);
    const shadowDepth2 = texture(shadowInputs.shadowMaps[2], shadowUv2).r;
    const shadowDepth2L = texture(
      shadowInputs.shadowMaps[2],
      add(shadowUv2, vec2(mul(texel2, -1), 0)),
    ).r;
    const shadowDepth2R = texture(
      shadowInputs.shadowMaps[2],
      add(shadowUv2, vec2(texel2, 0)),
    ).r;
    const shadowDepth2D = texture(
      shadowInputs.shadowMaps[2],
      add(shadowUv2, vec2(0, mul(texel2, -1))),
    ).r;
    const shadowDepth2U = texture(
      shadowInputs.shadowMaps[2],
      add(shadowUv2, vec2(0, texel2)),
    ).r;
    const occluded2 = div(
      add(
        add(
          add(
            add(
              step(shadowDepth2, sub(lightNdc2.z, slopeBias2)),
              step(shadowDepth2L, sub(lightNdc2.z, slopeBias2)),
            ),
            step(shadowDepth2R, sub(lightNdc2.z, slopeBias2)),
          ),
          step(shadowDepth2D, sub(lightNdc2.z, slopeBias2)),
        ),
        step(shadowDepth2U, sub(lightNdc2.z, slopeBias2)),
      ),
      5,
    );
    const visibility2 = sub(float(1), mul(inside2, occluded2));

    const blendRegion = float(0.1);
    const split0 = shadow.splits[0];
    const split1 = shadow.splits[1];
    const split2 = shadow.splits[2];

    const blendStart0 = mul(split0, sub(float(1), blendRegion));
    const blendT0 = clamp(
      div(sub(viewDepth, blendStart0), sub(split0, blendStart0)),
      0,
      1,
    );
    const cascadeVisibility0 = mix(visibility0, visibility1, blendT0);

    const blendStart1 = mul(split1, sub(float(1), blendRegion));
    const blendT1 = clamp(
      div(sub(viewDepth, blendStart1), sub(split1, blendStart1)),
      0,
      1,
    );
    const cascadeVisibility1 = mix(visibility1, visibility2, blendT1);

    const fadeStart2 = mul(split2, sub(float(1), blendRegion));
    const fadeT2 = clamp(
      div(sub(viewDepth, fadeStart2), sub(split2, fadeStart2)),
      0,
      1,
    );
    const cascadeVisibility2 = mix(visibility2, float(1), fadeT2);

    const rawVisibility = select(
      lessThan(viewDepth, split0),
      cascadeVisibility0,
      select(
        lessThan(viewDepth, split1),
        cascadeVisibility1,
        select(lessThan(viewDepth, split2), cascadeVisibility2, float(1)),
      ),
    );
    const factor = mix(float(1), rawVisibility, shadow.strength);

    litRgb = mul(baseLit, factor);
  }

  const horizontalOffset = sub(positionWorld.xz, cameraPosition.xz);
  const depth = length(horizontalOffset);
  const distFog = smoothstep(shared.fogNear, shared.fogFar, depth);
  const heightFog = sub(
    float(1),
    exp(
      mul(
        mul(shared.fogHeightDensity, -1),
        max(float(0), sub(shared.fogHeightOrigin, positionWorld.y)),
      ),
    ),
  );
  const heightDistScale = smoothstep(
    mul(shared.fogNear, 0.3),
    mul(shared.fogFar, 0.6),
    depth,
  );
  const fogFactor = max(distFog, mul(heightFog, heightDistScale));
  const fogRay = normalize(sub(positionWorld, cameraPosition));
  const skyDomePos = add(cameraPosition, mul(fogRay, shared.skyFogDimension));
  const sfH = normalize(add(skyDomePos, shared.skyFogOffset)).y;
  const sfH2 = normalize(add(skyDomePos, shared.skyFogVoidOffset)).y;
  const skyColor = mix(
    shared.skyFogMiddleColor,
    shared.skyFogTopColor,
    max(pow(max(sfH, 0), shared.skyFogExponent), 0),
  );
  const skyBottomBlend = max(
    pow(max(mul(sfH2, -1), 0), shared.skyFogExponent2),
    0,
  );
  const skyFogColor = mix(skyColor, shared.skyFogBottomColor, skyBottomBlend);
  const fogTint = mix(shared.fogColor, skyFogColor, shared.skyFogStrength);
  const finalRgb = mix(litRgb, fogTint, fogFactor);

  material.colorNode = vec4(finalRgb, sampled.a);

  const uniforms: ChunkNodeMaterialUniformShim = {
    map: { value: initialMap },
    alphaTest: { value: 0 },
    renderStage: { value: 0 },
  };
  const result = Object.assign(material, { uniforms }) as ChunkNodeMaterial;

  // The colorNode samples through `mapNode`, which captures the initial atlas
  // by reference. The world later replaces the chunk atlas via `mat.map = ...`
  // (and again via `mat.uniforms.map.value = ...`); forward both writes into
  // the TSL texture node so the rendered atlas tracks the current map.
  let currentMap: Texture = initialMap;
  Object.defineProperty(result, "map", {
    configurable: true,
    enumerable: true,
    get: () => currentMap,
    set: (next: Texture) => {
      currentMap = next;
      mapNode.value = next;
      uniforms.map.value = next;
    },
  });

  return result;
}

// Bind Int32Array-backed `light` BufferAttributes as integer attributes on
// WebGPU. The mesh worker emits Int32Array; Three's BufferAttribute path needs
// an explicit gpuType to keep the integer lane on WebGPU pipelines (WebGL2
// already handles this implicitly via `attribute int`).
export const CHUNK_LIGHT_ATTRIBUTE_GPU_TYPE = IntType;
