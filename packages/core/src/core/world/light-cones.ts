import {
  AdditiveBlending,
  Color,
  InstancedMesh,
  Material,
  MathUtils,
  Mesh,
  Object3D,
  Vector3,
  Vector4,
} from "three";

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
   * Fixed sample count of the per-cone in-scattering estimate, spread over
   * the stretch of the view ray inside the cone (found exactly, so none land
   * outside it). Four samples there read as a continuous volumetric beam
   * without a real ray march; spread over the whole ray they streaked.
   */
  scatterSamples: 4,

  /**
   * Default voxel-native look of a submerged beam's scattered shaft, live
   * in {@link LIGHT_CONE_SCATTER_STYLE} as (texelsPerBlock, bands,
   * ceiling). It fades in with the cone origin's submersion: in dry air the
   * faint glow rounded up to the first flat band and drew a hard-edged oval,
   * so a dry shaft stays smooth.
   *
   * - `scatterTexelsPerBlock`: each scatter sample is moved to the centre of
   *   the texel cell it falls in (a 1/N-block grid) before the cone is
   *   evaluated, so the shaft's edges step on the block texel grid.
   * - `scatterBands`: each cone's scattered term is rounded to this many
   *   flat levels, evenly spaced in sqrt(term / ceiling); the faintest tail
   *   rounds to zero. Off (0) by default: the flat levels drew hard rings
   *   and a ragged stepped edge across the floor, where the snapped grain
   *   alone keeps the beam voxel-native.
   * - `scatterCeiling`: the most a cone's scattered term may add, as a
   *   fraction of the cone's own colour times intensity, so a submerged
   *   beam glows murky instead of whiting out. It is also the top band.
   */
  scatterTexelsPerBlock: 16,
  scatterBands: 0,
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
vec3 lightConeScatterStyled(vec3 lcScatter, float lcSubmersion) {
  float lcBands = uConeScatterStyle.y;
  float lcCeiling = uConeScatterStyle.z;
  if (lcSubmersion <= 0.0) return lcScatter;
  if (lcBands <= 0.0 && lcCeiling <= 0.0) return lcScatter;
  float lcPeak = max(max(lcScatter.r, lcScatter.g), lcScatter.b);
  if (lcPeak <= 0.0) return lcScatter;
  float lcTop = lcCeiling > 0.0 ? lcCeiling : 1.0;
  float lcLevel = min(lcPeak / lcTop, 1.0);
  if (lcBands > 0.0) {
    float lcStepped = floor(sqrt(lcLevel) * lcBands + 0.5) / lcBands;
    lcLevel = lcStepped * lcStepped;
  }
  return mix(lcScatter, lcScatter * (lcLevel * lcTop / lcPeak), lcSubmersion);
}

// The stretch [s, e] of the view ray that lies inside cone i's front nappe,
// clipped to [0, lcMax] and to the cone's reach along its axis; e <= s when
// the ray misses it. Points P = cam + dir * t inside satisfy
// dot(P - O, D)^2 >= cos^2 * |P - O|^2 with dot(P - O, D) >= 0: a quadratic
// in t, and the front nappe is convex, so the inside is one interval.
vec2 lightConeSegment(int i, vec3 lcCam, vec3 lcRayDir, float lcMax) {
  vec3 lcV = lcCam - uConeOrigins[i].xyz;
  vec3 lcD = uConeDirections[i];
  float lcCos2 = uConeShapes[i].x * uConeShapes[i].x;
  float lcRange = uConeShapes[i].z;
  float lcRD = dot(lcRayDir, lcD);
  float lcVD = dot(lcV, lcD);
  // The axial slab 0 <= dot(P - O, D) <= range.
  float lcLo = 0.0;
  float lcHi = lcMax;
  if (abs(lcRD) > 1e-5) {
    float lcT0 = -lcVD / lcRD;
    float lcT1 = (lcRange - lcVD) / lcRD;
    lcLo = max(lcLo, min(lcT0, lcT1));
    lcHi = min(lcHi, max(lcT0, lcT1));
  } else if (lcVD < 0.0 || lcVD > lcRange) {
    return vec2(0.0);
  }
  if (lcHi <= lcLo) return vec2(0.0);
  float lcA = lcRD * lcRD - lcCos2;
  float lcB = 2.0 * (lcRD * lcVD - lcCos2 * dot(lcRayDir, lcV));
  float lcC = lcVD * lcVD - lcCos2 * dot(lcV, lcV);
  float lcDisc = lcB * lcB - 4.0 * lcA * lcC;
  if (abs(lcA) < 1e-6) {
    // Parallel to the surface: one crossing; keep the side that is inside.
    float lcMid = 0.5 * (lcLo + lcHi);
    float lcF = (lcB * lcMid + lcC);
    if (abs(lcB) < 1e-6) return lcF >= 0.0 ? vec2(lcLo, lcHi) : vec2(0.0);
    float lcTc = -lcC / lcB;
    return lcB > 0.0 ? vec2(max(lcLo, lcTc), lcHi) : vec2(lcLo, min(lcHi, lcTc));
  }
  if (lcDisc < 0.0) {
    return lcA > 0.0 ? vec2(lcLo, lcHi) : vec2(0.0);
  }
  float lcSq = sqrt(lcDisc);
  float lcR1 = (-lcB - lcSq) / (2.0 * lcA);
  float lcR2 = (-lcB + lcSq) / (2.0 * lcA);
  float lcT1 = min(lcR1, lcR2);
  float lcT2 = max(lcR1, lcR2);
  if (lcA < 0.0) return vec2(max(lcLo, lcT1), min(lcHi, lcT2));
  // Outside between the roots: inside is the part of the slab before t1 or
  // after t2. The slab holds the front nappe only, so one side is empty.
  vec2 lcBefore = vec2(lcLo, min(lcHi, lcT1));
  vec2 lcAfter = vec2(max(lcLo, lcT2), lcHi);
  return lcBefore.y - lcBefore.x >= lcAfter.y - lcAfter.x ? lcBefore : lcAfter;
}

