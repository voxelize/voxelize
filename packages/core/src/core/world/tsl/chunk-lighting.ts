import { exp, float, mix, pow, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

export function applyDefaultLighting(params: {
  outgoingLight: Node;
  lightVec4: Node;
  ao: Node;
  isFluid: Node;
  sunlightIntensity: Node;
  minLightLevel: Node;
  baseAmbient: Node;
  lightIntensityAdjustment: Node;
}): Node {
  const {
    outgoingLight,
    lightVec4,
    ao,
    isFluid,
    sunlightIntensity,
    minLightLevel,
    baseAmbient,
    lightIntensityAdjustment,
  } = params;

  const sunlightFactor = lightVec4.a
    .mul(lightVec4.a)
    .mul(sunlightIntensity)
    .mul(lightIntensityAdjustment);

  const s = sunlightFactor
    .add(minLightLevel.mul(lightVec4.a))
    .add(baseAmbient)
    .clamp(0.0, 1.0);

  const sCorrected = s.sub(s.mul(exp(s.negate())).mul(0.02));

  const torchLight = pow(
    lightVec4.rgb.mul(lightIntensityAdjustment),
    vec3(2.0),
  );
  const torchAttenuation = float(1.0).sub(sCorrected.mul(0.8));
  const combinedLight = vec3(sCorrected).add(torchLight.mul(torchAttenuation));

  const lit = outgoingLight.rgb.mul(combinedLight);
  const aoFactor = mix(ao, float(1.0), isFluid.mul(0.8));

  return lit.mul(aoFactor);
}
