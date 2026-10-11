import { describe, expect, it } from "vitest";

import {
  FLUID_WAVE,
  fluidWaveOctavesGlsl,
  fluidWaveOffset,
  fluidWaveSumGlsl,
  fluidWaveTimeGlsl,
  simplexNoise3,
} from "./fluid-waves";

type V = number[];

// A line-by-line transcription of SIMPLEX_NOISE_GLSL (shaders.ts) on
// component arrays, swizzles and all: a second, structurally independent
// reading of the shader for the CPU port to agree with.
const add = (a: V, b: V) => a.map((x, i) => x + b[i]);
const sub = (a: V, b: V) => a.map((x, i) => x - b[i]);
const mul = (a: V, b: V) => a.map((x, i) => x * b[i]);
const scale = (a: V, s: number) => a.map((x) => x * s);
const floorV = (a: V) => a.map(Math.floor);
const dot = (a: V, b: V) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const glslMod = (a: V, m: number) => a.map((x) => x - m * Math.floor(x / m));
const step = (edge: V, x: V) => x.map((v, i) => (v < edge[i] ? 0 : 1));
const pick = (a: V, swizzle: string) =>
  [...swizzle].map((c) => a["xyzw".indexOf(c)]);
const permuteV = (x: V) =>
  glslMod(mul(add(scale(x, 34), [1, 1, 1, 1]), x), 289);

function glslSnoise(v: V): number {
  const C = [1 / 6, 1 / 3];
  const D = [0, 0.5, 1, 2];
  let i = floorV(
    add(
      v,
      [1, 1, 1].map(() => dot(v, [C[1], C[1], C[1]])),
    ),
  );
  const x0 = add(
    sub(v, i),
    [1, 1, 1].map(() => dot(i, [C[0], C[0], C[0]])),
  );
  const g = step(pick(x0, "yzx"), x0);
  const l = g.map((x) => 1 - x);
  const i1 = g.map((x, k) => Math.min(x, pick(l, "zxy")[k]));
  const i2 = g.map((x, k) => Math.max(x, pick(l, "zxy")[k]));
  const x1 = add(sub(x0, i1), [C[0], C[0], C[0]]);
  const x2 = add(sub(x0, i2), [2 * C[0], 2 * C[0], 2 * C[0]]);
  const x3 = add(x0, [-1 + 3 * C[0], -1 + 3 * C[0], -1 + 3 * C[0]]);
  i = glslMod(i, 289);
  const p = permuteV(
    add(
      add(
        permuteV(
          add(
            add(permuteV(add([i[2], i[2], i[2], i[2]], [0, i1[2], i2[2], 1])), [
              i[1],
              i[1],
              i[1],
              i[1],
            ]),
            [0, i1[1], i2[1], 1],
          ),
        ),
        [i[0], i[0], i[0], i[0]],
      ),
      [0, i1[0], i2[0], 1],
    ),
  );
  const n_ = 1 / 7;
  const ns = sub(scale(pick(D, "wyz"), n_), pick(D, "xzx"));
  const j = sub(p, scale(floorV(scale(scale(p, ns[2]), ns[2])), 49));
  const x_ = floorV(scale(j, ns[2]));
  const y_ = floorV(sub(j, scale(x_, 7)));
  const x = add(scale(x_, ns[0]), [ns[1], ns[1], ns[1], ns[1]]);
  const y = add(scale(y_, ns[0]), [ns[1], ns[1], ns[1], ns[1]]);
  const h = sub([1, 1, 1, 1], add(x.map(Math.abs), y.map(Math.abs)));
  const b0 = [x[0], x[1], y[0], y[1]];
  const b1 = [x[2], x[3], y[2], y[3]];
  const s0 = add(scale(floorV(b0), 2), [1, 1, 1, 1]);
  const s1 = add(scale(floorV(b1), 2), [1, 1, 1, 1]);
  const sh = step(h, [0, 0, 0, 0]).map((x) => -x);
  const a0 = add(pick(b0, "xzyw"), mul(pick(s0, "xzyw"), pick(sh, "xxyy")));
  const a1 = add(pick(b1, "xzyw"), mul(pick(s1, "xzyw"), pick(sh, "zzww")));
  let p0 = [a0[0], a0[1], h[0]];
  let p1 = [a0[2], a0[3], h[1]];
  let p2 = [a1[0], a1[1], h[2]];
  let p3 = [a1[2], a1[3], h[3]];
  const norm = [dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)].map(
    (r) => 1.79284291400159 - 0.85373472095314 * r,
  );
  p0 = scale(p0, norm[0]);
  p1 = scale(p1, norm[1]);
  p2 = scale(p2, norm[2]);
  p3 = scale(p3, norm[3]);
  let m = [dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)].map((d) =>
    Math.max(0.6 - d, 0),
  );
  m = mul(m, m);
  return (
    42 * dot(mul(m, m), [dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)])
  );
}

describe("fluid waves", () => {
  it("evaluates the shader's simplex noise on the CPU", () => {
    for (let i = 0; i < 400; i++) {
      const v = [
        Math.sin(i * 12.9898) * 137.5,
        Math.cos(i * 78.233) * 61.3,
        (i % 7) * 10 - 20.25,
      ];
      expect(simplexNoise3(v[0], v[1], v[2])).toBeCloseTo(glslSnoise(v), 10);
    }
  });

  it("keeps the swell inside the octaves' amplitudes", () => {
    const bound = FLUID_WAVE.octaves.reduce((sum, o) => sum + o.amplitude, 0);
    let highest = 0;
    for (let x = -40; x < 40; x += 0.73) {
      for (let t = 0; t < 600_000; t += 37_123) {
        const offset = fluidWaveOffset(x, x * 0.41 - 3, t);
        expect(Math.abs(offset)).toBeLessThanOrEqual(bound);
        highest = Math.max(highest, Math.abs(offset));
      }
    }
    expect(highest).toBeGreaterThan(bound * 0.3);
  });

  it("drifts smoothly: a float riding it never jumps", () => {
    const step = 1 / 60;
    for (let x = 0; x < 30; x += 1.1) {
      const now = fluidWaveOffset(x, 4.2, 120_000);
      const next = fluidWaveOffset(x, 4.2, 120_000 + step * 1000);
      expect(Math.abs(next - now)).toBeLessThan(0.01);
    }
  });

  it("writes the same swell into the vertex stage", () => {
    expect(fluidWaveTimeGlsl("uTime")).toBe("uTime * 0.0006");
    expect(fluidWaveOctavesGlsl("p.x", "p.z", "waveTime").split("\n")).toEqual([
      "float wave1 = snoise(vec3(p.x * 0.1500 + waveTime * 0.3000, p.z * 0.1500 + waveTime * -0.2000, 0.0000)) * 0.0800;",
      "float wave2 = snoise(vec3(p.x * 0.4000 + waveTime * -0.5000, p.z * 0.4000 + waveTime * 0.4000, 10.0000)) * 0.0400;",
      "float wave3 = snoise(vec3(p.x * 0.8000 + waveTime * 0.7000, p.z * 0.8000 + waveTime * -0.5000, 20.0000)) * 0.0200;",
    ]);
    expect(fluidWaveSumGlsl()).toBe("wave1 + wave2 + wave3");
  });
});
