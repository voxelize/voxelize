import { Color } from "three";

import {
  acesFit,
  BLOCK_LIGHT_TRANSFER,
  BLOCK_LIGHT_TUNING,
  blockLightCurve,
  blockLightToneMap,
  blockLightWarmTint,
} from "./block-light-transfer";
import { LAMBERT_WRAP } from "./local-lights/shader";

/**
 * What one whole-object light sample knows about the point it stands on.
 * Every field is in the chunk shader's own units so the composition below
 * can follow the fragment program line for line.
 */
export type EntityLightSample = {
  /** `sunlight / maxLightLevel`, 0..1 — the shader's `vLight.a`. */
  sunExposure: number;
  /** Flood block light per channel, `level / maxLightLevel`, 0..1. */
  floodR: number;
  floodG: number;
  floodB: number;
  /**
   * Fraction of the flood term this point keeps once analytic lights have
   * claimed their share (`blockLightFloodRemainder`), 0..1. `1` with local
   * lights off.
   */
  floodRemainder: number;
  /**
   * Clustered local-light irradiance at the point (`queryLocalLights`),
   * before any diffuse response. Unbounded: a lit floor's proxy carries the
   * intensity of several emitters.
   */
  clusterR: number;
  clusterG: number;
  clusterB: number;
  /**
   * Sun visibility along the sun ray: `1` in the open, `1 - shadowStrength`
   * when a voxel blocks it — the whole-object stand-in for `getShadow()`.
   */
  shadowFactor: number;
  sunlightIntensity: number;
  sunColor: Color;
  ambientColor: Color;
  /** `max(uMinLightLevel + uBaseAmbient, 0)`. */
  ambientFloor: number;
  /**
   * Downwelling transmittance of the water column above the point; white
   * when dry. Scales every sun-path term exactly as `downTransmit` does.
   */
  downTransmit: Color;
  /**
   * Scattered surface light filling the water around the point; black when
   * dry. Added to the sun path like `underwaterFill`.
   */
  underwaterFill: Color;
};

// ── the chunk fragment's constants ───────────────────────────────────────
// Each mirrors a literal in the block after `#include <envmap_fragment>` in
// shaders.ts. The shader is the source of truth; change neither side alone.

/** Legacy `vec3 torchLight = smoothTorch * 1.2`; the live gain follows
 * {@link BLOCK_LIGHT_TUNING} (block-light-transfer.ts). */
export const TORCH_GAIN = BLOCK_LIGHT_TRANSFER.legacyGain;
/** `vec3(0.025, 0.03, 0.04) * sunVisibility` */
const GLOBAL_AMBIENT_SUN: readonly [number, number, number] = [
  0.025, 0.03, 0.04,
];
/** `float ambientOcclusion = mix(0.72, 1.0, shadow)` */
const SHADOWED_SKY_OCCLUSION = 0.72;
/** `uAmbientColor * 0.04 * (1.0 - shadow) * sunExposure * uSunlightIntensity` */
const BOUNCE_STRENGTH = 0.04;
/** `vec3 groundColor = uAmbientColor * 0.4` */
const GROUND_AMBIENT_SCALE = 0.4;
/** `vec3 coolTint = vec3(0.92, 0.95, 1.05)` */
const COOL_TINT: readonly [number, number, number] = [0.92, 0.95, 1.05];
/** `mix(vec3(0.8, 0.88, 1.0), vec3(1.0), sunVisibility)` under the floor */
const DARKNESS_FLOOR_TINT: readonly [number, number, number] = [0.8, 0.88, 1.0];
/** `dot(sunContribution, vec3(0.33))` */
const SUN_LUMA_WEIGHT = 0.33;

// ── whole-object stand-ins for per-fragment geometry ─────────────────────
// A fragment has a normal; a character, a dropped item, or a block entity
// lit as one object does not. These are the hemisphere averages of the
// shader's normal-dependent terms over a convex body, so the object lands
// at the brightness of the faces around it rather than at any one face.

/**
 * Average of the shader's wrapped `NdotL` over a body's faces. A cube in
 * midday sun: the top face near 0.75, the bottom at 0, the sides between,
 * averaging about one half. Also the N·L the local-light Lambert wrap is
 * evaluated at.
 */
