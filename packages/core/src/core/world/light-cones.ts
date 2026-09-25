import { Color, MathUtils, Vector3, Vector4 } from "three";

import { WATER_VIEW_EXTINCTION_GLSL } from "./water-optics";

/**
 * Engine-side budget and falloff shaping for dynamic spot-light cones
 * (flashlights, vehicle headlights). The cone list is rebuilt every frame by
 * the game; shaders iterate a small fixed array so the cost stays flat.
 */
export const LIGHT_CONES = Object.freeze({
  /**
   * Hard cap on simultaneous cones. Eight covers the intended loadout: the
   * local player's flashlight plus a scene's worth of mounted fixtures — or
   * nearby players' flashlights and one vehicle's two headlights. Emitters
   * beyond the budget are dropped farthest-first by the game driver. Raising
   * this is not free — the shader breaks out at the live cone count, so
   * empty scenes cost nothing extra, but every scattering cone adds
   * `scatterSamples` taps per fragment.
   */
  maxCones: 8,

  /**
   * Fixed sample count of the per-cone in-scattering estimate along the view
   * ray. Four smooth samples read as a continuous volumetric beam without a
   * real ray march.
   */
  scatterSamples: 4,

  /**
   * Default voxel-native look of the scattered beam, live in
   * {@link LIGHT_CONE_SCATTER_STYLE} as (texelsPerBlock, bands, ceiling):
   *
   * - `scatterTexelsPerBlock`: each scatter sample is moved to the centre of
   *   the texel cell it falls in (a 1/N-block grid) before the cone is
   *   evaluated, so the shaft's edges step on the block texel grid.
   * - `scatterBands`: each cone's scattered term is rounded to this many
   *   flat levels, evenly spaced in sqrt(term / ceiling). The sqrt spacing
   *   spans the ~20x gap between a dry beam and a submerged one with the
   *   same few steps, where linear steps would either erase dry shafts or
   *   merge wet ones into a single slab; the faintest tail rounds to zero.
   * - `scatterCeiling`: the most a cone's scattered term may add, as a
   *   fraction of the cone's own colour times intensity, so a submerged
   *   beam glows murky instead of whiting out. It is also the top band.
   */
  scatterTexelsPerBlock: 16,
  scatterBands: 4,
  scatterCeiling: 0.3,

  /**
   * Wrap term of the diffuse response inside the cone, so surfaces facing
   * away from the beam still catch a rim of light instead of clipping black.
   */
  lambertWrap: 0.25,

  /** Numerical guard for angular falloff denominators. */
  minCosDelta: 1e-3,
});

const MAX = LIGHT_CONES.maxCones;

/**
 * Live A/B switch for the scattered beam's look, shared by every material
 * that binds any {@link LightCones.uniformBindings} (one object, so a flip
 * reaches chunks and entity materials alike on the next draw):
 * (texelsPerBlock, bands, ceiling). Any component at 0 turns that step off;
 * `.set(0, 0, 0)` is the original smooth, uncapped beam.
 */
export const LIGHT_CONE_SCATTER_STYLE = {
  value: new Vector3(
    LIGHT_CONES.scatterTexelsPerBlock,
    LIGHT_CONES.scatterBands,
    LIGHT_CONES.scatterCeiling,
  ),
};

/**
 * One cone's scattered term under `style` (the shader's
 * `lightConeScatterStyled`, per channel peak), for tests and tooling.
 */
export function styleLightConeScatter(
  scatter: number,
  style: { x: number; y: number; z: number },
): number {
  if (style.y <= 0 && style.z <= 0) return scatter;
  if (scatter <= 0) return scatter;
  const top = style.z > 0 ? style.z : 1;
  let level = Math.min(scatter / top, 1);
  if (style.y > 0) {
    const step = Math.floor(Math.sqrt(level) * style.y + 0.5) / style.y;
    level = step * step;
  }
  return level * top;
}

