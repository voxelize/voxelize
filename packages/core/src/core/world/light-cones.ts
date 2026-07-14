import { Color, MathUtils, Vector3, Vector4 } from "three";

import { WATER_VIEW_EXTINCTION_GLSL } from "./water-optics";

/**
 * Engine-side budget and falloff shaping for dynamic spot-light cones
 * (flashlights, vehicle headlights). The cone list is rebuilt every frame by
 * the game; shaders iterate a small fixed array so the cost stays flat.
 */
export const LIGHT_CONES = Object.freeze({
  /**
   * Hard cap on simultaneous cones. Three covers the intended loadout: the
   * local player's flashlight plus one submarine's two headlights. Extra
   * emitters beyond the budget are dropped nearest-first by the game driver.
   */
  maxCones: 3,

  /**
   * Fixed sample count of the per-cone in-scattering estimate along the view
   * ray. Four smooth samples read as a continuous volumetric beam without a
   * real ray march.
   */
  scatterSamples: 4,

  /**
   * Wrap term of the diffuse response inside the cone, so surfaces facing
   * away from the beam still catch a rim of light instead of clipping black.
   */
  lambertWrap: 0.25,

  /** Numerical guard for angular falloff denominators. */
  minCosDelta: 1e-3,
});

const MAX = LIGHT_CONES.maxCones;

export const LIGHT_CONES_UNIFORM_DECLARATIONS = `
uniform int uConeCount;
uniform vec4 uConeOrigins[${MAX}];
uniform vec3 uConeDirections[${MAX}];
uniform vec3 uConeColors[${MAX}];
uniform vec4 uConeShapes[${MAX}];
`;

/**
 * Shared per-cone response: quadratic angular falloff between the inner and
 * outer cone, squared-quadratic distance falloff to zero at range, and
 * Beer-Lambert extinction from the cone origin scaled by the origin's
 * submersion so underwater beams die out physically while dry beams carry.
 *
 * uConeOrigins[i] = (origin.xyz, submersion); uConeShapes[i] =
 * (cosOuter, 1/(cosInner-cosOuter), range, scatterStrength).
 */
export const LIGHT_CONES_FUNCTIONS = `
vec3 lightConeSurface(vec3 lcPoint, vec3 lcNormal) {
  vec3 lcTotal = vec3(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uConeCount) break;
    vec3 lcToPoint = lcPoint - uConeOrigins[i].xyz;
    float lcDist = length(lcToPoint);
    vec4 lcShape = uConeShapes[i];
    if (lcDist >= lcShape.z || lcDist < 1e-4) continue;
    vec3 lcL = lcToPoint / lcDist;
    float lcAngular = clamp((dot(lcL, uConeDirections[i]) - lcShape.x) * lcShape.y, 0.0, 1.0);
    lcAngular *= lcAngular;
    float lcNorm = lcDist / lcShape.z;
    float lcFall = 1.0 - lcNorm * lcNorm;
    lcFall *= lcFall;
    float lcLambert = max(dot(lcNormal, -lcL), 0.0) * ${(
      1 - LIGHT_CONES.lambertWrap
    ).toFixed(4)} + ${LIGHT_CONES.lambertWrap.toFixed(4)};
    vec3 lcTransmit = exp(-${WATER_VIEW_EXTINCTION_GLSL} * lcDist * uConeOrigins[i].w);
    lcTotal += uConeColors[i] * (lcAngular * lcFall * lcLambert) * lcTransmit;
  }
  return lcTotal;
}

vec3 lightConeScatter(vec3 lcCam, vec3 lcRayDir, float lcFragDist) {
  vec3 lcTotal = vec3(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uConeCount) break;
    vec4 lcShape = uConeShapes[i];
    float lcStrength = lcShape.w * uConeOrigins[i].w;
    if (lcStrength <= 0.0) continue;
    vec3 lcOrigin = uConeOrigins[i].xyz;
    float lcMax = min(lcFragDist, distance(lcCam, lcOrigin) + lcShape.z);
    if (lcMax <= 0.0) continue;
    float lcStep = lcMax / ${LIGHT_CONES.scatterSamples.toFixed(1)};
    vec3 lcSum = vec3(0.0);
    for (int k = 0; k < ${LIGHT_CONES.scatterSamples}; k++) {
      float lcT = (float(k) + 0.5) * lcStep;
      vec3 lcSample = lcCam + lcRayDir * lcT;
      vec3 lcToSample = lcSample - lcOrigin;
      float lcAxial = length(lcToSample);
      if (lcAxial < 1e-3 || lcAxial >= lcShape.z) continue;
      float lcAngular = clamp((dot(lcToSample / lcAxial, uConeDirections[i]) - lcShape.x) * lcShape.y, 0.0, 1.0);
      lcAngular *= lcAngular;
      float lcNorm = lcAxial / lcShape.z;
      float lcFall = 1.0 - lcNorm * lcNorm;
      lcFall *= lcFall;
      lcSum += exp(-${WATER_VIEW_EXTINCTION_GLSL} * (lcAxial + lcT)) * (lcAngular * lcFall);
    }
    lcTotal += uConeColors[i] * lcSum * (lcStrength * lcStep);
  }
  return lcTotal;
}
`;

