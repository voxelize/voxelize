import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  Vector4,
} from "three/webgpu";

import { meanLinearRgb } from "./far-terrain-tiles";
import { textureSlot, worldUniform } from "./shading/uniforms";

/**
 * Weather on surfaces: what rain and snow leave on the world, drawn by the
 * terrain shaders themselves. Rain darkens open ground (matte: wet soil
 * reads darker, never glossy), and pocks open ground with pixel splashes and
 * still water with rings while it falls. Snow near the
 * player is the host's to lay as blocks; only the far layer, which has no
 * blocks to lay it on, wears a coat that grows from patches to white.
 *
 * The host drives it with a handful of uniforms (`SurfaceWeatherUniforms`)
 * the chunk materials and the far layer read alike. At their
 * defaults (all of `surfaceWeather` zero) every term is skipped by a uniform
 * branch, so a world without weather renders exactly as before and pays
 * nothing.
 *
 * Every ground effect lives on the 1/16 block texel grid, so it belongs to
 * the block art, and every per-texel pattern hands over to its average as
 * texels shrink under a pixel, so the distance never sparkles.
 */

/** Texels per block side: the grid every ground effect snaps to. */
export const SURFACE_WEATHER_TEXELS = 16;

/** The tuning of every surface-weather term, shared by the shading and its CPU twins. */
export const SURFACE_WEATHER = {
  /** World normal y over which a face counts as facing up. */
  upFrom: 0.55,
  upTo: 0.9,
  /** Albedo scale of fully wet porous ground, and its saturation lift. */
  wetDarken: 0.65,
  wetSaturation: 0.15,
  /** Wetness a wall keeps, and what facing into the wind adds. */
  sideWet: 0.25,
  windwardWet: 0.6,
  /** The coat's drift field: two octaves (blocks per cell), weights, contrast. */
  driftScaleLarge: 3.5,
  driftScaleSmall: 1.3,
  driftWeightLarge: 0.7,
  driftContrast: 1.45,
  /**
   * Half-width of the coat's drift edge; the even speckle a fresh coat
   * starts with (single texels, the first minute); and the coat past which
   * the drifts begin to fill.
   */
  driftSoftness: 0.12,
  coatSpeckle: 0.2,
  driftStart: 0.2,
  /**
   * The share of ground the coat covers on average at coat `c`, as
   * `speckle + (1 - speckle) smoothstep(from, to, drifts)` (fit to the drift
   * field, within about 1%): what a coat seen from too far to resolve its
   * drifts is drawn as.
   */
  coatMean: { from: -0.02, to: 1.04 },
  /** Blocks per pixel over which the drift patches hand over to their mean. */
  driftFadeFrom: 0.35,
  driftFadeTo: 1.0,
  /** The roughening of the snow line, blocks: two octaves of (cell, swing). */
  lineJitterLarge: { cell: 23, swing: 6 },
  lineJitterSmall: { cell: 7, swing: 2 },
  /** The default half-width of the band the coat fades in over, blocks. */
  lineBand: 6.25,
  /**
   * Drop pocks: texels per cell side (one splash at a time per cell), slots
   * per second per cell, the share of slots that splash at full rain, and
   * each frame's end (seconds) and brightness: a dot, a plus, a faint ring.
   */
  pockCellTexels: 4,
  pockRate: 0.8,
  pockChance: 0.6,
  pockFrames: [0.04, 0.09, 0.15],
  pockWeights: [1, 0.8, 0.35],
  /** What a pock adds: this much of the sky's light, and of the ground's own. */
  pockSky: 0.35,
  pockGround: 0.35,
  /** Pixels per texel over which a pock hands over to its average shimmer. */
  pockFadeFrom: 0.8,
  pockFadeTo: 2.0,
  /**
   * Rain rings on still water: three layers of one-block cells,
   * a ring's life (s), its widest radius (blocks), the wave's sharpness
   * (radians per block), the share of slots that ring, the slope it tilts
   * the surface by, and the distance (blocks) it fades over.
   */
  ringLayers: 3,
  ringLife: 0.75,
  ringRadius: 0.3,
  ringSharpness: 45,
  ringChance: 0.7,
  ringSlope: 0.25,
  ringFadeFrom: 14,
  ringFadeTo: 36,
  /** How far a ring's crest lifts the water toward the sky it mirrors. */
  ringCrest: 0.3,
} as const;

const S = SURFACE_WEATHER;