export const ENTITY_AVERAGE_NDOTL = 0.5;
/**
 * The sky hemisphere blend `vWorldNormal.y * 0.5 + 0.5` averaged over a
 * body: vertical faces sit at 0.5 and top and bottom cancel, so the sky
 * ambient lands between `groundColor` and `uAmbientColor`.
 */
export const ENTITY_HEMISPHERE_BLEND = 0.5;

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

/** `1 - (1 - a)(1 - b)` — how the shader stacks its light terms. */
const screen = (a: number, b: number) => 1 - (1 - a) * (1 - b);

/**
 * The ACES fit the chunk fragment tone-maps its light through. Tops out
 * near 1.03, so a level-15 emitter and open noon sun both land displayable.
 */
export const acesToneMap = acesFit;

const warmScratch: [number, number, number] = [0, 0, 0];
const toneScratch: [number, number, number] = [0, 0, 0];

/**
 * CPU mirror of the chunk fragment's light composition, for objects lit as
 * a whole rather than per fragment: players and peers, block-entity meshes,
 * dropped models. Writes the multiplier for the object's albedo into `out`.
 *
 * The terrain screen-blends its sun and block-light terms and tone-maps the
 * result, so a level-15 emitter under a fragment lands near 1.0. Composing
 * the same inputs additively and leaving them untonemapped — sun plus
 * ambient plus torch plus every analytic light in the cell — put a player
 * at 1.5–2.5× the brightness of the block under their feet: the white blob
 * on the lantern floor, and the glowing swimmer beside an underwater lamp.
 * Following the fragment program step for step keeps the object and the
 * ground it stands on in agreement under every sky and in every water.
 *
 * Skipped on purpose, because a whole object has none of the inputs: vertex
 * AO, the per-axis face shade, the bright-texture sun reduction, cone
 * lights, and the emissive bypass. Zero cluster light is an exact identity
 * through the blend, matching the shader's guarded cluster stage.
 */
