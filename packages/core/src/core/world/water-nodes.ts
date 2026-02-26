import type { Color, Vector3 } from "three";
import {
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  length,
  max,
  mix,
  normalize,
  pow,
  step,
  vec2,
  vec3,
} from "three/tsl";
import type { Node, ShaderNodeObject, UniformNode } from "three/tsl";

export function createWaterNode(params: {
  outgoingLight: ShaderNodeObject<Node>;
  worldPosition: ShaderNodeObject<Node>;
  worldNormal: ShaderNodeObject<Node>;
  isFluid: ShaderNodeObject<Node>;
  time: ShaderNodeObject<UniformNode<number>>;
  waterTint: ShaderNodeObject<UniformNode<Color>>;
  waterAbsorption: ShaderNodeObject<UniformNode<number>>;
  waterLevel: ShaderNodeObject<UniformNode<number>>;
  skyTopColor: ShaderNodeObject<UniformNode<Color>>;
  skyMiddleColor: ShaderNodeObject<UniformNode<Color>>;
  sunDirection: ShaderNodeObject<UniformNode<Vector3>>;
  sunColor: ShaderNodeObject<UniformNode<Color>>;
  sunlightIntensity: ShaderNodeObject<UniformNode<number>>;
  shadow: ShaderNodeObject<Node>;
  noiseFn: (pos: ShaderNodeObject<Node>) => ShaderNodeObject<Node>;
}): ShaderNodeObject<Node> {
  const {
    outgoingLight,
    worldPosition,
    worldNormal,
    isFluid,
    time,
    waterTint,
    waterAbsorption,
    waterLevel,
    skyTopColor,
    skyMiddleColor,
    sunDirection,
    sunColor,
    sunlightIntensity,
    noiseFn,
  } = params;

  const baseOutgoing = vec3(outgoingLight).toVar();
  const wPos = vec3(worldPosition).toVar();
  const surfaceNormal = vec3(worldNormal).toVar();
  const waveTime = time.mul(0.0005).toVar();
  const eps = float(0.08);

  const roughNoise = noiseFn(
    vec3(
      wPos.x.mul(0.04).sub(waveTime.mul(0.08)),
      wPos.z.mul(0.04).add(waveTime.mul(0.06)),
      -10.0,
    ),
  ).toVar();
  const roughMul = roughNoise.mul(0.5).add(0.5).mul(0.7).add(0.3).toVar();

  const swellTiltX = noiseFn(
    vec3(
      wPos.x.mul(0.05).add(waveTime.mul(0.07)),
      wPos.z.mul(0.05).sub(waveTime.mul(0.05)),
      -5.0,
    ),
  )
    .mul(0.07)
    .toVar();
  const swellTiltZ = noiseFn(
    vec3(
      wPos.x.mul(0.05).sub(waveTime.mul(0.04)),
      wPos.z.mul(0.05).add(waveTime.mul(0.07)),
      -8.0,
    ),
  )
    .mul(0.07)
    .toVar();

  const lg1 = noiseFn(
    vec3(
      wPos.x.mul(0.3).add(waveTime.mul(0.25)),
      wPos.z.mul(0.3).sub(waveTime.mul(0.2)),
      0.0,
    ),
  ).toVar();
  const lg1x = noiseFn(
    vec3(
      wPos.x.add(eps).mul(0.3).add(waveTime.mul(0.25)),
      wPos.z.mul(0.3).sub(waveTime.mul(0.2)),
      0.0,
    ),
  ).toVar();
  const lg1z = noiseFn(
    vec3(
      wPos.x.mul(0.3).add(waveTime.mul(0.25)),
      wPos.z.add(eps).mul(0.3).sub(waveTime.mul(0.2)),
      0.0,
    ),
  ).toVar();

  const md1 = noiseFn(
    vec3(
      wPos.x.mul(1.5).add(waveTime.mul(0.4)),
      wPos.z.mul(1.5).sub(waveTime.mul(0.35)),
      5.0,
    ),
  ).toVar();
  const md1x = noiseFn(
    vec3(
      wPos.x.add(eps).mul(1.5).add(waveTime.mul(0.4)),
      wPos.z.mul(1.5).sub(waveTime.mul(0.35)),
      5.0,
    ),
  ).toVar();
  const md1z = noiseFn(
    vec3(
      wPos.x.mul(1.5).add(waveTime.mul(0.4)),
      wPos.z.add(eps).mul(1.5).sub(waveTime.mul(0.35)),
      5.0,
    ),
  ).toVar();

  const hLg0 = lg1.mul(0.3).toVar();
  const hLgX = lg1x.mul(0.3).toVar();
  const hLgZ = lg1z.mul(0.3).toVar();

  const hMed0 = md1.mul(0.6).mul(roughMul).toVar();
  const hMedX = md1x.mul(0.6).mul(roughMul).toVar();
  const hMedZ = md1z.mul(0.6).mul(roughMul).toVar();

  const proceduralNormal = normalize(
    vec3(
      swellTiltX.add(hLg0.sub(hLgX).mul(0.8)).add(hMed0.sub(hMedX).mul(1.2)),
      1.0,
      swellTiltZ.add(hLg0.sub(hLgZ).mul(0.8)).add(hMed0.sub(hMedZ).mul(1.2)),
    ),
  ).toVar();

  const topFaceMask = step(0.5, surfaceNormal.y);
  const waterNormal = mix(surfaceNormal, proceduralNormal, topFaceMask).toVar();

  const viewDir = normalize(cameraPosition.sub(wPos)).toVar();
  const ndotv = max(dot(waterNormal, viewDir), 0.0).toVar();
  const fresnel = clamp(
    float(0.02).add(float(0.6).mul(pow(float(1.0).sub(ndotv), 4.0))),
    0.02,
    0.55,
  ).toVar();

  const incident = viewDir.mul(-1.0).toVar();
  const reflectDir = incident
    .sub(waterNormal.mul(dot(waterNormal, incident).mul(2.0)))
    .toVar();
  const skyBlend = clamp(reflectDir.y.mul(0.5).add(0.5), 0.0, 1.0).toVar();
  const skyReflection = mix(skyMiddleColor, skyTopColor, skyBlend).toVar();

  const halfVec = normalize(sunDirection.add(viewDir)).toVar();
  const specAngle = max(dot(waterNormal, halfVec), 0.0).toVar();
  const spec32 = specAngle.mul(specAngle).toVar();
  spec32.assign(spec32.mul(spec32));
  spec32.assign(spec32.mul(spec32));
  spec32.assign(spec32.mul(spec32));
  spec32.assign(spec32.mul(spec32));

  const specMed = spec32
    .mul(spec32)
    .mul(spec32)
    .mul(spec32)
    .mul(sunlightIntensity)
    .mul(0.6)
    .toVar();
  const specSharp = specMed
    .mul(specMed)
    .mul(specMed)
    .mul(specMed)
    .mul(sunlightIntensity)
    .mul(1.5)
    .toVar();
  const specularColor = sunColor
    .mul(spec32.mul(sunlightIntensity).mul(0.3).add(specMed).add(specSharp))
    .toVar();

  const distToCamera = length(cameraPosition.sub(wPos)).toVar();
  const depthFactor = float(1.0)
    .sub(exp(distToCamera.mul(-0.008)))
    .toVar();
  const waterColor = baseOutgoing
    .mul(mix(vec3(1.0), waterTint, float(0.08).add(depthFactor.mul(0.12))))
    .toVar();

  const shadedWater = mix(waterColor, skyReflection, fresnel)
    .add(specularColor)
    .toVar();
  const waterDepth = max(float(0.0), waterLevel.sub(wPos.y)).toVar();
  const absorption = vec3(0.025, 0.012, 0.004);
  shadedWater.assign(
    shadedWater.mul(
      exp(absorption.mul(waterDepth).mul(waterAbsorption).mul(-1.0)),
    ),
  );

  const fluidMask = step(0.5, isFluid);
  return mix(baseOutgoing, shadedWater, fluidMask);
}

