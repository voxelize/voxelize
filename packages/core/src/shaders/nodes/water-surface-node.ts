import {
  Fn,
  float,
  vec3,
  normalize,
  max,
  pow,
  clamp,
  mix,
  exp,
  dot,
  reflect,
  step,
  cameraPosition,
} from "three/tsl";

import { simplexNoise3d } from "./simplex-noise-node";

type NodeRef = ReturnType<typeof float>;

export const waterNormalNode = /* @__PURE__ */ Fn(
  ([worldPos, time, worldNormal]: [NodeRef, NodeRef, NodeRef]) => {
    const eps = float(0.08);
    const waveTime = time.mul(0.0005);

    const roughNoise = simplexNoise3d(
      vec3(
        worldPos.x.mul(0.04).sub(waveTime.mul(0.08)),
        worldPos.z.mul(0.04).add(waveTime.mul(0.06)),
        float(-10),
      ),
    );
    const roughMul = float(0.3).add(
      float(0.7).mul(roughNoise.mul(0.5).add(0.5)),
    );

    const swellTiltX = simplexNoise3d(
      vec3(
        worldPos.x.mul(0.05).add(waveTime.mul(0.07)),
        worldPos.z.mul(0.05).sub(waveTime.mul(0.05)),
        float(-5),
      ),
    ).mul(0.07);
    const swellTiltZ = simplexNoise3d(
      vec3(
        worldPos.x.mul(0.05).sub(waveTime.mul(0.04)),
        worldPos.z.mul(0.05).add(waveTime.mul(0.07)),
        float(-8),
      ),
    ).mul(0.07);

    const lg1 = simplexNoise3d(
      vec3(
        worldPos.x.mul(0.3).add(waveTime.mul(0.25)),
        worldPos.z.mul(0.3).sub(waveTime.mul(0.2)),
        float(0),
      ),
    );
    const lg1x = simplexNoise3d(
      vec3(
        worldPos.x.add(eps).mul(0.3).add(waveTime.mul(0.25)),
        worldPos.z.mul(0.3).sub(waveTime.mul(0.2)),
        float(0),
      ),
    );
    const lg1z = simplexNoise3d(
      vec3(
        worldPos.x.mul(0.3).add(waveTime.mul(0.25)),
        worldPos.z.add(eps).mul(0.3).sub(waveTime.mul(0.2)),
        float(0),
      ),
    );

    const md1 = simplexNoise3d(
      vec3(
        worldPos.x.mul(1.5).add(waveTime.mul(0.4)),
        worldPos.z.mul(1.5).sub(waveTime.mul(0.35)),
        float(5),
      ),
    );
    const md1x = simplexNoise3d(
      vec3(
        worldPos.x.add(eps).mul(1.5).add(waveTime.mul(0.4)),
        worldPos.z.mul(1.5).sub(waveTime.mul(0.35)),
        float(5),
      ),
    );
    const md1z = simplexNoise3d(
      vec3(
        worldPos.x.mul(1.5).add(waveTime.mul(0.4)),
        worldPos.z.add(eps).mul(1.5).sub(waveTime.mul(0.35)),
        float(5),
      ),
    );

    const hLg0 = lg1.mul(0.3);
    const hLgX = lg1x.mul(0.3);
    const hLgZ = lg1z.mul(0.3);
    const hMed0 = md1.mul(0.6).mul(roughMul);
    const hMedX = md1x.mul(0.6).mul(roughMul);
    const hMedZ = md1z.mul(0.6).mul(roughMul);

    const computed = normalize(
      vec3(
        swellTiltX.add(hLg0.sub(hLgX).mul(0.8)).add(hMed0.sub(hMedX).mul(1.2)),
        float(1),
        swellTiltZ.add(hLg0.sub(hLgZ).mul(0.8)).add(hMed0.sub(hMedZ).mul(1.2)),
      ),
    );

    const isTopFace = step(float(0.5), worldNormal.y);
    return mix(worldNormal, computed, isTopFace);
  },
);

export const waterSurfaceNode = /* @__PURE__ */ Fn(
  ([
    baseColor,
    worldPos,
    wNormal,
    sunDirection,
    sunColor,
    sunIntensity,
    skyTopColor,
    skyMiddleColor,
    waterTint,
    waterAbsorption,
    waterLevel,
  ]: [
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
  ]) => {
    const viewDir = normalize(cameraPosition.sub(worldPos));
    const NdotV = max(dot(wNormal, viewDir), float(0));
    const rawFresnel = float(0.02).add(
      float(0.6).mul(pow(float(1).sub(NdotV), float(4))),
    );
    const fresnel = clamp(rawFresnel, float(0.02), float(0.55));

    const reflectDir = reflect(viewDir.negate(), wNormal);
    const skyBlend = clamp(reflectDir.y.mul(0.5).add(0.5), float(0), float(1));
    const skyReflection = mix(skyMiddleColor, skyTopColor, skyBlend);

    const halfVec = normalize(sunDirection.add(viewDir));
    const specAngle = max(dot(wNormal, halfVec), float(0));
    let spec = specAngle.mul(specAngle);
    spec = spec.mul(spec);
    spec = spec.mul(spec);
    spec = spec.mul(spec);
    spec = spec.mul(spec);
    const specMed = spec
      .mul(spec)
      .mul(spec)
      .mul(spec)
      .mul(sunIntensity)
      .mul(0.6);
    const specSharp = specMed
      .mul(specMed)
      .mul(specMed)
      .mul(specMed)
      .mul(sunIntensity)
      .mul(1.5);
    const specularColor = sunColor.mul(
      spec.mul(sunIntensity).mul(0.3).add(specMed).add(specSharp),
    );

    const distToCamera = cameraPosition.sub(worldPos).length();
    const depthFactor = float(1).sub(exp(distToCamera.negate().mul(0.008)));
    const waterColor = baseColor.mul(
      mix(vec3(1), waterTint, float(0.08).add(depthFactor.mul(0.12))),
    );

    const waterDepth = max(float(0), waterLevel.sub(worldPos.y));
    const absorption = vec3(0.025, 0.012, 0.004);

    return mix(waterColor, skyReflection, fresnel)
      .add(specularColor)
      .mul(exp(absorption.negate().mul(waterDepth).mul(waterAbsorption)));
  },
);
