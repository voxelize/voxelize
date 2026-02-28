import { Color, Matrix4, Vector3, Vector4 } from "three";
import type { Texture } from "three";
import {
  attribute,
  texture,
  uniform,
  float,
  vec3,
  vec4,
  clamp,
  mix,
  exp,
  step,
  max,
  dot,
  smoothstep,
  positionWorld,
  normalWorld,
  uv,
  cameraPosition,
} from "three/tsl";

import { acesTonemapNode } from "../nodes/aces-tonemap-node";
import { cascadeShadowNode } from "../nodes/cascade-shadow-node";
import { greedyUVNode } from "../nodes/greedy-uv-node";
import { simplexNoise3d } from "../nodes/simplex-noise-node";
import { voxelFogNode } from "../nodes/voxel-fog-node";
import { unpackVoxelFlags, unpackVoxelLight } from "../nodes/voxel-light-node";
import { waterNormalNode, waterSurfaceNode } from "../nodes/water-surface-node";

type NodeRef = ReturnType<typeof float>;

function lookupAOTable(aoIndex: NodeRef, aoTable: NodeRef): NodeRef {
  const is0 = float(1).sub(step(float(0.5), aoIndex));
  const is1 = step(float(0.5), aoIndex).mul(
    float(1).sub(step(float(1.5), aoIndex)),
  );
  const is2 = step(float(1.5), aoIndex).mul(
    float(1).sub(step(float(2.5), aoIndex)),
  );
  const is3 = step(float(2.5), aoIndex);
  return aoTable.x
    .mul(is0)
    .add(aoTable.y.mul(is1))
    .add(aoTable.z.mul(is2))
    .add(aoTable.w.mul(is3))
    .div(255.0);
}

interface ShaderLitChunkConfig {
  atlas: Texture;
  atlasSize: number;
  shadowMaps: [Texture, Texture, Texture];
  shadowMapSize: number;
}

