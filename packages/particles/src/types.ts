import type { Engine } from "@voxelize/physics-engine";
import type { ColorRepresentation, Object3D, Texture } from "three";

/**
 * What this engine needs from a Voxelize world, spelled out structurally so
 * the package never has to depend on `@voxelize/core` (which the monorepo
 * builds last, and which will one day want to draw particles of its own).
 * A real `World` satisfies every member of it.
 */
export interface ParticleWorld {
  isInitialized: boolean;
  add(object: Object3D): void;
  remove(object: Object3D): void;
  getVoxelAt(px: number, py: number, pz: number): number;
  getBlockAt(px: number, py: number, pz: number): ParticleBlock | null;
  getBlockFaceMaterial(
    idOrName: number | string,
    faceName?: string,
  ): { map: Texture | null } | undefined;
  getLightValuesAt(
    vx: number,
    vy: number,
    vz: number,
  ): ParticleLightValues | null;
  registry: { blocksById: Map<number, ParticleBlock> };
  chunkRenderer: { uniforms: ParticleLightUniforms };
  options: { maxLightLevel: number };
  physics: Engine;
}

export interface ParticleBlock {
  id: number;
  name: string;
  isEmpty: boolean;
  isPassable: boolean;
  isFluid: boolean;
  faces: ParticleBlockFace[];
}

export interface ParticleBlockFace {
  name: string;
  isolated: boolean;
  textureGroup: string | null;
  range: UVRegion;
}

export interface ParticleLightValues {
  sunlight: number;
  red: number;
  green: number;
  blue: number;
}

export interface ParticleLightUniforms {
  sunlightIntensity: { value: number };
  minLightLevel: { value: number };
  baseAmbient: { value: number };
}

export type ParticleBlendMode = "additive" | "normal";

/**
 * Cubes read as chips and embers, quads as flat things that tumble, and
 * billboards always face the camera — the sprite look, for anything that
 * should read the same from every angle.
 */
export type ParticleShape = "cube" | "quad" | "billboard";

export type ParticleRange = { min: number; max: number };

/** A rectangle of a texture, in UV space — a block face's slot in the atlas. */
export type UVRegion = {
  startU: number;
  endU: number;
  startV: number;
  endV: number;
};

export type ParticleTexture = {
  /** Layer identity. Two configs sharing a key share one draw call. */
  key: string;
  map: Texture;
  /** Region sampled when a spawn does not name its own. */
  region: UVRegion;
  /** Portion of the region one particle samples; 1 is the whole face. */
  patchFraction: number;
};

/**
 * Collide with the world instead of drifting through it, using the same
 * physics engine that moves players and creatures. Bodies are pooled per
 * layer, so a fragment storm reuses them rather than allocating.
 *
 * A particle's spawn velocity becomes the body's launch impulse. Physics
 * supersedes {@link ParticleConfig.isSettlingOnGround}; a particle that
 * collides for real has no use for the cheap version.
 */
export type ParticlePhysics = {
  /** Edge length of the cube body used for collision. */
  bodySize: number;
  friction: number;
  restitution: number;
  gravityMultiplier: number;
};

export interface ParticleConfig {
  blend: ParticleBlendMode;
  /** Defaults to `cube`. */
  shape?: ParticleShape;
  /** Untextured particles are flat-colored by their palette. */
  texture?: ParticleTexture;
  lifetimeSec: ParticleRange;
  /** Cube edge length / quad width in world units at spawn. */
  size: ParticleRange;
  /** Scale multiplier ramp across the particle's life. */
  sizeOverLife: { from: number; to: number };
  /**
   * Opacity ramp across the particle's life. `holdFrac` delays the ramp for
   * that fraction of the life, which is what long-lived ambient particles
   * want: a leaf should be a leaf for most of its fall and then go, not be
   * half-faded the whole way down.
   */
  alphaOverLife: { from: number; to: number; holdFrac?: number };
  /** Spawn colors (sRGB hex strings); each particle picks one at random. */
  palette: readonly string[];
  /** Optional color ramp target the spawn color lerps toward over life. */
  fadeToColor?: string;
  /** Vertical acceleration: positive lifts (smoke), negative drops (chips). */
  riseAccel: number;
  /** Velocity damping per second (0 = ballistic). */
  dragPerSec: number;
  /** Random acceleration magnitude for wander (smoke curl). */
  turbulence: number;
  /** Tumble speed. */
  spinRadPerSec: number;
  /**
   * Hard-edged particles made of opaque texels — a leaf, a chip of stone —
   * as opposed to soft ones like smoke.
   *
   * Cutouts write depth and alpha-test their silhouette, so a near particle
   * hides a far one. Soft particles must not: they would punch holes in
   * each other. Without this every particle in a layer draws in spawn
   * order, and a leaf across the clearing paints over the petal in front of
   * your face.
   */
  isCutout?: boolean;
  /**
   * Sideways oscillation along a random horizontal axis picked at spawn:
   * the pendulum that separates a falling leaf from a dropped pebble.
   */
  sway?: { speed: number; frequencyHz: number };
  /**
   * Land on the first solid block below instead of sinking through the
   * world, and lie there for the rest of the lifetime. Costs one voxel
   * lookup per falling particle per frame, so it is opt-in.
   */
  isSettlingOnGround?: boolean;
  physics?: ParticlePhysics;
}

export interface SpawnMotion {
  speed: ParticleRange;
  /** Cone axis; omitted = radial sphere burst. */
  direction?: { x: number; y: number; z: number };
  /** Cone half-angle around `direction` (radians). */
  spreadRad?: number;
  /** Spawn position jitter radius. */
  jitterRadius?: number;
  /** Multiplies the config's size range. */
  sizeScale?: number;
  /** Replaces the config palette (e.g. matching a surface, or its light). */
  color?: ColorRepresentation;
  /** Replaces the config's texture region (e.g. matching a block face). */
  textureRegion?: UVRegion;
  /** 0..1: folds radial directions upward so ground bursts plume. */
  upwardBias?: number;
  /**
   * Added to every particle's launch velocity. Scatter and shove are
   * separate knobs: crumbs fall out of a mouth with a small random spread
   * and a firm push downward, which a wider cone cannot express without
   * also making the scatter bigger.
   */
  velocityBias?: { x: number; y: number; z: number };
}

export interface BurstOptions extends SpawnMotion {
  position: { x: number; y: number; z: number };
  count: number;
}

export interface EmitterOptions {
  ratePerSecond: number;
  speed: ParticleRange;
  spreadRad?: number;
  jitterRadius?: number;
  sizeScale?: number;
}

export interface FlashOptions {
  color: string;
  intensity: number;
  distance: number;
  durationSec: number;
}

export interface ParticleSystemOptions {
  /** Hard cap per layer; spawns beyond it are dropped, never queued. */
  capacityPerLayer: number;
  /** Pooled point lights for explosion flashes (lights are precious). */
  maxFlashLights: number;
}