vec3 lightConeScatter(vec3 lcCam, vec3 lcRayDir, float lcFragDist) {
  vec3 lcTotal = vec3(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uConeCount) break;
    vec4 lcShape = uConeShapes[i];
    float lcSubmersion = uConeOrigins[i].w;
    // Clear air scatters a few percent of what murky water does: enough to
    // see the shaft of a strong beam, nowhere near enough to white it out.
    float lcStrength = lcShape.w * mix(0.05, 1.0, lcSubmersion);
    if (lcStrength <= 0.0) continue;
    vec3 lcOrigin = uConeOrigins[i].xyz;
    float lcMax = min(lcFragDist, distance(lcCam, lcOrigin) + lcShape.z);
    if (lcMax <= 0.0) continue;
    // Every sample inside the beam: spread evenly over the whole view ray,
    // most fell outside it and the shaft broke into streaks.
    vec2 lcSeg = lightConeSegment(i, lcCam, lcRayDir, lcMax);
    if (lcSeg.y <= lcSeg.x) continue;
    float lcStep = (lcSeg.y - lcSeg.x) / ${LIGHT_CONES.scatterSamples.toFixed(1)};
    // The texel grid the samples snap to underwater (cells per block, 0 =
    // unsnapped), each read at its cell's centre. Dry air stays smooth.
    float lcSnap = lcSubmersion > 0.5 ? uConeScatterStyle.x : 0.0;
    float lcSnapInv = 1.0 / max(lcSnap, 1e-3);
    vec3 lcSnapOffset = 0.5 * lcSnapInv - lcOrigin;
    vec3 lcSum = vec3(0.0);
    for (int k = 0; k < ${LIGHT_CONES.scatterSamples}; k++) {
      float lcT = lcSeg.x + (float(k) + 0.5) * lcStep;
      vec3 lcToSample = lcSnap > 0.0
        ? floor((lcCam + lcRayDir * lcT) * lcSnap) * lcSnapInv + lcSnapOffset
        : lcCam + lcRayDir * lcT - lcOrigin;
      float lcAxial = length(lcToSample);
      if (lcAxial < 1e-3 || lcAxial >= lcShape.z) continue;
      float lcAngular = clamp((dot(lcToSample / lcAxial, uConeDirections[i]) - lcShape.x) * lcShape.y, 0.0, 1.0);
      lcAngular *= lcAngular;
      float lcNorm = lcAxial / lcShape.z;
      float lcFall = 1.0 - lcNorm * lcNorm;
      lcFall *= lcFall;
      lcSum += exp(-${WATER_VIEW_EXTINCTION_GLSL} * (lcAxial + lcT) * lcSubmersion) * (lcAngular * lcFall);
    }
    lcTotal += uConeColors[i] * lightConeScatterStyled(lcSum * (lcStrength * lcStep), lcSubmersion);
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

/**
 * Whether a material takes the light cones per pixel. Set by everything
 * that shades with them (chunks, the instanced entity material,
 * {@link injectLightCones}); {@link auditLightCones} reports any drawn,
 * world-lit mesh without it, so a new material cannot quietly skip the
 * beam the way a custom creature material once did.
 */
export function markLightConesCovered(material: Material): void {
  material.userData.lightConesCovered = true;
}

/** Marked, or a shader material that binds the cone uniforms itself. */
export function isLightConesCovered(material: Material): boolean {
  if (material.userData.lightConesCovered === true) return true;
  const uniforms = (material as { uniforms?: Record<string, unknown> })
    .uniforms;
  return uniforms !== undefined && "uConeCount" in uniforms;
}

/**
 * Exempt a material, or an object and everything under it, from
 * {@link auditLightCones}, with the reason it should not catch a beam (the
 * sky, a full-screen pass, an overlay, FX lit on the CPU). The reason stays
 * in the code next to what it exempts, so every exemption is a decision
 * someone can read.
 */
export function exemptFromLightCones(
  target: Material | Object3D,
  reason: string,
): void {
  target.userData.lightConesExempt = reason;
}

const isExempt = (target: Material | Object3D) =>
  typeof target.userData.lightConesExempt === "string";

const ENTITY_CONE_VERTEX_MAIN = `
{
  vec4 lcWorld = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    lcWorld = batchingMatrix * lcWorld;
  #endif
  #ifdef USE_INSTANCING
    lcWorld = instanceMatrix * lcWorld;
  #endif
  vLightConeWorld = (modelMatrix * lcWorld).xyz;
}
`;

/**
 * Per-pixel cone light for a built-in three material, lit or unlit. The
 * normal is the face's own, from screen derivatives of the world position:
 * voxel entities are flat-faced boxes, and an unlit material
 * (MeshBasicMaterial) carries no normal of its own to use.
 */
const ENTITY_CONE_FRAGMENT_FUNCTIONS = `
vec3 lightConeEntity() {
  vec3 lcNormal = normalize(cross(dFdx(vLightConeWorld), dFdy(vLightConeWorld)));
  return lightConeSurface(vLightConeWorld, lcNormal);
}

// Screen-blend the cones into the light a surface is already shaded with,
// the way the chunk shader blends them into its own.
vec3 lightConeLit(vec3 lcLight) {
  vec3 lcBase = min(lcLight, vec3(1.0));
  return max(lcLight, 1.0 - (1.0 - lcBase) * (1.0 - lightConeEntity()));
}
`;

/**
 * Give a built-in three material the light cones, from its
 * `onBeforeCompile`: the shader then has `lightConeLit(light)` (the light
 * with the cones screen-blended in) and `lightConeEntity()` (the cones
 * alone) to shade with, and draws the beam's in-scattered glow over its
 * finished colour, so a body standing in a beam neither stays dark nor cuts
 * a hole in the shaft. Mark the material {@link markLightConesCovered} where
 * the hook is installed.
 */
export function injectLightCones(
  shader: {
    uniforms: Record<string, unknown>;
    vertexShader: string;
    fragmentShader: string;
  },
  bindings: Record<string, LightConeUniformBinding>,
): void {
  Object.assign(shader.uniforms, bindings);
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vLightConeWorld;",
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n${ENTITY_CONE_VERTEX_MAIN}`,
    );
  const fragment = shader.fragmentShader.replace(
    "#include <common>",
    `#include <common>\nvarying vec3 vLightConeWorld;\n${LIGHT_CONES_UNIFORM_DECLARATIONS}\n${LIGHT_CONES_FUNCTIONS}\n${ENTITY_CONE_FRAGMENT_FUNCTIONS}`,
  );
  // Last in main, after every tint, shadow and fog the material applies.
  const end = fragment.lastIndexOf("}");
  shader.fragmentShader =
    fragment.slice(0, end) +
    `{vec3 vWorldPosition = vLightConeWorld;${LIGHT_CONES_SCATTER_FRAGMENT}}\n` +
    fragment.slice(end);
}

