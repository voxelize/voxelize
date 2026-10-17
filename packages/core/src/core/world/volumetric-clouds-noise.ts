/**
 * The density volume a {@link VolumetricClouds} layer samples: a tileable
 * RGBA8 block, `size[0] * size[1] * size[2]` texels, wrapping on every axis
 * so the deck repeats seamlessly as it drifts.
 *
 * - R: cloud shape. Low-frequency value noise eroded by inverted Worley
 *   cells, so a bank comes out in rounded billows instead of noise blobs.
 * - G: detail. Higher-frequency Worley, for the soft style to eat ragged
 *   edges out of the shape.
 * - B: coverage. Very low-frequency value noise the shader samples at a
 *   larger, non-commensurate scale, so where it is cloudy at all changes
 *   across distances far beyond one tile and the repeat never lines up.
 */
export type CloudNoiseVolumeOptions = {
  size: [number, number, number];
  seed: number;
};

const hash3 = (x: number, y: number, z: number, seed: number) => {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  h ^= Math.imul(z, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

const wrap = (value: number, period: number) =>
  ((value % period) + period) % period;

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Value noise in [0, 1] whose lattice repeats every `period` cells per axis. */
const periodicValue = (
  x: number,
  y: number,
  z: number,
  period: [number, number, number],
  seed: number,
) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const fz = smooth(z - iz);
  const x0 = wrap(ix, period[0]);
  const y0 = wrap(iy, period[1]);
  const z0 = wrap(iz, period[2]);
  const x1 = wrap(ix + 1, period[0]);
  const y1 = wrap(iy + 1, period[1]);
  const z1 = wrap(iz + 1, period[2]);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(
      lerp(hash3(x0, y0, z0, seed), hash3(x1, y0, z0, seed), fx),
      lerp(hash3(x0, y1, z0, seed), hash3(x1, y1, z0, seed), fx),
      fy,
    ),
    lerp(
      lerp(hash3(x0, y0, z1, seed), hash3(x1, y0, z1, seed), fx),
      lerp(hash3(x0, y1, z1, seed), hash3(x1, y1, z1, seed), fx),
      fy,
    ),
    fz,
  );
};

/**
 * Distance to the nearest feature point of a periodic Worley lattice,
 * inverted to [0, 1] so cell centres are bright: the rounded tops of a
 * billow.
 */
const periodicWorley = (
  x: number,
  y: number,
  z: number,
  period: [number, number, number],
  seed: number,
) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let nearest = 9;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;
        const wx = wrap(cx, period[0]);
        const wy = wrap(cy, period[1]);
        const wz = wrap(cz, period[2]);
        const px = cx + hash3(wx, wy, wz, seed);
        const py = cy + hash3(wx, wy, wz, seed + 101);
        const pz = cz + hash3(wx, wy, wz, seed + 211);
        const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (d < nearest) nearest = d;
      }
    }
  }

  return Math.max(0, 1 - Math.sqrt(nearest));
};

/** Fractal value noise; every octave's period divides the tile. */
const periodicFbm = (
  x: number,
  y: number,
  z: number,
  period: [number, number, number],
  octaves: number,
  seed: number,
) => {
  let total = 0;
  let amplitude = 1;
  let weight = 0;
  let frequency = 1;

  for (let i = 0; i < octaves; i++) {
    total +=
      periodicValue(
        x * frequency,
        y * frequency,
        z * frequency,
        [period[0] * frequency, period[1] * frequency, period[2] * frequency],
        seed + i * 1013,
      ) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / weight;
};

const remap = (v: number, lo: number, hi: number) =>
  Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

export function generateCloudNoiseVolume({
  size,
  seed,
}: CloudNoiseVolumeOptions): Uint8Array {
  const [sx, sy, sz] = size;
  const data = new Uint8Array(sx * sy * sz * 4);

  // Lattice periods in cells across one tile. Vertical periods are smaller:
  // a deck is far wider than it is tall.
  const shapePeriod: [number, number, number] = [8, 2, 8];
  const billowPeriod: [number, number, number] = [16, 4, 16];
  const detailPeriod: [number, number, number] = [32, 8, 32];
  const coveragePeriod: [number, number, number] = [3, 1, 3];

  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < sx; x++) {
        const u = x / sx;
        const v = y / sy;
        const w = z / sz;

        const shape = periodicFbm(
          u * shapePeriod[0],
          v * shapePeriod[1],
          w * shapePeriod[2],
          shapePeriod,
          3,
          seed,
        );
        const billow = periodicWorley(
          u * billowPeriod[0],
          v * billowPeriod[1],
          w * billowPeriod[2],
          billowPeriod,
          seed + 7,
        );
        const detail = periodicWorley(
          u * detailPeriod[0],
          v * detailPeriod[1],
          w * detailPeriod[2],
          detailPeriod,
          seed + 13,
        );
        const coverage = periodicFbm(
          u * coveragePeriod[0],
          0,
          w * coveragePeriod[2],
          coveragePeriod,
          2,
          seed + 29,
        );

        // Worley carves the fbm into billows: where the cells are dim the
        // shape is pushed down, so the gaps between billows open up.
        const cloud = remap(shape, (1 - billow) * 0.55, 1);

        const i = (x + y * sx + z * sx * sy) * 4;
        data[i] = Math.round(cloud * 255);
        data[i + 1] = Math.round(detail * 255);
        data[i + 2] = Math.round(remap(coverage, 0.2, 0.8) * 255);
        data[i + 3] = 255;
      }
    }
  }

  return data;
}
