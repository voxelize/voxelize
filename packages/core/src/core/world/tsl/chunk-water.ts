import {
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  If,
  length,
  max,
  mix,
  normalize,
  pow,
  reflect,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";

import { snoise } from "./noise";

export function applyUnderwaterCaustics(params: {
  totalLight: Node;
  worldPosition: Node;
  isFluid: Node;
  waterLevel: Node;
  time: Node;
  shadow: Node;
  sunlightIntensity: Node;
}): Node {
  const {
    totalLight,
    worldPosition,
    isFluid,
    waterLevel,
    time,
    shadow,
    sunlightIntensity,
  } = params;

  const result = vec3(totalLight).toVar();

  If(worldPosition.y.lessThan(waterLevel).and(isFluid.lessThan(0.5)), () => {
    const causticsTime = time.mul(0.0003);
    const waterDepth = waterLevel.sub(worldPosition.y);
    const depthFade = exp(waterDepth.mul(-0.15));

    const c1 = snoise(
      vec3(worldPosition.xz.mul(0.3).add(causticsTime.mul(0.4)), causticsTime),
    );
    const c2 = snoise(
      vec3(
        worldPosition.xz.mul(0.5).sub(causticsTime.mul(0.3)),
        causticsTime.mul(1.3).add(5.0),
      ),
    );
    const caustic = c1.mul(c1).add(c2.mul(c2)).mul(0.5);
    const causticStrength = depthFade
      .mul(shadow)
      .mul(sunlightIntensity)
      .mul(0.25);

    result.addAssign(vec3(caustic.mul(causticStrength)));
  });

  return result;
}

export function applyWaterSurface(params: {
  outgoingLight: Node;
  worldPosition: Node;
  worldNormal: Node;
  isFluid: Node;
  waterLevel: Node;
  waterTint: Node;
  waterAbsorption: Node;
  sunDirection: Node;
  sunColor: Node;
  sunlightIntensity: Node;
  skyTopColor: Node;
  skyMiddleColor: Node;
  time: Node;
}): Node {
  const {
    outgoingLight,
    worldPosition,
    worldNormal,
    isFluid,
    waterLevel,
    waterTint,
    waterAbsorption,
    sunDirection,
    sunColor,
    sunlightIntensity,
    skyTopColor,
    skyMiddleColor,
    time,
  } = params;

  const result = vec3(outgoingLight).toVar();

  If(isFluid.greaterThan(0.5), () => {
    const waveTime = time.mul(0.0005);
    const wPos = worldPosition.xyz;
    const eps = float(0.08);

    const roughNoise = snoise(
      vec3(
        wPos.x.mul(0.04).sub(waveTime.mul(0.08)),
        wPos.z.mul(0.04).add(waveTime.mul(0.06)),
        float(-10.0),
      ),
    );
    const roughMul = float(0.3).add(
      float(0.7).mul(roughNoise.mul(0.5).add(0.5)),
    );

    const swellTiltX = snoise(
      vec3(
        wPos.x.mul(0.05).add(waveTime.mul(0.07)),
        wPos.z.mul(0.05).sub(waveTime.mul(0.05)),
        float(-5.0),
      ),
    ).mul(0.07);
    const swellTiltZ = snoise(
      vec3(
        wPos.x.mul(0.05).sub(waveTime.mul(0.04)),
        wPos.z.mul(0.05).add(waveTime.mul(0.07)),
        float(-8.0),
      ),
    ).mul(0.07);

    const lg1 = snoise(
      vec3(
        wPos.x.mul(0.3).add(waveTime.mul(0.25)),
        wPos.z.mul(0.3).sub(waveTime.mul(0.2)),
        float(0.0),
      ),
    );
    const lg1x = snoise(
      vec3(
        wPos.x.add(eps).mul(0.3).add(waveTime.mul(0.25)),
        wPos.z.mul(0.3).sub(waveTime.mul(0.2)),
        float(0.0),
      ),
    );
    const lg1z = snoise(
      vec3(
        wPos.x.mul(0.3).add(waveTime.mul(0.25)),
        wPos.z.add(eps).mul(0.3).sub(waveTime.mul(0.2)),
        float(0.0),
      ),
    );

    const md1 = snoise(
      vec3(
        wPos.x.mul(1.5).add(waveTime.mul(0.4)),
        wPos.z.mul(1.5).sub(waveTime.mul(0.35)),
        float(5.0),
      ),
    );
    const md1x = snoise(
      vec3(
        wPos.x.add(eps).mul(1.5).add(waveTime.mul(0.4)),
        wPos.z.mul(1.5).sub(waveTime.mul(0.35)),
        float(5.0),
      ),
    );
    const md1z = snoise(
      vec3(
        wPos.x.mul(1.5).add(waveTime.mul(0.4)),
        wPos.z.add(eps).mul(1.5).sub(waveTime.mul(0.35)),
        float(5.0),
      ),
    );

    const hLg0 = lg1.mul(0.3);
    const hLgX = lg1x.mul(0.3);
    const hLgZ = lg1z.mul(0.3);

    const hMed0 = md1.mul(0.6).mul(roughMul);
    const hMedX = md1x.mul(0.6).mul(roughMul);
    const hMedZ = md1z.mul(0.6).mul(roughMul);

    const waterNormal = normalize(
      vec3(
        swellTiltX.add(hLg0.sub(hLgX).mul(0.8)).add(hMed0.sub(hMedX).mul(1.2)),
        1.0,
        swellTiltZ.add(hLg0.sub(hLgZ).mul(0.8)).add(hMed0.sub(hMedZ).mul(1.2)),
      ),
    ).toVar();

    If(worldNormal.y.lessThan(0.5), () => {
      waterNormal.assign(worldNormal);
    });

    const viewDir = normalize(cameraPosition.sub(wPos));
    const nDotV = max(dot(waterNormal, viewDir), 0.0);
    const fresnel = clamp(
      float(0.02).add(float(0.6).mul(pow(float(1.0).sub(nDotV), 4.0))),
      0.02,
      0.55,
    );

    const reflectDir = reflect(viewDir.negate(), waterNormal);
    const skyBlend = clamp(reflectDir.y.mul(0.5).add(0.5), 0.0, 1.0);
    const skyReflection = mix(skyMiddleColor, skyTopColor, skyBlend);

    const halfVec = normalize(sunDirection.add(viewDir));
    const specAngle = max(dot(waterNormal, halfVec), 0.0);
    const spec32 = specAngle.mul(specAngle).toVar();
    spec32.mulAssign(spec32);
    spec32.mulAssign(spec32);
    spec32.mulAssign(spec32);
    spec32.mulAssign(spec32);
    const specMed = spec32
      .mul(spec32)
      .mul(spec32)
      .mul(spec32)
      .mul(sunlightIntensity)
      .mul(0.6);
    const specSharp = specMed
      .mul(specMed)
      .mul(specMed)
      .mul(specMed)
      .mul(sunlightIntensity)
      .mul(1.5);
    const specularColor = sunColor.mul(
      spec32.mul(sunlightIntensity).mul(0.3).add(specMed).add(specSharp),
    );

    const baseWater = vec3(result);
    const distToCamera = length(cameraPosition.sub(wPos));
    const depthFactor = float(1.0).sub(exp(distToCamera.mul(-0.008)));
    const waterColor = baseWater.mul(
      mix(
        vec3(1.0, 1.0, 1.0),
        waterTint,
        float(0.08).add(depthFactor.mul(0.12)),
      ),
    );

    result.assign(mix(waterColor, skyReflection, fresnel));
    result.addAssign(specularColor);

    const waterDepth = max(float(0.0), waterLevel.sub(worldPosition.y));
    const absorption = vec3(0.025, 0.012, 0.004);
    result.mulAssign(
      exp(absorption.negate().mul(waterDepth).mul(waterAbsorption)),
    );
  });

  return result;
}