export function composeEntityLight(s: EntityLightSample, out: Color): Color {
  const sunExposure = clamp01(s.sunExposure);
  const sunVisibility = sunExposure;
  const ambientFloor = Math.max(s.ambientFloor, 0);
  const shadow = clamp01(s.shadowFactor);
  const sunlightIntensity = Math.max(s.sunlightIntensity, 0);

  // `float tunnelDarkening = mix(ambientFloor, 1.0, sunVisibility);`
  const tunnelDarkening = ambientFloor + (1 - ambientFloor) * sunVisibility;

  // `vec3 sunContribution = uSunColor * NdotL * shadow * uSunlightIntensity * sunExposure;`
  const sunContrib =
    sunlightIntensity * ENTITY_AVERAGE_NDOTL * shadow * sunExposure;
  const sunR = s.sunColor.r * sunContrib;
  const sunG = s.sunColor.g * sunContrib;
  const sunB = s.sunColor.b * sunContrib;

  // `skyAmbient * ambientOcclusion * tunnelDarkening`, with the hemisphere
  // blend averaged over the body.
  const ambientOcclusion =
    SHADOWED_SKY_OCCLUSION + (1 - SHADOWED_SKY_OCCLUSION) * shadow;
  const hemisphere =
    GROUND_AMBIENT_SCALE + (1 - GROUND_AMBIENT_SCALE) * ENTITY_HEMISPHERE_BLEND;
  const skyScale = hemisphere * ambientOcclusion * tunnelDarkening;
  // `uAmbientColor * 0.04 * (1.0 - shadow) * sunExposure * uSunlightIntensity`
  const bounce =
    BOUNCE_STRENGTH * (1 - shadow) * sunExposure * sunlightIntensity;

  const dtR = s.downTransmit.r;
  const dtG = s.downTransmit.g;
  const dtB = s.downTransmit.b;

  // sunTotal = sky + reducedSun + bounce + globalAmbient + underwaterFill,
  // every dry term riding the water column's transmittance.
  const sunTotalR =
    (s.ambientColor.r * (skyScale + bounce + ambientFloor) +
      sunR +
      GLOBAL_AMBIENT_SUN[0] * sunVisibility) *
      dtR +
    s.underwaterFill.r;
  const sunTotalG =
    (s.ambientColor.g * (skyScale + bounce + ambientFloor) +
      sunG +
      GLOBAL_AMBIENT_SUN[1] * sunVisibility) *
      dtG +
    s.underwaterFill.g;
  const sunTotalB =
    (s.ambientColor.b * (skyScale + bounce + ambientFloor) +
      sunB +
      GLOBAL_AMBIENT_SUN[2] * sunVisibility) *
      dtB +
    s.underwaterFill.b;

  // `vec3 smoothTorch = blockLightCurve(cpuTorchLight);`
  const smoothR = blockLightCurve(s.floodR);
  const smoothG = blockLightCurve(s.floodG);
  const smoothB = blockLightCurve(s.floodB);

  // Daylight washes analytic block light and hands the washed share back to
  // the flood term: `clusterLight *= llSunWash; llFloodRemainder = mix(1.0,
  // llFloodRemainder, llSunWash);`
  const sunWash = 1 - clamp01(sunExposure * sunlightIntensity);
  const floodRemainder = 1 + (clamp01(s.floodRemainder) - 1) * sunWash;
  // The per-fragment `llLambert = max(N·L, 0) * (1 - wrap) + wrap`, taken
  // at the body's average N·L.
  const clusterLambert =
    ENTITY_AVERAGE_NDOTL * (1 - LAMBERT_WRAP) + LAMBERT_WRAP;
  const clusterR = Math.max(s.clusterR, 0) * clusterLambert * sunWash;
  const clusterG = Math.max(s.clusterG, 0) * clusterLambert * sunWash;
  const clusterB = Math.max(s.clusterB, 0) * clusterLambert * sunWash;

  // `vec3 torchLight = smoothTorch * (uBlockLightGain * llFloodRemainder);`
  const gain = BLOCK_LIGHT_TUNING.gain.value;
  const torchR = smoothR * gain * floodRemainder;
  const torchG = smoothG * gain * floodRemainder;
  const torchB = smoothB * gain * floodRemainder;
  const torchBrightness = Math.max(
    Math.max(smoothR, smoothG, smoothB) * floodRemainder,
    Math.min(Math.max(clusterR, clusterG, clusterB), 1),
  );

  // `vec3 totalLight = 1.0 - (1.0 - sunTotal) * (1.0 - torchLight);`
  let r = screen(sunTotalR, torchR);
  let g = screen(sunTotalG, torchG);
  let b = screen(sunTotalB, torchB);

  // The guarded cluster blend: skipped entirely at zero so the result is
  // the exact torch-only value, not an ulp off it.
  if (clusterR > 0 || clusterG > 0 || clusterB > 0) {
    r = screen(r, clusterR);
    g = screen(g, clusterG);
    b = screen(b, clusterB);
  }

  // `temperatureShift = mix(coolTint, warmTint, torchDominance)`
  const sunLuma = (sunR + sunG + sunB) * SUN_LUMA_WEIGHT;
  const torchDominance =
    torchBrightness /
    (torchBrightness + sunLuma + BLOCK_LIGHT_TUNING.dominanceKnee.value);
  const warm = blockLightWarmTint(torchR, torchG, torchB, warmScratch);
  r *= COOL_TINT[0] + (warm[0] - COOL_TINT[0]) * torchDominance;
  g *= COOL_TINT[1] + (warm[1] - COOL_TINT[1]) * torchDominance;
  b *= COOL_TINT[2] + (warm[2] - COOL_TINT[2]) * torchDominance;

  [r, g, b] = blockLightToneMap(r, g, b, torchDominance, toneScratch);

  // `darknessFloor = ambientFloor * mix(vec3(0.8, 0.88, 1.0), vec3(1.0), sunVisibility) * downTransmit`
  const floorR =
    ambientFloor *
    (DARKNESS_FLOOR_TINT[0] + (1 - DARKNESS_FLOOR_TINT[0]) * sunVisibility) *
    dtR;
  const floorG =
    ambientFloor *
    (DARKNESS_FLOOR_TINT[1] + (1 - DARKNESS_FLOOR_TINT[1]) * sunVisibility) *
    dtG;
  const floorB =
    ambientFloor *
    (DARKNESS_FLOOR_TINT[2] + (1 - DARKNESS_FLOOR_TINT[2]) * sunVisibility) *
    dtB;

  return out.setRGB(
    Math.max(r, floorR),
    Math.max(g, floorG),
    Math.max(b, floorB),
  );
}
