import {
  CoordinateSystem,
  FrontSide,
  IntType,
  Matrix4,
  Texture,
  WebGPUCoordinateSystem,
} from "three";
import {
  abs,
  add,
  attribute,
  bitAnd,
  clamp,
  div,
  dot,
  float,
  floor,
  fract,
  greaterThan,
  int,
  max,
  mix,
  mul,
  normalWorld,
  positionWorld,
  select,
  shiftRight,
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

export interface ChunkShadowInputs {
  shadowMap: Texture;
  shadowMatrix: Matrix4;
  shadowBias: number;
  shadowStrength: number;
  // Renderer clip-space convention. WebGL produces NDC z in [-1, 1] and the
  // texture sampler reads with v=0 at the bottom; WebGPU produces NDC z in
  // [0, 1] and reads with v=0 at the top. We bake the matching conversion
  // into the TSL graph at material build time.
  coordinateSystem: CoordinateSystem;
}

function buildShadowTslUniforms(inputs: ChunkShadowInputs) {
  return {
    matrix: uniform(inputs.shadowMatrix.clone()),
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
  }
}

export function syncChunkShadowTslUniforms(
  renderer: ChunkRenderer,
  inputs: ChunkShadowInputs,
): void {
  const shadow = shadowByRenderer.get(renderer);
  if (!shadow) return;
  shadow.matrix.value.copy(inputs.shadowMatrix);
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
    const isWebGpu = shadowInputs.coordinateSystem === WebGPUCoordinateSystem;

    const wpos4 = vec4(positionWorld.x, positionWorld.y, positionWorld.z, 1);
    const lightClip = mul(shadow.matrix, wpos4);
    const lightNdc = div(lightClip.xyz, lightClip.w);

    // UV mapping: NDC.x maps to UV.x identically in both backends. NDC.y has
    // the same orientation in both (y-up clip space), but the framebuffer
    // storage is y-down on WebGPU and y-up on WebGL, so we flip Y when
    // sampling on WebGPU.
    const shadowUvX = add(mul(lightNdc.x, 0.5), 0.5);
    const shadowUvY = isWebGpu
      ? add(mul(lightNdc.y, -0.5), 0.5)
      : add(mul(lightNdc.y, 0.5), 0.5);
    const shadowUv = vec2(shadowUvX, shadowUvY);

    // The depth pass stores raw `clip.z / clip.w` (NDC z), so the receiver
    // uses NDC z directly. WebGL: [-1, 1]; WebGPU: [0, 1]. The `inside` mask
    // below restricts comparisons to the valid range per backend.
    const refDepth = lightNdc.z;
    const zMin = isWebGpu ? float(0) : float(-1);
    const zMax = float(1);

    // Smooth radial fade in light-space: shadow strength tapers to zero as the
    // sample approaches the ortho frustum border, removing the hard
    // rectangular cutoff that made the focus snap visible. Depth-clip uses a
    // hard step since out-of-range Z must never sample stale texels.
    const centeredX = sub(mul(shadowUv.x, 2), 1);
    const centeredY = sub(mul(shadowUv.y, 2), 1);
    const radial = clamp(
      sub(float(1), mul(max(abs(centeredX), abs(centeredY)), float(1.05))),
      0,
      1,
    );
    const edgeFade = mul(radial, radial);
    const insideZ = mul(step(zMin, refDepth), step(refDepth, zMax));
    const inside = mul(edgeFade, insideZ);

    const shadowSample = texture(shadowInputs.shadowMap, shadowUv);
    const sampledDepth = shadowSample.r;

    // Slope-scaled bias: faces nearly parallel to the light direction need a
    // larger margin to avoid self-shadow acne, while faces facing the light
    // can use a tight bias for crisp contact shadows. We scale the WebGL
    // bias by 2 internally so the shipped `shadowBias` reads as "fraction of
    // the [0, 1] depth range" regardless of backend.
    const ndotl = clamp(dot(normalWorld, vec3(0, 1, 0)), 0, 1);
    const biasScale = isWebGpu ? float(1) : float(2);
    const slopeBias = mul(
      add(shadow.bias, mul(sub(float(1), ndotl), 0.0015)),
      biasScale,
    );

    const occluded = step(sampledDepth, sub(refDepth, slopeBias));
    const occlusion = mul(inside, occluded);
    const factor = sub(float(1), mul(occlusion, shadow.strength));

    litRgb = mul(baseLit, factor);
  }

  material.colorNode = vec4(litRgb, sampled.a);

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
