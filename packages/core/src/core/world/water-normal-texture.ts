import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from "three";

/**
 * How the water surface's tileable slope map is baked. The fragment shader
 * samples it at several world scales and drifts, and sums the decoded slopes
 * into the surface normal; everything about the *shape* of the ripples lives
 * here, everything about their *scale and speed* lives in the layer table.
 */
export type WaterNormalTextureOptions = {
  /** Texels per side. A power of two, so the mip chain reaches 1x1. */
  size: number;
  /**
   * Lattice cells per tile at the coarsest octave. The noise wraps at this
   * period, which is what makes the tile seamless.
   */
  latticePeriod: number;
  /** Octaves of ridged noise summed into the height field. */
  octaves: number;
  /** Amplitude ratio between successive octaves. */
  gain: number;
  /**
   * Exponent of the ridge fold `(1 - |noise|)^sharpness`. Higher pinches
   * the crests thinner; 1 leaves them as wide as the troughs.
   */
  ridgeSharpness: number;
  /** Seeds the lattice gradients; the same seed bakes the same tile. */
  seed: number;
  /**
   * Requested anisotropic filtering. A water plane is looked at near
   * grazing most of the time, where isotropic mips blur the ripples out a
   * long way before they are subpixel. The renderer clamps this to the
   * device maximum.
   */
  anisotropy: number;
};

/**
 * Xorshift-multiplied integer hash, folded to 0..1. Deterministic per seed so
 * a tile is reproducible across sessions and machines.
 */