export function createCausticsNode(params: {
  worldPosition: ShaderNodeObject<Node>;
  isFluid: ShaderNodeObject<Node>;
  waterLevel: ShaderNodeObject<UniformNode<number>>;
  time: ShaderNodeObject<UniformNode<number>>;
  shadow: ShaderNodeObject<Node>;
  sunlightIntensity: ShaderNodeObject<UniformNode<number>>;
  noiseFn: (pos: ShaderNodeObject<Node>) => ShaderNodeObject<Node>;
}): ShaderNodeObject<Node> {
  const {
    worldPosition,
    isFluid,
    waterLevel,
    time,
    shadow,
    sunlightIntensity,
    noiseFn,
  } = params;

  const wPos = vec3(worldPosition).toVar();
  const causticsTime = time.mul(0.0003).toVar();
  const waterDepth = waterLevel.sub(wPos.y).toVar();
  const depthFade = exp(waterDepth.mul(-0.15)).toVar();

  const c1 = noiseFn(
    vec3(
      wPos.xz.mul(0.3).add(vec2(causticsTime.mul(0.4), causticsTime.mul(0.4))),
      causticsTime,
    ),
  ).toVar();
  const c2 = noiseFn(
    vec3(
      wPos.xz.mul(0.5).sub(vec2(causticsTime.mul(0.3), causticsTime.mul(0.3))),
      causticsTime.mul(1.3).add(5.0),
    ),
  ).toVar();
  const caustic = c1.mul(c1).add(c2.mul(c2)).mul(0.5).toVar();

  const causticStrength = depthFade
    .mul(shadow)
    .mul(sunlightIntensity)
    .mul(0.25)
    .toVar();

  const belowWaterMask = step(wPos.y, waterLevel);
  const nonFluidMask = float(1.0).sub(step(0.5, isFluid));
  const activeMask = belowWaterMask.mul(nonFluidMask).toVar();

  return vec3(caustic.mul(causticStrength).mul(activeMask));
}