/** A 1x1 map holding nothing: no coat, no wetness. */
export function makeSurfaceWeatherMap(
  data: Uint8Array = new Uint8Array(4),
  width = 1,
  height = 1,
): DataTexture {
  const texture = new DataTexture(
    data,
    width,
    height,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.colorSpace = NoColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The defaults: everything off. The host writes them; the chunk materials
 * and the far layer read the same nodes.
 * - `surfaceWeather` x: rain falling now, 0..1 (pocks on open ground, rings
 *   on open water); y, z: wetness and the far layer's coat gains, 0..1,
 *   each multiplying its channel of `surfaceWeatherMap`. All zero skips
 *   every term.
 * - `surfaceWeatherMap`: RGBA8, linear filtered: r coat, g wetness, b unused,
 *   a the coat line (see `surfaceWeatherLine`).
 * - `surfaceWeatherWindow`: `(x0, z0, 1 / width, 1 / depth)` in blocks: the
 *   map's uv is `(xz - (x0, z0)) * (1 / width, 1 / depth)`.
 * - `surfaceWeatherLine`: `(offset, scale, halfBand, unused)`: the coat line
 *   sits at `offset + a * scale`; the coat fades in, and wetness, pocks and
 *   rings fade out, across `line ± halfBand`.
 * - `surfaceCoatColor`: the far layer's coat colour (linear).
 * - `surfaceWind`: `(dirX, dirZ, strength 0..1, unused)`: walls facing into
 *   it get a little wetter.
 */
export function createSurfaceWeatherUniforms() {
  return {
    surfaceWeather: worldUniform(new Vector3(0, 0, 0)),
    surfaceWeatherMap: textureSlot("color", makeSurfaceWeatherMap()),
    surfaceWeatherWindow: worldUniform(new Vector4(0, 0, 1, 1)),
    surfaceWeatherLine: worldUniform(new Vector4(0, 0, S.lineBand, 0)),
    surfaceCoatColor: worldUniform(new Color().setRGB(0.86, 0.9, 0.95)),
    surfaceWind: worldUniform(new Vector4(0, 0, 0, 0)),
  };
}
export type SurfaceWeatherUniforms = ReturnType<
  typeof createSurfaceWeatherUniforms
>;


/**
 * Colour the far layer's coat as a face's texels average (`pixels`, RGBA
 * bytes as the atlas holds them), so distant snow matches the blocks laid
 * near the player. Returns false, keeping the colour, while the texels are
 * not readable yet.
 */
export function applySurfaceCoatFace(
  uniforms: Pick<SurfaceWeatherUniforms, "surfaceCoatColor">,
  pixels: ArrayLike<number> | null,
): boolean {
  const mean = pixels ? meanLinearRgb(pixels) : null;
  if (!mean) return false;
  uniforms.surfaceCoatColor.value.setRGB(mean[0], mean[1], mean[2]);
  return true;
}

/**
 * How far a chunk material takes the weather (`uSurfaceResponse`, per
 * material): its wetness. Zero skips the material entirely.
 */
export const SURFACE_RESPONSE = {
  /** Solid ground and everything drawn like it. */
  solid: 1,
  /** Leaves and other cutouts. */
  cutout: 1,
  /** Blended see-through blocks (glass): never darkened. */
  seeThrough: 0,
  /** Fluids: their own rings, in the water's branch. */
  fluid: 0,
} as const satisfies Record<string, number>;

/**
 * The voxel sunlight (0..1) over which a material's faces count as open to
 * the sky (`uSurfaceOpenLight`, per material). A solid face carries the
 * light of the air in front of it, which only the open sky keeps at its
 * full level. A see-through block (leaves, glass, plants) carries its own
 * voxel's light instead, which its own attenuation has already lowered: a
 * canopy's top leaves read 13 of 15 under open sky and the leaves a block
 * deeper 11, so they open lower and sharper.
 */
export const SURFACE_OPEN_LIGHT = {
  solid: [0.85, 0.98],
  seeThrough: [12.2 / 15, 12.9 / 15],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * The mean brightness a pock adds to a texel over time at full chance:
 * what the pattern averages to once texels are too small to draw it.
 */
export const SURFACE_POCK_MEAN = (() => {
  // Texels each frame lights inside a 4x4 cell around a centre in its
  // middle 2x2: one, four, and the six of the eight ring texels that fit.
  const texels = [1, 4, 6];
  let lit = 0;
  let start = 0;
  S.pockFrames.forEach((end, index) => {
    lit += (end - start) * texels[index] * S.pockWeights[index];
    start = end;
  });
  return (S.pockRate * lit) / (S.pockCellTexels * S.pockCellTexels);
})();

// ── CPU twins of the shading (shading/surface-weather.ts), for the tests ──

const mix32 = (value: number) => {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
};

/** `surfaceWeatherHash(vec2)`. */
export function surfaceWeatherHash2(x: number, y: number): number {
  const qx = Math.floor(x) | 0;
  const qy = Math.floor(y) | 0;
  return (mix32((qx + mix32(qy)) >>> 0) >>> 8) / 16777216;
}

/** `surfaceWeatherHash(vec3)`. */
export function surfaceWeatherHash3(x: number, y: number, z: number): number {
  const qx = Math.floor(x) | 0;
  const qy = Math.floor(y) | 0;
  const qz = Math.floor(z) | 0;
  return (mix32((qx + mix32((qy + mix32(qz)) >>> 0)) >>> 0) >>> 8) / 16777216;
}

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** `surfaceWeatherNoise`. */
export function surfaceWeatherNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let tx = x - ix;
  let ty = y - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = surfaceWeatherHash2(ix, iy);
  const b = surfaceWeatherHash2(ix + 1, iy);
  const c = surfaceWeatherHash2(ix, iy + 1);
  const d = surfaceWeatherHash2(ix + 1, iy + 1);
  const bottom = a + (b - a) * tx;
  const top = c + (d - c) * tx;
  return bottom + (top - bottom) * ty;
}

/** `surfaceCoatDrift`. */
export function surfaceCoatDrift(x: number, z: number): number {
  const drift =
    surfaceWeatherNoise(x / S.driftScaleLarge, z / S.driftScaleLarge) *
      S.driftWeightLarge +
    surfaceWeatherNoise(
      x / S.driftScaleSmall + 17.3,
      z / S.driftScaleSmall + 17.3,
    ) *
      (1 - S.driftWeightLarge);
  return Math.min(1, Math.max(0, (drift - 0.5) * S.driftContrast + 0.5));
}

/** `surfaceCoatDensity`. */
export function surfaceCoatDensity(coat: number, drift: number): number {
  const drifts = (coat - S.driftStart) / (1 - S.driftStart);
  return (
    Math.max(
      smoothstep(drift - S.driftSoftness, drift + S.driftSoftness, drifts),
      coat * S.coatSpeckle,
    ) * Math.min(coat * 25, 1)
  );
}

/** `surfaceCoatMean`. */
export function surfaceCoatMean(coat: number): number {
  const c = Math.min(1, Math.max(0, coat));
  const speckle = c * S.coatSpeckle;
  const drifts = (c - S.driftStart) / (1 - S.driftStart);
  return (
    speckle + (1 - speckle) * smoothstep(S.coatMean.from, S.coatMean.to, drifts)
  );
}

/**
 * `surfaceWeatherPock`: the brightness a raindrop puts on a texel at a time
 * (0 when none), with the share of slots that splash.
 */
export function surfaceWeatherPock(
  texelX: number,
  texelZ: number,
  seconds: number,
  chance: number,
): number {
  const cellX = Math.floor(texelX / S.pockCellTexels);
  const cellZ = Math.floor(texelZ / S.pockCellTexels);
  const localX = texelX - cellX * S.pockCellTexels;
  const localZ = texelZ - cellZ * S.pockCellTexels;
  const t = seconds * S.pockRate + surfaceWeatherHash3(cellX, cellZ, -1) * 31;
  const slot = Math.floor(t);
  const age = (t - slot) / S.pockRate;
  if (!(surfaceWeatherHash3(cellX, cellZ, slot * 3) < chance)) return 0;
  const centreX =
    1 + Math.floor(surfaceWeatherHash3(cellX, cellZ, slot * 3 + 1) * 2);
  const centreZ =
    1 + Math.floor(surfaceWeatherHash3(cellX, cellZ, slot * 3 + 2) * 2);
  const reach = Math.abs(localX - centreX) + Math.abs(localZ - centreZ);
  const [dot, plus, ring] = S.pockFrames;
  if (age < dot) return reach < 0.5 ? S.pockWeights[0] : 0;
  if (age < plus) return Math.abs(reach - 1) < 0.5 ? S.pockWeights[1] : 0;
  if (age < ring) return Math.abs(reach - 2) < 0.5 ? S.pockWeights[2] : 0;
  return 0;
}

/** Splashes showing at once per square block at a time, with the share of slots that splash. */
export function surfacePocksShowing(
  cellX: number,
  cellZ: number,
  seconds: number,
  chance: number,
): boolean {
  const t = seconds * S.pockRate + surfaceWeatherHash3(cellX, cellZ, -1) * 31;
  const slot = Math.floor(t);
  const age = (t - slot) / S.pockRate;
  return (
    surfaceWeatherHash3(cellX, cellZ, slot * 3) < chance &&
    age < S.pockFrames[S.pockFrames.length - 1]
  );
}
