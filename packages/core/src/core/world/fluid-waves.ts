import { float, vec3 } from "three/tsl";

import { simplexNoise3Node } from "./shading/noise";
import type { FloatNode } from "./shading/types";

/**
 * The swell a resting fluid surface rides: three octaves of the chunk
 * shader's simplex noise over world x/z and the shader clock. The vertex
 * stage sums this table ({@link fluidWaveNode}), and
 * {@link fluidWaveOffset} sums the same octaves on the CPU, so something
 * floating on the water can ride the surface the player sees instead of
 * sinking into its crests. The shader clock follows the world's shared
 * clock, so every client draws, and floats on, the same swell.
 */
export const FLUID_WAVE = {
  /** Shader clock (ms) to wave time. */
  timeScale: 0.0006,
  octaves: [
    { frequency: 0.15, driftX: 0.3, driftZ: -0.2, seed: 0, amplitude: 0.08 },
    { frequency: 0.4, driftX: -0.5, driftZ: 0.4, seed: 10, amplitude: 0.04 },
    { frequency: 0.8, driftX: 0.7, driftZ: -0.5, seed: 20, amplitude: 0.02 },
  ],
} as const;

/**
 * The swell (blocks) at world `x`/`z` and shader clock `timeMs`, as a TSL
 * node: what the chunk vertex stage adds to a resting fluid surface, and
 * what anything drawn on the water (shore foam) rides to stay on it.
 */
export function fluidWaveNode(
  x: FloatNode,
  z: FloatNode,
  timeMs: FloatNode,
): FloatNode {
  const time = timeMs.mul(FLUID_WAVE.timeScale);
  let sum: FloatNode = float(0);
  for (const octave of FLUID_WAVE.octaves) {
    sum = sum.add(
      simplexNoise3Node(
        vec3(
          x.mul(octave.frequency).add(time.mul(octave.driftX)),
          z.mul(octave.frequency).add(time.mul(octave.driftZ)),
          octave.seed,
        ),
      ).mul(octave.amplitude),
    );
  }
  return sum;
}

const mod289 = (x: number) => x - 289 * Math.floor(x / 289);
const permute = (x: number) => mod289((x * 34 + 1) * x);
const taylorInvSqrt = (r: number) => 1.79284291400159 - 0.85373472095314 * r;

const SKEW = 1 / 3;
const UNSKEW = 1 / 6;
const NS_X = 2 / 7;
const NS_Y = 0.5 / 7 - 1;
const NS_Z = 1 / 7;

const corner = [0, 0, 0, 0];

/** One simplex corner's falloff-weighted gradient dot, as `simplexNoise3Node` (shading/noise.ts) does it. */
function cornerContribution(
  hash: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const j = hash - 49 * Math.floor(hash * NS_Z * NS_Z);
  const gx = Math.floor(j * NS_Z) * NS_X + NS_Y;
  const gy = Math.floor(j - 7 * Math.floor(j * NS_Z)) * NS_X + NS_Y;
  const h = 1 - Math.abs(gx) - Math.abs(gy);
  const sh = h <= 0 ? -1 : 0;
  const px = gx + (Math.floor(gx) * 2 + 1) * sh;
  const py = gy + (Math.floor(gy) * 2 + 1) * sh;
  const norm = taylorInvSqrt(px * px + py * py + h * h);
  const falloff = Math.max(0.6 - (dx * dx + dy * dy + dz * dz), 0);
  const m = falloff * falloff;
  return m * m * (px * norm * dx + py * norm * dy + h * norm * dz);
}

/** The chunk shader's 3D simplex noise (`simplexNoise3Node`), on the CPU. */
export function simplexNoise3(vx: number, vy: number, vz: number): number {
  const s = (vx + vy + vz) * SKEW;
  const ix = Math.floor(vx + s);
  const iy = Math.floor(vy + s);
  const iz = Math.floor(vz + s);
  const t = (ix + iy + iz) * UNSKEW;
  const x0 = vx - ix + t;
  const y0 = vy - iy + t;
  const z0 = vz - iz + t;

  const gx = x0 >= y0 ? 1 : 0;
  const gy = y0 >= z0 ? 1 : 0;
  const gz = z0 >= x0 ? 1 : 0;
  const i1x = Math.min(gx, 1 - gz);
  const i1y = Math.min(gy, 1 - gx);
  const i1z = Math.min(gz, 1 - gy);
  const i2x = Math.max(gx, 1 - gz);
  const i2y = Math.max(gy, 1 - gx);
  const i2z = Math.max(gz, 1 - gy);

  const mx = mod289(ix);
  const my = mod289(iy);
  const mz = mod289(iz);
  const hash = (ox: number, oy: number, oz: number) =>
    permute(permute(permute(mz + oz) + my + oy) + mx + ox);

  corner[0] = cornerContribution(hash(0, 0, 0), x0, y0, z0);
  corner[1] = cornerContribution(
    hash(i1x, i1y, i1z),
    x0 - i1x + UNSKEW,
    y0 - i1y + UNSKEW,
    z0 - i1z + UNSKEW,
  );
  corner[2] = cornerContribution(
    hash(i2x, i2y, i2z),
    x0 - i2x + 2 * UNSKEW,
    y0 - i2y + 2 * UNSKEW,
    z0 - i2z + 2 * UNSKEW,
  );
  corner[3] = cornerContribution(
    hash(1, 1, 1),
    x0 - 1 + 3 * UNSKEW,
    y0 - 1 + 3 * UNSKEW,
    z0 - 1 + 3 * UNSKEW,
  );
  return 42 * (corner[0] + corner[1] + corner[2] + corner[3]);
}

/**
 * How far (blocks) the swell lifts a resting fluid surface at world `x`/`z`
 * at shader clock `timeMs` (`chunkRenderer.uniforms.time`): what the vertex
 * stage adds to the surface's rest height.
 */
export function fluidWaveOffset(x: number, z: number, timeMs: number): number {
  const waveTime = timeMs * FLUID_WAVE.timeScale;
  let offset = 0;
  for (const {
    frequency,
    driftX,
    driftZ,
    seed,
    amplitude,
  } of FLUID_WAVE.octaves) {
    offset +=
      simplexNoise3(
        x * frequency + waveTime * driftX,
        z * frequency + waveTime * driftZ,
        seed,
      ) * amplitude;
  }
  return offset;
}