export type LightConeAuditEntry = {
  /** Names from the scene root down to the mesh. */
  path: string;
  material: string;
};

/**
 * Every visible mesh under `root` drawn with a material that neither takes
 * the light cones nor is exempt from them. Lines, points and sprites are
 * skipped (they have no surface to light), as are instanced meshes drawing
 * no instances, self-illuminated materials and additive glows, which
 * already shine past the dark.
 */
export function auditLightCones(root: Object3D): LightConeAuditEntry[] {
  const missing: LightConeAuditEntry[] = [];
  const visit = (object: Object3D, path: string) => {
    if (!object.visible || isExempt(object)) return;
    const here = `${path}/${object.name || object.type}`;
    const mesh = object as Mesh;
    const isEmpty = (mesh as InstancedMesh).isInstancedMesh
      ? (mesh as InstancedMesh).count === 0
      : false;
    if (mesh.isMesh && !isEmpty) {
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material || !material.visible) continue;
        if (isLightConesCovered(material)) continue;
        if (isExempt(material)) continue;
        if (material.blending === AdditiveBlending) continue;
        // `markSelfIlluminated` (LightShined): a lens, a screen.
        if (material.userData.isSelfIlluminated === true) continue;
        missing.push({
          path: here,
          material: material.name || material.type,
        });
      }
    }
    for (const child of object.children) visit(child, here);
  };
  visit(root, "");
  return missing;
}

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
