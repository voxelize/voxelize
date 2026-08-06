import { Color } from "three";

import type { ParticleLightValues, ParticleWorld } from "./types";

const NEIGHBOR_OFFSETS: [number, number, number][] = [
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, -1, 0],
];

/**
 * Particles are unlit, so without a tint a leaf falling at dusk keeps full
 * daylight brightness while the canopy it came off darkens, and a chip
 * knocked off a block in a cave comes out glowing.
 *
 * The light a chip knocked off this block should be tinted by.
 *
 * Sampled from the six neighbours rather than the voxel itself: a solid
 * block holds no light, so the brightest neighbour is what the surface
 * being broken was actually lit by.
 */
export function computeBlockLightColor(
  world: ParticleWorld,
  vx: number,
  vy: number,
  vz: number,
  out: Color = new Color(),
): Color {
  let sunlight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;

  for (const [dx, dy, dz] of NEIGHBOR_OFFSETS) {
    const light = world.getLightValuesAt(vx + dx, vy + dy, vz + dz);
    if (!light) continue;
    if (light.sunlight > sunlight) sunlight = light.sunlight;
    if (light.red > red) red = light.red;
    if (light.green > green) green = light.green;
    if (light.blue > blue) blue = light.blue;
  }

  return toLightColor(world, { sunlight, red, green, blue }, out);
}

/**
 * The light a particle drifting through this voxel should be tinted by.
 *
 * Open air carries its own light, so this reads the voxel directly. Taking
 * the brightest neighbour instead — the right answer for a solid block —
 * would hand a leaf under a canopy the unshaded sky beside it.
 *
 * Unlit voxels are left untinted rather than painted black: the only way
 * to get here without light data is an unloaded chunk, which a probe-driven
 * spawn cannot reach, and a missing measurement should not confidently
 * darken anything.
 */
export function computeVoxelLightColor(
  world: ParticleWorld,
  vx: number,
  vy: number,
  vz: number,
  out: Color = new Color(),
): Color {
  const light = world.getLightValuesAt(vx, vy, vz);
  if (!light) return out.setRGB(1, 1, 1);
  return toLightColor(world, light, out);
}

/** The shading chunk meshes get, applied to a particle's flat color. */
function toLightColor(
  world: ParticleWorld,
  light: ParticleLightValues,
  out: Color,
): Color {
  const { sunlightIntensity, minLightLevel, baseAmbient } =
    world.chunkRenderer.uniforms;
  const maxLightLevel = world.options.maxLightLevel;

  const sunlightNorm = light.sunlight / maxLightLevel;
  const sunlightFactor = sunlightNorm ** 2 * sunlightIntensity.value;
  const sun = Math.min(
    sunlightFactor + minLightLevel.value * sunlightNorm + baseAmbient.value,
    1,
  );

  const torchAttenuation = 1 - sun * 0.8;
  return out.setRGB(
    sun + (light.red / maxLightLevel) ** 2 * torchAttenuation,
    sun + (light.green / maxLightLevel) ** 2 * torchAttenuation,
    sun + (light.blue / maxLightLevel) ** 2 * torchAttenuation,
  );
}