/**
 * Adds the in-scattered beam glow after fog. Expects `vWorldPosition`,
 * `cameraPosition`, and `gl_FragColor` in scope. Scatter strength is scaled
 * by each cone's submersion, so beams only bloom in the murk; in air the
 * cone remains a pure surface light.
 */
export const LIGHT_CONES_SCATTER_FRAGMENT = `
if (uConeCount > 0) {
  vec3 lcViewRay = vWorldPosition.xyz - cameraPosition;
  float lcViewDist = max(length(lcViewRay), 1e-4);
  gl_FragColor.rgb += lightConeScatter(cameraPosition, lcViewRay / lcViewDist, lcViewDist);
}
`;

export type LightConeInput = {
  origin: Vector3;
  direction: Vector3;
  color: Color;
  intensity: number;
  /** Full outer cone angle in degrees. */
  angleDeg: number;
  /** Inner (full-brightness) cone angle as a fraction of the outer angle. */
  innerRatio: number;
  range: number;
  scatterStrength: number;
  /** 0 above water to 1 submerged; drives extinction and beam glow. */
  submersion: number;
};

export type LightConeUniforms = {
  coneCount: { value: number };
  coneOrigins: { value: Vector4[] };
  coneDirections: { value: Vector3[] };
  coneColors: { value: Color[] };
  coneShapes: { value: Vector4[] };
};

export type LightConeUniformBinding =
  LightConeUniforms[keyof LightConeUniforms];

/**
 * Owns the shared cone uniform storage. The game clears and refills it every
 * frame (`beginFrame` + `pushCone`); every material that binds
 * {@link LightCones.uniformBindings} sees the same values with zero copying.
 */
export class LightCones {
  public readonly uniforms: LightConeUniforms = {
    coneCount: { value: 0 },
    coneOrigins: {
      value: Array.from({ length: MAX }, () => new Vector4(0, 0, 0, 0)),
    },
    coneDirections: {
      value: Array.from({ length: MAX }, () => new Vector3(0, 0, 1)),
    },
    coneColors: {
      value: Array.from({ length: MAX }, () => new Color(0, 0, 0)),
    },
    coneShapes: {
      value: Array.from({ length: MAX }, () => new Vector4(1, 1, 1, 0)),
    },
  };

  get uniformBindings(): Record<string, LightConeUniformBinding> {
    return {
      uConeCount: this.uniforms.coneCount,
      uConeOrigins: this.uniforms.coneOrigins,
      uConeDirections: this.uniforms.coneDirections,
      uConeColors: this.uniforms.coneColors,
      uConeShapes: this.uniforms.coneShapes,
    };
  }

  beginFrame(): void {
    this.uniforms.coneCount.value = 0;
  }

  pushCone(input: LightConeInput): boolean {
    const index = this.uniforms.coneCount.value;
    if (index >= MAX) return false;

    const halfOuter = MathUtils.degToRad(input.angleDeg / 2);
    const cosOuter = Math.cos(halfOuter);
    const cosInner = Math.cos(
      halfOuter * MathUtils.clamp(input.innerRatio, 0, 1),
    );
    const invCosDelta =
      1 / Math.max(cosInner - cosOuter, LIGHT_CONES.minCosDelta);

    this.uniforms.coneOrigins.value[index].set(
      input.origin.x,
      input.origin.y,
      input.origin.z,
      MathUtils.clamp(input.submersion, 0, 1),
    );
    this.uniforms.coneDirections.value[index].copy(input.direction).normalize();
    this.uniforms.coneColors.value[index]
      .copy(input.color)
      .multiplyScalar(input.intensity);
    this.uniforms.coneShapes.value[index].set(
      cosOuter,
      invCosDelta,
      Math.max(input.range, 1e-3),
      input.scatterStrength,
    );

    this.uniforms.coneCount.value = index + 1;
    return true;
  }
}
