import { clamp, dot, float, max, min, mix, smoothstep, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

type TSLTexture = Node & {
  uv(uvNode: Node): Node;
};

export interface ShaderLitParams {
  outgoingLight: Node;
  diffuseColor: Node;
  worldPosition: Node;
  worldNormal: Node;
  lightVec4: Node;
  ao: Node;
  isFluid: Node;
  shadow: Node;
  sunDirection: Node;
  sunColor: Node;
  sunlightIntensity: Node;
  ambientColor: Node;
  lightVolume: Node;
  lightVolumeMin: Node;
  lightVolumeSize: Node;
}

interface ShaderLitResult {
  totalLight: Node;
  outgoingLight: Node;
  shadow: Node;
  sunExposure: Node;
  tunnelDarkening: Node;
}

function sampleLightVolume(
  worldPosition: Node,
  lightVolume: Node,
  lightVolumeMin: Node,
  lightVolumeSize: Node,
): Node {
  const coord = worldPosition.xyz.sub(lightVolumeMin).div(lightVolumeSize);
  const isInside = min(coord.x, min(coord.y, coord.z))
    .greaterThanEqual(0.0)
    .and(max(coord.x, max(coord.y, coord.z)).lessThanEqual(1.0));
  return (lightVolume as TSLTexture)
    .uv(clamp(coord, 0.0, 1.0))
    .rgb.mul(isInside.toFloat());
}

function acesTonemap(color: Node): Node {
  return color
    .mul(color.mul(2.51).add(0.03))
    .div(color.mul(color.mul(2.43).add(0.59)).add(0.14));
}

function computeCommonLighting(
  params: ShaderLitParams,
  sunContribution: Node,
): ShaderLitResult {
  const {
    outgoingLight,
    diffuseColor,
    worldPosition,
    worldNormal,
    lightVec4,
    ao,
    isFluid,
    shadow,
    sunlightIntensity,
    ambientColor,
    lightVolume,
    lightVolumeMin,
    lightVolumeSize,
  } = params;

  const sunExposure = lightVec4.a;
  const tunnelDarkening = sunExposure.mul(sunExposure);

  const cpuTorchLight = lightVec4.rgb;
  const smoothTorch = cpuTorchLight
    .mul(cpuTorchLight)
    .mul(vec3(3.0).sub(cpuTorchLight.mul(2.0)));
  const torchBrightness = max(max(smoothTorch.r, smoothTorch.g), smoothTorch.b);
  const volumeLight = sampleLightVolume(
    worldPosition,
    lightVolume,
    lightVolumeMin,
    lightVolumeSize,
  );
  const torchLight = volumeLight.add(smoothTorch.mul(1.2));

  const ambientOcclusion = mix(float(0.85), float(1.0), shadow);

  const hemisphereBlend = worldNormal.y.mul(0.5).add(0.5);
  const skyAmbient = mix(ambientColor.mul(0.4), ambientColor, hemisphereBlend);

  const texLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  const isBrightTex = smoothstep(float(0.75), float(0.95), texLuma);

  const aoFactor = mix(ao, float(1.0), isFluid.mul(0.8));
  const torchDominance = torchBrightness.div(
    torchBrightness.add(dot(sunContribution, vec3(0.33))).add(0.01),
  );
  const enhancedAO = mix(aoFactor, float(1.0), torchDominance.mul(0.08));

  const reducedSun = sunContribution.mul(
    mix(float(1.0), float(0.7), isBrightTex),
  );
  const bounceLight = ambientColor
    .mul(0.15)
    .mul(float(1.0).sub(shadow))
    .mul(sunExposure)
    .mul(sunlightIntensity);

  const sunTotal = skyAmbient
    .mul(ambientOcclusion)
    .mul(tunnelDarkening)
    .add(reducedSun)
    .add(bounceLight)
    .add(vec3(0.04, 0.045, 0.06));

  const screenBlend = vec3(1.0).sub(
    vec3(1.0).sub(sunTotal).mul(vec3(1.0).sub(torchLight)),
  );

  const temperatureShift = mix(
    vec3(0.92, 0.95, 1.05),
    vec3(1.05, 0.92, 0.75),
    torchDominance,
  );

  const totalLight = acesTonemap(
    screenBlend.mul(temperatureShift).mul(enhancedAO),
  );

  return {
    totalLight,
    outgoingLight: outgoingLight.rgb.mul(totalLight),
    shadow,
    sunExposure,
    tunnelDarkening,
  };
}

export function applyShaderLighting(params: ShaderLitParams): ShaderLitResult {
  const rawNdotL = dot(params.worldNormal, params.sunDirection);
  const ndotL = max(rawNdotL.mul(0.85).add(0.15), 0.0);
  const sunContribution = params.sunColor
    .mul(ndotL)
    .mul(params.shadow)
    .mul(params.sunlightIntensity)
    .mul(params.lightVec4.a);
  return computeCommonLighting(params, sunContribution);
}

export function applyShaderLightingCross(
  params: ShaderLitParams,
): ShaderLitResult {
  const sunExposure = params.lightVec4.a;
  const sunContribution = vec3(
    sunExposure.mul(sunExposure).mul(params.sunlightIntensity),
  );
  return computeCommonLighting(params, sunContribution);
}
