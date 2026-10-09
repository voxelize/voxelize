/**
 * The time-of-day look: the uniforms the chunk shader, the far layer and
 * the sky receive at one moment. A game that has its own sky palette and
 * shading-light rule hands the viewer a `LookProvider` and the viewer shows
 * that game's day; the default here is a plain, neutral day so a world with
 * no game of its own still reads.
 */
import { Color } from "three";

import type { ViewerMaterials } from "./materials";

export type Rgb = [number, number, number];

/** One moment of the day, every colour in linear (working-space) RGB. */
export type LookSample = {
  /** The shading light: what faces are lit from (not where the disc is). */
  sunDirection: [number, number, number];
  shadowStrength: number;
  sunColor: Rgb;
  ambientColor: Rgb;
  sunlightIntensity: number;
  skyTop: Rgb;
  skyMiddle: Rgb;
  skyBottom: Rgb;
  skyOffset: number;
  voidOffset: number;
  /** The fog range a game client would draw at this hour. */
  fogNear: number;
  fogFar: number;
};

export type LookProvider = (timeOfDay: number) => LookSample;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const linear = (hex: string): Rgb => {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
};

/** A neutral day/night for worlds without a look of their own. */
export const defaultLook: LookProvider = (timeOfDay) => {
  const t = ((timeOfDay % 1) + 1) % 1;
  const angle = t * Math.PI * 2 - Math.PI / 2;
  const sunY = Math.sin(angle);
  const day = Math.max(0, Math.min(1, (sunY + 0.15) / 0.4));
  const lightY = Math.max(Math.abs(sunY), 0.35);
  const lightX = Math.cos(angle) * (sunY >= 0 ? 1 : -1);
  const length = Math.hypot(lightX, lightY, 0.3);
  return {
    sunDirection: [lightX / length, lightY / length, 0.3 / length],
    shadowStrength: 0.4 + 0.6 * day,
    sunColor: mix(linear("#6f7fa8"), linear("#fff6e6"), day),
    ambientColor: mix(linear("#2a3550"), linear("#b9c8e0"), day),
    sunlightIntensity: 0.15 + 0.85 * day,
    skyTop: mix(linear("#0b1022"), linear("#4a7fd0"), day),
    skyMiddle: mix(linear("#1a2238"), linear("#a9c8f0"), day),
    skyBottom: mix(linear("#0a0d16"), linear("#c9d8ea"), day),
    skyOffset: 0,
    voidOffset: 1200,
    fogNear: 96,
    fogFar: 160,
  };
};

export type FogRange = { near: number; far: number };

/** Writes `sample` into every uniform the materials share. */
export function applyLook(
  materials: ViewerMaterials,
  sample: LookSample,
  fog: FogRange,
) {
  const u = materials.chunkRenderer.uniforms;
  const l = materials.chunkRenderer.shaderLightingUniforms;
  l.sunDirection.value.set(...sample.sunDirection).normalize();
  l.celestialDirection.value.copy(l.sunDirection.value);
  l.sunColor.value.setRGB(...sample.sunColor);
  l.ambientColor.value.setRGB(...sample.ambientColor);
  l.shadowStrength.value = sample.shadowStrength;
  l.sunlightIntensity.value = sample.sunlightIntensity;
  l.skyTopColor.value.setRGB(...sample.skyTop);
  l.skyMiddleColor.value.setRGB(...sample.skyMiddle);
  u.sunlightIntensity.value = Math.max(0.05, sample.sunlightIntensity);
  u.skyFogTopColor.value.setRGB(...sample.skyTop);
  u.skyFogMiddleColor.value.setRGB(...sample.skyMiddle);
  u.skyFogBottomColor.value.setRGB(...sample.skyBottom);
  u.skyFogOffset.value = sample.skyOffset;
  u.skyFogVoidOffset.value = sample.voidOffset;
  u.fogColor.value.setRGB(...sample.skyMiddle);
  u.fogNear.value = fog.near;
  u.fogFar.value = fog.far;
}
