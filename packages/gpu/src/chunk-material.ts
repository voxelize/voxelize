import { Color, FrontSide, Texture } from "three";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  max,
  mix,
  normalWorld,
  positionWorld,
  select,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

export interface ChunkMaterialParams {
  atlas: Texture;
  atlasSize?: number;
  sunlightIntensity?: number;
  minLightLevel?: number;
  baseAmbient?: number;
  lightIntensityAdjustment?: number;
  fogColor?: Color;
  fogNear?: number;
  fogFar?: number;
  fogHeightOrigin?: number;
  fogHeightDensity?: number;
}

export function createChunkMaterial(params: ChunkMaterialParams) {
  const material = new MeshBasicNodeMaterial();
  material.side = FrontSide;
  material.alphaTest = 0.5;
  material.fog = false;

  const uAtlasSize = uniform(params.atlasSize ?? 8);
  const uSunlightIntensity = uniform(params.sunlightIntensity ?? 1.0);
  const uMinLightLevel = uniform(params.minLightLevel ?? 0.05);
  const uBaseAmbient = uniform(params.baseAmbient ?? 0.04);
  const uLightIntensityAdj = uniform(params.lightIntensityAdjustment ?? 1.0);
  const uFogColor = uniform(params.fogColor ?? new Color(0.53, 0.81, 0.92));
  const uFogNear = uniform(params.fogNear ?? 100);
  const uFogFar = uniform(params.fogFar ?? 400);
  const uFogHeightOrigin = uniform(params.fogHeightOrigin ?? 80);
  const uFogHeightDensity = uniform(params.fogHeightDensity ?? 0.01);

  const lightAttr = attribute("light", "int");

  // --- Unpack light (matches v1 mesher bit layout) ---
  // bits 0-3: blue torch, 4-7: green torch, 8-11: red torch, 12-15: sun
  // bits 16-17: AO, bit 18: isFluid, bit 19: isGreedy
  const torchR = float(lightAttr.shiftRight(8).bitAnd(0xf)).div(15.0);
  const torchG = float(lightAttr.shiftRight(4).bitAnd(0xf)).div(15.0);
  const torchB = float(lightAttr.bitAnd(0xf)).div(15.0);
  const torchLight = vec3(torchR, torchG, torchB);

  const sunLevel = float(lightAttr.shiftRight(12).bitAnd(0xf)).div(15.0);

  const aoLevel = lightAttr.shiftRight(16).bitAnd(0x3);
  const ao = float(0.8).sub(float(aoLevel).mul(0.1));

  const isFluid = float(lightAttr.shiftRight(18).bitAnd(0x1));
  const isGreedy = float(lightAttr.shiftRight(19).bitAnd(0x1));

  // --- Greedy UV remapping ---
  const baseUv = uv();
  const wp = positionWorld;
  const wn = normalWorld;
  const absN = abs(wn);

  const cellSize = float(1.0).div(uAtlasSize);
  const padding = cellSize.div(4.0);
  const innerSize = cellSize.sub(padding.mul(2.0));

  const localUvY = select(
    wn.y.greaterThan(0.0),
    vec2(float(1.0).sub(fract(wp.x)), fract(wp.z)),
    vec2(fract(wp.x), float(1.0).sub(fract(wp.z))),
  );

  const localUvX = select(
    wn.x.greaterThan(0.0),
    vec2(float(1.0).sub(fract(wp.z)), fract(wp.y)),
    vec2(fract(wp.z), fract(wp.y)),
  );

  const localUvZ = select(
    wn.z.greaterThan(0.0),
    vec2(fract(wp.x), fract(wp.y)),
    vec2(float(1.0).sub(fract(wp.x)), fract(wp.y)),
  );

  const localUv = select(
    absN.y.greaterThan(0.5),
    localUvY,
    select(absN.x.greaterThan(0.5), localUvX, localUvZ),
  );

  const cellMin = floor(baseUv.div(cellSize)).mul(cellSize);
  const innerMin = cellMin.add(padding);
  const greedyUv = innerMin.add(localUv.mul(innerSize));

  const finalUv = select(isGreedy.greaterThan(0.5), greedyUv, baseUv);

  // --- Texture sampling ---
  const sampledColor = texture(params.atlas, finalUv);

  // --- Lighting (matching v1 DEFAULT_CHUNK_SHADERS) ---
  const sunlightFactor = sunLevel
    .mul(sunLevel)
    .mul(uSunlightIntensity)
    .mul(uLightIntensityAdj);

  const s = clamp(
    sunlightFactor.add(uMinLightLevel.mul(sunLevel)).add(uBaseAmbient),
    0.0,
    1.0,
  );

  const torchScaled = torchLight
    .mul(uLightIntensityAdj)
    .pow(vec3(2.0, 2.0, 2.0));
  const torchAttenuation = float(1.0).sub(s.mul(0.8));
  const combinedLight = vec3(s, s, s).add(torchScaled.mul(torchAttenuation));

  const aoFactor = mix(ao, float(1.0), isFluid.mul(0.8));
  const litColor = sampledColor.rgb.mul(combinedLight).mul(aoFactor);

  // --- Fog (distance + height) ---
  const fogDiff = wp.xz.sub(cameraPosition.xz);
  const depth = sqrt(dot(fogDiff, fogDiff));
  const distFog = smoothstep(uFogNear, uFogFar, depth);
  const heightFog = float(1.0).sub(
    exp(
      uFogHeightDensity
        .negate()
        .mul(max(float(0.0), uFogHeightOrigin.sub(wp.y))),
    ),
  );
  const heightDistScale = smoothstep(
    uFogNear.mul(0.3),
    uFogFar.mul(0.6),
    depth,
  );
  const fogFactor = max(distFog, heightFog.mul(heightDistScale));
  const foggedColor = mix(litColor, uFogColor, fogFactor);

  material.colorNode = foggedColor;
  material.opacityNode = sampledColor.a;

  return {
    material,
    uniforms: {
      atlasSize: uAtlasSize,
      sunlightIntensity: uSunlightIntensity,
      minLightLevel: uMinLightLevel,
      baseAmbient: uBaseAmbient,
      lightIntensityAdjustment: uLightIntensityAdj,
      fogColor: uFogColor,
      fogNear: uFogNear,
      fogFar: uFogFar,
      fogHeightOrigin: uFogHeightOrigin,
      fogHeightDensity: uFogHeightDensity,
    },
  };
}
