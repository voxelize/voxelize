import { Data3DTexture, DataTexture, type Texture } from "three";
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  Fn,
  max,
  mix,
  modelWorldMatrix,
  normalize,
  normalWorld,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  texture3D,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";

import type { ChunkRenderer } from "./chunk-renderer";
import { createFogNode } from "./fog-nodes";
import { createGreedyUVNode } from "./greedy-uv-nodes";
import { createLightUnpackNodes } from "./light-unpack-nodes";
import { createChunkShadowNode } from "./shadow-nodes";
import { simplexNoise3dFn } from "./simplex-noise-tsl";
import { createCausticsNode, createWaterNode } from "./water-nodes";

type ChunkUniforms = ChunkRenderer["uniforms"];
type ShaderLightingChunkUniforms = ChunkRenderer["shaderLightingUniforms"];

const bindUniform = <T>(source: { value: T }) =>
  uniform(source.value).onRenderUpdate(() => source.value);

const placeholder2D = new DataTexture(
  new Uint8Array([255, 255, 255, 255]),
  1,
  1,
);
placeholder2D.needsUpdate = true;

const placeholder3D = new Data3DTexture(
  new Uint8Array([0, 0, 0, 255]),
  1,
  1,
  1,
);
placeholder3D.needsUpdate = true;

const bindTextureUniform = (
  source: { value: Texture | null },
  fallback: Texture,
) =>
  texture(source.value ?? fallback).onRenderUpdate(
    () => source.value ?? fallback,
  );

const bindTexture3DUniform = (
  source: { value: Data3DTexture | null },
  fallback: Data3DTexture,
) =>
  texture3D(source.value ?? fallback).onRenderUpdate(
    () => source.value ?? fallback,
  );

export function createDefaultChunkMaterial(params: {
  uniforms: ChunkUniforms;
  atlas: Texture;
  transparent?: boolean;
  isFluid?: boolean;
}): MeshBasicNodeMaterial {
  const { uniforms, atlas, transparent = false, isFluid = false } = params;

  const uAOTable = bindUniform(uniforms.ao);
  const uTime = bindUniform(uniforms.time);
  const uAtlasSize = bindUniform(uniforms.atlasSize);
  const uShowGreedyDebug = bindUniform(uniforms.showGreedyDebug);
  const uSunlightIntensity = bindUniform(uniforms.sunlightIntensity);
  const uLightIntensityAdjustment = bindUniform(
    uniforms.lightIntensityAdjustment,
  );
  const uMinLightLevel = bindUniform(uniforms.minLightLevel);
  const uBaseAmbient = bindUniform(uniforms.baseAmbient);
  const uFogColor = bindUniform(uniforms.fogColor);
  const uFogNear = bindUniform(uniforms.fogNear);
  const uFogFar = bindUniform(uniforms.fogFar);
  const uFogHeightOrigin = bindUniform(uniforms.fogHeightOrigin);
  const uFogHeightDensity = bindUniform(uniforms.fogHeightDensity);
  const uMaterialFluid = uniform(isFluid ? 1.0 : 0.0);

  const {
    red,
    green,
    blue,
    sunlight,
    aoFactor: unpackedAoFactor,
    isFluid: isFluidFromLight,
    isGreedy,
    shouldWave,
  } = createLightUnpackNodes(uAOTable);

  const worldPosForWave = varying(
    modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz,
  );
  const waveOffset = sin(worldPosForWave.x.mul(0.15).add(uTime.mul(0.0006)))
    .mul(0.08)
    .mul(step(0.5, shouldWave));

  const vWorldPosition = varying(positionWorld);
  const vWorldNormal = varying(normalWorld);

  const baseUV = attribute("uv", "vec2");
  const finalUv = createGreedyUVNode({
    baseUV,
    worldPosition: vWorldPosition,
    worldNormal: vWorldNormal,
    isGreedy,
    atlasSize: uAtlasSize,
  });

  const sampledDiffuse = texture(atlas, finalUv);
  const debugMask = step(0.5, uShowGreedyDebug);
  const greedyMask = step(0.5, isGreedy);
  const greedyDebugColor = mix(
    vec3(1.0, 0.0, 0.0),
    vec3(0.0, 1.0, 0.0),
    greedyMask,
  );
  const diffuseDebugColor = mix(sampledDiffuse.rgb, greedyDebugColor, 0.4);
  const diffuseColor = mix(sampledDiffuse.rgb, diffuseDebugColor, debugMask);

  const sunlightFactor = sunlight
    .mul(sunlight)
    .mul(uSunlightIntensity)
    .mul(uLightIntensityAdjustment);

  const sBase = clamp(
    sunlightFactor.add(uMinLightLevel.mul(sunlight)).add(uBaseAmbient),
    0.0,
    1.0,
  );
  const s = sBase.sub(sBase.mul(exp(sBase.mul(-1.0))).mul(0.02));

  const torchLight = pow(
    vec3(red, green, blue).mul(uLightIntensityAdjustment),
    vec3(2.0),
  );
  const torchAttenuation = float(1.0).sub(s.mul(0.8));
  const combinedLight = vec3(s).add(torchLight.mul(torchAttenuation));
  const litColor = diffuseColor.mul(combinedLight);

  const effectiveIsFluid = max(isFluidFromLight, uMaterialFluid);
  const aoTerm = mix(unpackedAoFactor, 1.0, effectiveIsFluid.mul(0.8));
  const shadedColor = litColor.mul(aoTerm);

  const fogNode = createFogNode({
    worldPosition: vWorldPosition,
    cameraPosition,
    fogColor: uFogColor,
    fogNear: uFogNear,
    fogFar: uFogFar,
    fogHeightOrigin: uFogHeightOrigin,
    fogHeightDensity: uFogHeightDensity,
  });

  const foggedColor = fogNode(shadedColor);
  const alpha = sampledDiffuse.a;

  const material = new MeshBasicNodeMaterial();
  material.map = atlas;
  material.transparent = transparent;
  material.positionNode = positionLocal.add(vec3(0.0, waveOffset, 0.0));
  material.colorNode = shadedColor;
  material.opacityNode = alpha;
  material.outputNode = vec4(foggedColor, alpha);

  return material;
}