function hashLattice(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * One octave's wrapped lattice of unit gradients, `period` cells on a side,
 * interleaved (x, y). Built once per octave: the lattice is a few dozen
 * cells while the tile is tens of thousands of texels, so hashing at every
 * texel was most of the bake.
 */
type GradientLattice = { period: number; gradients: Float32Array };

function makeGradientLattice(period: number, seed: number): GradientLattice {
  const gradients = new Float32Array(period * period * 2);
  for (let y = 0; y < period; y += 1) {
    for (let x = 0; x < period; x += 1) {
      const angle = hashLattice(x, y, seed) * Math.PI * 2;
      gradients[(y * period + x) * 2] = Math.cos(angle);
      gradients[(y * period + x) * 2 + 1] = Math.sin(angle);
    }
  }
  return { period, gradients };
}

/**
 * Periodic 2D gradient noise on a prebuilt lattice: the lattice wraps at its
 * period on both axes, so the field is continuous across the tile seam.
 * Range is about -0.7..0.7.
 */
function periodicGradientNoise(
  x: number,
  y: number,
  lattice: GradientLattice,
): number {
  const { period, gradients } = lattice;
  const xFloor = Math.floor(x);
  const yFloor = Math.floor(y);
  const fx = x - xFloor;
  const fy = y - yFloor;
  const x0 = ((xFloor % period) + period) % period;
  const y0 = ((yFloor % period) + period) % period;
  const x1 = x0 + 1 === period ? 0 : x0 + 1;
  const y1 = y0 + 1 === period ? 0 : y0 + 1;

  const i00 = (y0 * period + x0) * 2;
  const i10 = (y0 * period + x1) * 2;
  const i01 = (y1 * period + x0) * 2;
  const i11 = (y1 * period + x1) * 2;
  const n00 = gradients[i00] * fx + gradients[i00 + 1] * fy;
  const n10 = gradients[i10] * (fx - 1) + gradients[i10 + 1] * fy;
  const n01 = gradients[i01] * fx + gradients[i01 + 1] * (fy - 1);
  const n11 = gradients[i11] * (fx - 1) + gradients[i11 + 1] * (fy - 1);

  const u = fade(fx);
  const v = fade(fy);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return nx0 + (nx1 - nx0) * v;
}

type RidgeOptions = Pick<
  WaterNormalTextureOptions,
  "latticePeriod" | "octaves" | "gain" | "ridgeSharpness" | "seed"
>;

/** The per-octave lattices `ridgedHeight` reads, built once per bake. */
export function makeRidgeLattices(options: RidgeOptions): GradientLattice[] {
  const lattices: GradientLattice[] = [];
  let period = options.latticePeriod;
  for (let octave = 0; octave < options.octaves; octave += 1) {
    lattices.push(makeGradientLattice(period, options.seed + octave * 7919));
    period *= 2;
  }
  return lattices;
}

/**
 * Ridged multifractal height at tile coordinate (u, v) in 0..1: each octave
 * folds its noise about zero so the zero crossings become sharp crests with
 * smooth troughs between them — the wind-ripple silhouette. A sum of plain
 * sinusoids has no such creases, and a surface without them reads as a
 * sheet of gel however it moves. Pass the lattices from
 * {@link makeRidgeLattices} when evaluating many points.
 */
export function ridgedHeight(
  u: number,
  v: number,
  options: RidgeOptions,
  lattices: GradientLattice[] = makeRidgeLattices(options),
): number {
  let height = 0;
  let amplitude = 1;
  for (const lattice of lattices) {
    const noise = periodicGradientNoise(
      u * lattice.period,
      v * lattice.period,
      lattice,
    );
    // The 2D gradient noise peaks near ±0.7; scale so the fold spans 0..1.
    const folded = 1 - Math.min(Math.abs(noise) * 1.4, 1);
    height += Math.pow(folded, options.ridgeSharpness) * amplitude;
    amplitude *= options.gain;
  }
  return height;
}

/**
 * Bakes the height field and its central-difference slopes into RGBA8:
 * red and green carry the x and y slopes, normalized so the steepest facet
 * in the tile lands at ±1 after {@link WATER_NORMAL_DECODE_GLSL}; blue is
 * the height in 0..1 (crest detection, future parallax); alpha is opaque.
 * The tile's slope integrates to zero over a period, so every mip level
 * averages toward a flat normal — distant water goes calm on its own.
 */
export function bakeWaterNormalData(options: WaterNormalTextureOptions): {
  data: Uint8Array;
  maxAbsSlope: number;
} {
  const { size } = options;
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error(
      `water normal texture size must be a power of two >= 2, got ${size}`,
    );
  }

  const lattices = makeRidgeLattices(options);
  const heights = new Float32Array(size * size);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const h = ridgedHeight(x / size, y / size, options, lattices);
      heights[y * size + x] = h;
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }
  }
  const heightSpan = Math.max(maxHeight - minHeight, 1e-6);

  const slopes = new Float32Array(size * size * 2);
  let maxAbsSlope = 0;
  for (let y = 0; y < size; y += 1) {
    const yPrev = (y + size - 1) % size;
    const yNext = (y + 1) % size;
    for (let x = 0; x < size; x += 1) {
      const xPrev = (x + size - 1) % size;
      const xNext = (x + 1) % size;
      const sx = (heights[y * size + xNext] - heights[y * size + xPrev]) * 0.5;
      const sy = (heights[yNext * size + x] - heights[yPrev * size + x]) * 0.5;
      slopes[(y * size + x) * 2] = sx;
      slopes[(y * size + x) * 2 + 1] = sy;
      maxAbsSlope = Math.max(maxAbsSlope, Math.abs(sx), Math.abs(sy));
    }
  }
  const slopeScale = maxAbsSlope > 0 ? 1 / maxAbsSlope : 0;

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const sx = slopes[i * 2] * slopeScale;
    const sy = slopes[i * 2 + 1] * slopeScale;
    data[i * 4] = Math.round((sx * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((sy * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round(((heights[i] - minHeight) / heightSpan) * 255);
    data[i * 4 + 3] = 255;
  }

  return { data, maxAbsSlope };
}

/**
 * The GPU texture the fluid shader samples for its surface normal. Baked
 * once per world at renderer construction, inside the load phase: a quarter
 * megabyte of data, 20-30ms of CPU measured at 256x256, no network round
 * trip and nothing to ship.
 */
export function makeWaterNormalTexture(
  options: WaterNormalTextureOptions,
): DataTexture {
  const { data } = bakeWaterNormalData(options);
  const texture = new DataTexture(
    data,
    options.size,
    options.size,
    RGBAFormat,
    UnsignedByteType,
  );
  // Slopes are data, not color: a color-space transform would bend them.
  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = options.anisotropy;
  texture.needsUpdate = true;
  return texture;
}