export const LIGHT_CONES_UNIFORM_DECLARATIONS = `
uniform int uConeCount;
uniform vec4 uConeOrigins[${MAX}];
uniform vec3 uConeDirections[${MAX}];
uniform vec3 uConeColors[${MAX}];
uniform vec4 uConeShapes[${MAX}];
uniform vec3 uConeScatterStyle;
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

// Voxel-native styling of one cone's scattered term (uConeScatterStyle.y
// bands, .z ceiling): the brightest channel is capped at the ceiling and
// rounded to flat steps evenly spaced in sqrt(term / ceiling); the other
// channels keep their ratio to it, so water's red-first extinction still
// tints the shaft. With both at 0 the term passes through untouched.
vec3 lightConeScatterStyled(vec3 lcScatter) {
  float lcBands = uConeScatterStyle.y;
  float lcCeiling = uConeScatterStyle.z;
  if (lcBands <= 0.0 && lcCeiling <= 0.0) return lcScatter;
  float lcPeak = max(max(lcScatter.r, lcScatter.g), lcScatter.b);
  if (lcPeak <= 0.0) return lcScatter;
  float lcTop = lcCeiling > 0.0 ? lcCeiling : 1.0;
  float lcLevel = min(lcPeak / lcTop, 1.0);
  if (lcBands > 0.0) {
    float lcStepped = floor(sqrt(lcLevel) * lcBands + 0.5) / lcBands;
    lcLevel = lcStepped * lcStepped;
  }
  return lcScatter * (lcLevel * lcTop / lcPeak);
}

vec3 lightConeScatter(vec3 lcCam, vec3 lcRayDir, float lcFragDist) {
  vec3 lcTotal = vec3(0.0);
  // Texel grid the samples snap to, in cells per block (0 = unsnapped): each
  // sample is read at the centre of its cell. Pre-scaled so a snapped sample
  // costs a floor and a multiply-add over the unsnapped path.
  float lcSnap = uConeScatterStyle.x;
  float lcSnapInv = 1.0 / max(lcSnap, 1e-3);
  vec3 lcCamSnap = lcCam * lcSnap;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uConeCount) break;
    vec4 lcShape = uConeShapes[i];
    // Clear air scatters a few percent of what murky water does: enough to
    // see the shaft of a strong beam, nowhere near enough to white it out.
    float lcStrength = lcShape.w * mix(0.05, 1.0, uConeOrigins[i].w);
    if (lcStrength <= 0.0) continue;
    vec3 lcOrigin = uConeOrigins[i].xyz;
    float lcMax = min(lcFragDist, distance(lcCam, lcOrigin) + lcShape.z);
    if (lcMax <= 0.0) continue;
    float lcStep = lcMax / ${LIGHT_CONES.scatterSamples.toFixed(1)};
    vec3 lcSnapOffset = 0.5 * lcSnapInv - lcOrigin;
    vec3 lcSum = vec3(0.0);
    for (int k = 0; k < ${LIGHT_CONES.scatterSamples}; k++) {
      float lcT = (float(k) + 0.5) * lcStep;
      vec3 lcToSample = lcSnap > 0.0
        ? floor(lcCamSnap + lcRayDir * (lcT * lcSnap)) * lcSnapInv + lcSnapOffset
        : lcCam + lcRayDir * lcT - lcOrigin;
      float lcAxial = length(lcToSample);
      if (lcAxial < 1e-3 || lcAxial >= lcShape.z) continue;
      float lcAngular = clamp((dot(lcToSample / lcAxial, uConeDirections[i]) - lcShape.x) * lcShape.y, 0.0, 1.0);
      lcAngular *= lcAngular;
      float lcNorm = lcAxial / lcShape.z;
      float lcFall = 1.0 - lcNorm * lcNorm;
      lcFall *= lcFall;
      lcSum += exp(-${WATER_VIEW_EXTINCTION_GLSL} * (lcAxial + lcT) * uConeOrigins[i].w) * (lcAngular * lcFall);
    }
    lcTotal += uConeColors[i] * lightConeScatterStyled(lcSum * (lcStrength * lcStep));
  }
  return lcTotal;
}
`;

/**
 * Adds the in-scattered beam glow after fog. Expects `vWorldPosition`,
 * `cameraPosition`, and `gl_FragColor` in scope. Scatter strength is the
 * game's per-cone knob: this is how a beam is *seen* in air — real
 * spotlights are invisible between lens and surface unless the air itself
 * scatters some light toward the eye (dust, haze), which this term
 * estimates. Submersion additionally applies water extinction along the
 * path, so underwater beams glow stronger and die short; the scatter style's
 * ceiling keeps that glow from whiting out.
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
  /** The shared {@link LIGHT_CONE_SCATTER_STYLE} object, not a copy. */
  coneScatterStyle: { value: Vector3 };
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
    coneScatterStyle: LIGHT_CONE_SCATTER_STYLE,
  };

  get uniformBindings(): Record<string, LightConeUniformBinding> {
    return {
      uConeCount: this.uniforms.coneCount,
      uConeOrigins: this.uniforms.coneOrigins,
      uConeDirections: this.uniforms.coneDirections,
      uConeColors: this.uniforms.coneColors,
      uConeShapes: this.uniforms.coneShapes,
      uConeScatterStyle: this.uniforms.coneScatterStyle,
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