export function createShaderLightingChunkMaterial(params: {
  uniforms: ChunkUniforms;
  shaderLightingUniforms: ShaderLightingChunkUniforms;
  atlas: Texture;
  transparent?: boolean;
  isFluid?: boolean;
}): MeshBasicNodeMaterial {
  const {
    uniforms,
    shaderLightingUniforms,
    atlas,
    transparent = false,
    isFluid = false,
  } = params;

  const uAOTable = bindUniform(uniforms.ao);
  const uTime = bindUniform(uniforms.time);
  const uAtlasSize = bindUniform(uniforms.atlasSize);
  const uShowGreedyDebug = bindUniform(uniforms.showGreedyDebug);
  const uFogColor = bindUniform(uniforms.fogColor);
  const uFogNear = bindUniform(uniforms.fogNear);
  const uFogFar = bindUniform(uniforms.fogFar);
  const uFogHeightOrigin = bindUniform(uniforms.fogHeightOrigin);
  const uFogHeightDensity = bindUniform(uniforms.fogHeightDensity);
  const uMaterialFluid = uniform(isFluid ? 1.0 : 0.0);

  const uSunDirection = bindUniform(shaderLightingUniforms.sunDirection);
  const uSunColor = bindUniform(shaderLightingUniforms.sunColor);
  const uAmbientColor = bindUniform(shaderLightingUniforms.ambientColor);
  const uShadowMap0 = bindTextureUniform(
    shaderLightingUniforms.shadowMap0,
    placeholder2D,
  );
  const uShadowMap1 = bindTextureUniform(
    shaderLightingUniforms.shadowMap1,
    placeholder2D,
  );
  const uShadowMap2 = bindTextureUniform(
    shaderLightingUniforms.shadowMap2,
    placeholder2D,
  );
  const uShadowMatrix0 = bindUniform(shaderLightingUniforms.shadowMatrix0);
  const uShadowMatrix1 = bindUniform(shaderLightingUniforms.shadowMatrix1);
  const uShadowMatrix2 = bindUniform(shaderLightingUniforms.shadowMatrix2);
  const uCascadeSplit0 = bindUniform(shaderLightingUniforms.cascadeSplit0);
  const uCascadeSplit1 = bindUniform(shaderLightingUniforms.cascadeSplit1);
  const uCascadeSplit2 = bindUniform(shaderLightingUniforms.cascadeSplit2);
  const uShadowBias = bindUniform(shaderLightingUniforms.shadowBias);
  const uShadowStrength = bindUniform(shaderLightingUniforms.shadowStrength);
  const uSunlightIntensity = bindUniform(
    shaderLightingUniforms.sunlightIntensity,
  );
  const uLightVolume = bindTexture3DUniform(
    shaderLightingUniforms.lightVolume,
    placeholder3D,
  );
  const uLightVolumeMin = bindUniform(shaderLightingUniforms.lightVolumeMin);
  const uLightVolumeSize = bindUniform(shaderLightingUniforms.lightVolumeSize);
  const uWaterTint = bindUniform(shaderLightingUniforms.waterTint);
  const uWaterAbsorption = bindUniform(shaderLightingUniforms.waterAbsorption);
  const uWaterLevel = bindUniform(shaderLightingUniforms.waterLevel);
  const uSkyTopColor = bindUniform(shaderLightingUniforms.skyTopColor);
  const uSkyMiddleColor = bindUniform(shaderLightingUniforms.skyMiddleColor);
  const uShadowDebugMode = bindUniform(shaderLightingUniforms.shadowDebugMode);

  const {
    red,
    green,
    blue,
    sunlight,
    aoFactor: unpackedAoFactor,
    isFluid: isFluidFromLight,
    isGreedy,
    shouldWave,
  } = createLightUnpackNodes(uAOTable);

  const worldPosForWave = varying(
    modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz,
  );
  const waveTime = uTime.mul(0.0006);
  const wave1 = simplexNoise3dFn(
    vec3(
      worldPosForWave.x.mul(0.15).add(waveTime.mul(0.3)),
      worldPosForWave.z.mul(0.15).sub(waveTime.mul(0.2)),
      0.0,
    ),
  ).mul(0.08);
  const wave2 = simplexNoise3dFn(
    vec3(
      worldPosForWave.x.mul(0.4).sub(waveTime.mul(0.5)),
      worldPosForWave.z.mul(0.4).add(waveTime.mul(0.4)),
      10.0,
    ),
  ).mul(0.04);
  const wave3 = simplexNoise3dFn(
    vec3(
      worldPosForWave.x.mul(0.8).add(waveTime.mul(0.7)),
      worldPosForWave.z.mul(0.8).sub(waveTime.mul(0.5)),
      20.0,
    ),
  ).mul(0.02);
  const waveOffset = wave1.add(wave2).add(wave3).mul(step(0.5, shouldWave));

  const vWorldPosition = varying(positionWorld);
  const vWorldNormal = varying(normalize(normalWorld));
  const vViewDepth = varying(positionView.z.mul(-1.0));

  const normalOffset = vWorldNormal.mul(0.02);
  const shadowOffsetPos = vec4(vWorldPosition.add(normalOffset), 1.0);
  const vShadowCoord0 = varying(uShadowMatrix0.mul(shadowOffsetPos));
  const vShadowCoord1 = varying(uShadowMatrix1.mul(shadowOffsetPos));
  const vShadowCoord2 = varying(uShadowMatrix2.mul(shadowOffsetPos));

  const baseUV = attribute("uv", "vec2");
  const finalUv = createGreedyUVNode({
    baseUV,
    worldPosition: vWorldPosition,
    worldNormal: vWorldNormal,
    isGreedy,
    atlasSize: uAtlasSize,
  });

  const sampledDiffuse = texture(atlas, finalUv);

  const fragmentOutput = Fn(() => {
    const greedyDebugMask = step(0.5, uShowGreedyDebug);
    const greedyMask = step(0.5, isGreedy);
    const greedyDebugColor = mix(
      vec3(1.0, 0.0, 0.0),
      vec3(0.0, 1.0, 0.0),
      greedyMask,
    );
    const diffuseDebugColor = mix(sampledDiffuse.rgb, greedyDebugColor, 0.4);
    const diffuseColor = mix(
      sampledDiffuse.rgb,
      diffuseDebugColor,
      greedyDebugMask,
    ).toVar();

    const shadow = createChunkShadowNode({
      vWorldNormal,
      uSunDirection,
      uShadowStrength,
      vLight: vec4(red, green, blue, sunlight),
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
    }).toVar();

    const rawNdotL = dot(vWorldNormal, uSunDirection).toVar();
    const ndotl = max(rawNdotL.mul(0.85).add(0.15), 0.0).toVar();
    const sunExposure = sunlight.toVar();
    const sunContribution = uSunColor
      .mul(ndotl)
      .mul(shadow)
      .mul(uSunlightIntensity)
      .mul(sunExposure)
      .toVar();

    const cpuTorchLight = vec3(red, green, blue).toVar();
    const smoothTorch = cpuTorchLight
      .mul(cpuTorchLight)
      .mul(vec3(3.0).sub(cpuTorchLight.mul(2.0)))
      .toVar();
    const torchBrightness = max(
      max(smoothTorch.r, smoothTorch.g),
      smoothTorch.b,
    );

    const lightVolumeCoord = vWorldPosition
      .sub(uLightVolumeMin)
      .div(uLightVolumeSize)
      .toVar();
    const lightVolumeCoordClamped = clamp(
      lightVolumeCoord,
      vec3(0.0),
      vec3(1.0),
    );
    const insideMask = step(0.0, lightVolumeCoord.x)
      .mul(step(0.0, lightVolumeCoord.y))
      .mul(step(0.0, lightVolumeCoord.z))
      .mul(step(lightVolumeCoord.x, 1.0))
      .mul(step(lightVolumeCoord.y, 1.0))
      .mul(step(lightVolumeCoord.z, 1.0))
      .toVar();
    const sampledLightVolume = uLightVolume.sample(lightVolumeCoordClamped).rgb;
    const torchLight = sampledLightVolume
      .mul(insideMask)
      .add(smoothTorch.mul(1.2))
      .toVar();

    const ambientOcclusion = mix(0.5, 1.0, shadow).toVar();
    const tunnelDarkening = sunExposure.mul(sunExposure).toVar();

    const hemisphereBlend = vWorldNormal.y.mul(0.5).add(0.5);
    const groundColor = uAmbientColor.mul(0.4).toVar();
    const skyAmbient = mix(groundColor, uAmbientColor, hemisphereBlend).toVar();

    const texLuma = dot(diffuseColor, vec3(0.2126, 0.7152, 0.0722)).toVar();
    const isBrightTex = smoothstep(0.75, 0.95, texLuma).toVar();

    const effectiveIsFluid = max(isFluidFromLight, uMaterialFluid).toVar();
    const aoFactor = mix(
      unpackedAoFactor,
      1.0,
      effectiveIsFluid.mul(0.8),
    ).toVar();
    const torchDominance = torchBrightness
      .div(torchBrightness.add(dot(sunContribution, vec3(0.33))).add(0.01))
      .toVar();
    const torchAOReduction = torchDominance.mul(0.3).toVar();
    const enhancedAO = mix(aoFactor, 1.0, torchAOReduction).toVar();

    const sunTotal = skyAmbient
      .mul(ambientOcclusion)
      .mul(tunnelDarkening)
      .toVar();
    sunTotal.addAssign(sunContribution.mul(mix(1.0, 0.7, isBrightTex)));

    const totalLight = vec3(1.0)
      .sub(vec3(1.0).sub(sunTotal).mul(vec3(1.0).sub(torchLight)))
      .toVar();
    const warmTint = vec3(1.05, 0.92, 0.75);
    const coolTint = vec3(0.92, 0.95, 1.05);
    const temperatureShift = mix(coolTint, warmTint, torchDominance);
    totalLight.assign(totalLight.mul(temperatureShift));
    totalLight.assign(totalLight.mul(enhancedAO));

    const caustics = createCausticsNode({
      worldPosition: vWorldPosition,
      isFluid: effectiveIsFluid,
      waterLevel: uWaterLevel,
      time: uTime,
      shadow,
      sunlightIntensity: uSunlightIntensity,
      noiseFn: simplexNoise3dFn,
    });
    totalLight.addAssign(caustics);

    const toneMappedLight = totalLight
      .mul(totalLight.mul(2.51).add(0.03))
      .div(totalLight.mul(totalLight.mul(2.43).add(0.59)).add(0.14))
      .toVar();
    const outgoingLight = diffuseColor.mul(toneMappedLight).toVar();

    outgoingLight.assign(
      createWaterNode({
        outgoingLight,
        worldPosition: vWorldPosition,
        worldNormal: vWorldNormal,
        isFluid: effectiveIsFluid,
        time: uTime,
        waterTint: uWaterTint,
        waterAbsorption: uWaterAbsorption,
        waterLevel: uWaterLevel,
        skyTopColor: uSkyTopColor,
        skyMiddleColor: uSkyMiddleColor,
        sunDirection: uSunDirection,
        sunColor: uSunColor,
        sunlightIntensity: uSunlightIntensity,
        shadow,
        noiseFn: simplexNoise3dFn,
      }),
    );

    const fogNode = createFogNode({
      worldPosition: vWorldPosition,
      cameraPosition,
      fogColor: uFogColor,
      fogNear: uFogNear,
      fogFar: uFogFar,
      fogHeightOrigin: uFogHeightOrigin,
      fogHeightDensity: uFogHeightDensity,
    });
    const foggedColor = fogNode(outgoingLight).toVar();

    const mode1 = step(0.5, uShadowDebugMode).mul(
      float(1.0).sub(step(1.5, uShadowDebugMode)),
    );
    const mode2 = step(1.5, uShadowDebugMode).mul(
      float(1.0).sub(step(2.5, uShadowDebugMode)),
    );
    const mode3 = step(2.5, uShadowDebugMode).mul(
      float(1.0).sub(step(3.5, uShadowDebugMode)),
    );
    const mode4 = step(3.5, uShadowDebugMode).mul(
      float(1.0).sub(step(4.5, uShadowDebugMode)),
    );
    const mode5 = step(4.5, uShadowDebugMode).mul(
      float(1.0).sub(step(5.5, uShadowDebugMode)),
    );
    const mode6 = step(5.5, uShadowDebugMode).mul(
      float(1.0).sub(step(6.5, uShadowDebugMode)),
    );
    const mode7 = step(6.5, uShadowDebugMode).mul(
      float(1.0).sub(step(7.5, uShadowDebugMode)),
    );

    const inCascade0 = step(vViewDepth, uCascadeSplit0);
    const inCascade1 = float(1.0)
      .sub(inCascade0)
      .mul(step(vViewDepth, uCascadeSplit1));
    const inCascade2 = float(1.0)
      .sub(inCascade0)
      .sub(inCascade1)
      .mul(step(vViewDepth, uCascadeSplit2));
    const inCascade3 = float(1.0)
      .sub(inCascade0)
      .sub(inCascade1)
      .sub(inCascade2);
    const cascadeColor = vec3(1.0, 0.0, 0.0)
      .mul(inCascade0)
      .add(vec3(0.0, 1.0, 0.0).mul(inCascade1))
      .add(vec3(0.0, 0.0, 1.0).mul(inCascade2))
      .add(vec3(1.0, 1.0, 0.0).mul(inCascade3));

    const slopeBiasDebug = max(
      float(0.005).mul(float(1.0).sub(rawNdotL)),
      0.001,
    );

    const debugColor = vec3(0.0)
      .add(vec3(shadow).mul(mode1))
      .add(vec3(max(rawNdotL, 0.0)).mul(mode2))
      .add(vec3(aoFactor).mul(mode3))
      .add(cascadeColor.mul(mode4))
      .add(vec3(slopeBiasDebug.mul(100.0)).mul(mode5))
      .add(vec3(sunExposure).mul(mode6))
      .add(vec3(tunnelDarkening).mul(mode7))
      .toVar();
    const debugMask = mode1
      .add(mode2)
      .add(mode3)
      .add(mode4)
      .add(mode5)
      .add(mode6)
      .add(mode7)
      .toVar();
    const finalColor = mix(foggedColor, debugColor, debugMask);
    return finalColor;
  })();

  const alpha = sampledDiffuse.a;

  const material = new MeshBasicNodeMaterial();
  material.map = atlas;
  material.transparent = transparent;
  material.positionNode = positionLocal.add(vec3(0.0, waveOffset, 0.0));
  material.colorNode = fragmentOutput;
  material.opacityNode = alpha;
  material.outputNode = vec4(fragmentOutput, alpha);

  return material;
}