export function buildShaderLitChunkNodes(config: ShaderLitChunkConfig) {
  const { atlas, atlasSize, shadowMaps, shadowMapSize } = config;

  const uAtlasSize = uniform(atlasSize);
  const uAOTable = uniform(new Vector4(255, 200, 150, 100));
  const uTime = uniform(0.0);

  const uSunDirection = uniform(new Vector3(0.5, 1.0, 0.3).normalize());
  const uSunColor = uniform(new Color(1.0, 0.98, 0.92));
  const uSunlightIntensity = uniform(1.0);
  const uAmbientColor = uniform(new Color(0.15, 0.18, 0.25));

  const uShadowMatrix0 = uniform(new Matrix4());
  const uShadowMatrix1 = uniform(new Matrix4());
  const uShadowMatrix2 = uniform(new Matrix4());
  const uCascadeSplit0 = uniform(16.0);
  const uCascadeSplit1 = uniform(48.0);
  const uCascadeSplit2 = uniform(128.0);
  const uShadowBias = uniform(0.0005);
  const uShadowStrength = uniform(1.0);

  const uFogColor = uniform(new Color(0.7, 0.75, 0.85));
  const uFogNear = uniform(100.0);
  const uFogFar = uniform(300.0);
  const uFogHeightOrigin = uniform(64.0);
  const uFogHeightDensity = uniform(0.02);

  const uWaterTint = uniform(new Color(0.2, 0.5, 0.7));
  const uWaterAbsorption = uniform(1.0);
  const uWaterLevel = uniform(64.0);

  const uSkyTopColor = uniform(new Color(0.25, 0.45, 0.9));
  const uSkyMiddleColor = uniform(new Color(0.7, 0.8, 0.95));

  const lightAttr = attribute("light", "int");
  const lightVec = unpackVoxelLight(lightAttr);
  const flagVec = unpackVoxelFlags(lightAttr);
  const aoIndex = flagVec.x;
  const isFluid = flagVec.y;
  const isGreedy = flagVec.z;

  const aoValue = lookupAOTable(aoIndex, uAOTable);

  const finalUv = greedyUVNode(
    uv(),
    positionWorld,
    normalWorld,
    uAtlasSize,
    isGreedy,
  );
  const texColor = texture(atlas, finalUv);

  const normalOffset = normalWorld.mul(0.02);
  const offsetPos = vec4(positionWorld.add(normalOffset), float(1));
  const shadowCoord0 = uShadowMatrix0.mul(offsetPos);
  const shadowCoord1 = uShadowMatrix1.mul(offsetPos);
  const shadowCoord2 = uShadowMatrix2.mul(offsetPos);

  const viewDepth = cameraPosition.sub(positionWorld).length();

  const shadow = cascadeShadowNode({
    worldNormal: normalWorld,
    sunDirection: uSunDirection,
    sunExposure: lightVec.w,
    viewDepth,
    shadowCoords: [shadowCoord0, shadowCoord1, shadowCoord2],
    shadowMaps,
    cascadeSplits: [uCascadeSplit0, uCascadeSplit1, uCascadeSplit2],
    shadowBias: uShadowBias,
    shadowStrength: uShadowStrength,
    shadowMapSize,
  });

  const rawNdotL = dot(normalWorld, uSunDirection);
  const NdotL = max(rawNdotL.mul(0.85).add(0.15), float(0));
  const sunExposure = lightVec.w;
  const sunContribution = uSunColor
    .mul(NdotL)
    .mul(shadow)
    .mul(uSunlightIntensity)
    .mul(sunExposure);

  const cpuTorchLight = lightVec.xyz;
  const smoothTorch = cpuTorchLight
    .mul(cpuTorchLight)
    .mul(vec3(3).sub(cpuTorchLight.mul(2)));
  const torchBrightness = max(max(smoothTorch.x, smoothTorch.y), smoothTorch.z);
  const torchLight = smoothTorch.mul(1.2);

  const ambientOcclusion = mix(float(0.5), float(1), shadow);
  const tunnelDarkening = sunExposure.mul(sunExposure);

  const hemisphereBlend = normalWorld.y.mul(0.5).add(0.5);
  const groundColor = uAmbientColor.mul(0.4);
  const skyAmbient = mix(groundColor, uAmbientColor, hemisphereBlend);

  const texLuma = dot(texColor.xyz, vec3(0.2126, 0.7152, 0.0722));
  const isBrightTex = smoothstep(float(0.75), float(0.95), texLuma);

  const aoFactor = mix(aoValue, float(1), isFluid.mul(0.8));
  const torchDominance = torchBrightness.div(
    torchBrightness.add(dot(sunContribution, vec3(0.33))).add(0.01),
  );
  const torchAOReduction = torchDominance.mul(0.3);
  const enhancedAO = mix(aoFactor, float(1), torchAOReduction);

  const sunTotal = skyAmbient
    .mul(ambientOcclusion)
    .mul(tunnelDarkening)
    .add(sunContribution.mul(mix(float(1), float(0.7), isBrightTex)));

  const totalLightRaw = vec3(1).sub(
    vec3(1).sub(sunTotal).mul(vec3(1).sub(torchLight)),
  );

  const warmTint = vec3(1.05, 0.92, 0.75);
  const coolTint = vec3(0.92, 0.95, 1.05);
  const temperatureShift = mix(coolTint, warmTint, torchDominance);

  const totalLight = totalLightRaw.mul(temperatureShift).mul(enhancedAO);
  const toneMapped = acesTonemapNode(totalLight);
  let litColor: NodeRef = texColor.xyz.mul(toneMapped);

  const isWater = step(float(0.5), isFluid);
  const wNormal = waterNormalNode(positionWorld, uTime, normalWorld);
  const waterResult = waterSurfaceNode(
    litColor,
    positionWorld,
    wNormal,
    uSunDirection,
    uSunColor,
    uSunlightIntensity,
    uSkyTopColor,
    uSkyMiddleColor,
    uWaterTint,
    uWaterAbsorption,
    uWaterLevel,
  );
  litColor = mix(litColor, waterResult, isWater);

  const causticsTime = uTime.mul(0.0003);
  const underWater = step(positionWorld.y, uWaterLevel).mul(
    float(1).sub(isWater),
  );
  const waterDepth = uWaterLevel.sub(positionWorld.y);
  const depthFade = exp(waterDepth.negate().mul(0.15));
  const c1 = simplexNoise3d(
    vec3(
      positionWorld.x.mul(0.3).add(causticsTime.mul(0.4)),
      positionWorld.z.mul(0.3).sub(causticsTime.mul(0.3)),
      causticsTime,
    ),
  );
  const c2 = simplexNoise3d(
    vec3(
      positionWorld.x.mul(0.5).sub(causticsTime.mul(0.3)),
      positionWorld.z.mul(0.5).add(causticsTime.mul(0.4)),
      causticsTime.mul(1.3).add(5),
    ),
  );
  const caustic = c1.mul(c1).add(c2.mul(c2)).mul(0.5);
  const causticStrength = depthFade
    .mul(shadow)
    .mul(uSunlightIntensity)
    .mul(0.25);
  litColor = litColor.add(vec3(caustic.mul(causticStrength)).mul(underWater));

  const colorNode = voxelFogNode(
    litColor,
    positionWorld,
    uFogColor,
    uFogNear,
    uFogFar,
    uFogHeightOrigin,
    uFogHeightDensity,
  );

  return {
    colorNode,
    uniforms: {
      time: uTime,
      sunDirection: uSunDirection,
      sunColor: uSunColor,
      sunlightIntensity: uSunlightIntensity,
      ambientColor: uAmbientColor,
      shadowMatrix0: uShadowMatrix0,
      shadowMatrix1: uShadowMatrix1,
      shadowMatrix2: uShadowMatrix2,
      cascadeSplit0: uCascadeSplit0,
      cascadeSplit1: uCascadeSplit1,
      cascadeSplit2: uCascadeSplit2,
      shadowBias: uShadowBias,
      shadowStrength: uShadowStrength,
      fogColor: uFogColor,
      fogNear: uFogNear,
      fogFar: uFogFar,
      fogHeightOrigin: uFogHeightOrigin,
      fogHeightDensity: uFogHeightDensity,
      waterTint: uWaterTint,
      waterAbsorption: uWaterAbsorption,
      waterLevel: uWaterLevel,
      skyTopColor: uSkyTopColor,
      skyMiddleColor: uSkyMiddleColor,
    },
  };
}
