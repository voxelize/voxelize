import { describe, expect, it } from "vitest";

import {
  computeQuadLightTwist,
  QUAD_LIGHT_CORNER_FLAG,
  QUAD_LIGHT_TWIST_BIAS,
  QUAD_LIGHT_TWIST_NEUTRAL,
} from "./quad-light";
import {
  SHADER_LIGHTING_CHUNK_SHADERS,
  SHADER_LIGHTING_CROSS_CHUNK_SHADERS,
  SHADER_LIGHTING_FLUID_CHUNK_SHADERS,
  SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS,
} from "./shaders";

/** The two index patterns the mesher emits (faces.rs, greedy.rs). */
const SPLIT_AD = [0, 1, 3, 3, 2, 0];
const SPLIT_BC = [0, 1, 2, 2, 1, 3];
/** Quad-local position of corners a, b, c, d. */
const CORNER_UV: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
const SHIFTS = [8, 4, 0, 12];

type Corner = [number, number, number, number];

function pack([r, g, b, s]: Corner, extraBits = 0) {
  return (r << 8) | (g << 4) | b | (s << 12) | extraBits;
}

/** Exactly what the vertex shader decodes from one vertex's four bytes. */
function decodeVertex(bytes: Uint8Array, v: number) {
  const x = bytes[v * 4];
  const y = bytes[v * 4 + 1];
  const head = x >= QUAD_LIGHT_CORNER_FLAG ? 1 : 0;
  const tail = y >= QUAD_LIGHT_CORNER_FLAG ? 1 : 0;
  const twist = [
    x - head * QUAD_LIGHT_CORNER_FLAG - QUAD_LIGHT_TWIST_BIAS,
    y - tail * QUAD_LIGHT_CORNER_FLAG - QUAD_LIGHT_TWIST_BIAS,
    bytes[v * 4 + 2] - QUAD_LIGHT_TWIST_BIAS,
    bytes[v * 4 + 3] - QUAD_LIGHT_TWIST_BIAS,
  ];
  // vLightTwist (in levels here, the shader divides by 15) and vQuadLightTail.
  return { lightTwist: twist.map((k) => k * head), tail };
}

/** Barycentric weights of (u, v) in triangle p0 p1 p2, or null outside. */
function barycentric(
  u: number,
  v: number,
  [p0, p1, p2]: [number, number][],
): [number, number, number] | null {
  const det =
    (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
  const w1 =
    ((u - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (v - p0[1])) / det;
  const w2 =
    ((p1[0] - p0[0]) * (v - p0[1]) - (u - p0[0]) * (p1[1] - p0[1])) / det;
  const w0 = 1 - w1 - w2;
  const eps = 1e-9;
  return w0 >= -eps && w1 >= -eps && w2 >= -eps ? [w0, w1, w2] : null;
}

/**
 * Rasterize one fragment of a quad the way the GPU does: find the triangle
 * holding (u, v), interpolate every varying linearly inside it, then apply
 * the fragment correction. Returns the corrected value per channel.
 */
function shade(corners: Corner[], pattern: number[], u: number, v: number) {
  const lights = corners.map((c) => pack(c));
  const bytes = computeQuadLightTwist(lights, pattern);
  for (const tri of [pattern.slice(0, 3), pattern.slice(3, 6)]) {
    const weights = barycentric(
      u,
      v,
      tri.map((i) => CORNER_UV[i]) as [number, number][],
    );
    if (!weights) continue;
    const out: number[] = [];
    for (let channel = 0; channel < 4; channel++) {
      let linear = 0;
      let lightTwist = 0;
      let tail = 0;
      tri.forEach((vertex, k) => {
        const decoded = decodeVertex(bytes, vertex);
        linear += weights[k] * ((lights[vertex] >> SHIFTS[channel]) & 0xf);
        lightTwist += weights[k] * decoded.lightTwist[channel];
        tail += weights[k] * decoded.tail;
      });
      out.push(Math.max(linear - lightTwist * tail, 0));
    }
    return out;
  }
  throw new Error(`(${u}, ${v}) is in neither triangle`);
}

function bilinear(corners: Corner[], u: number, v: number) {
  return [0, 1, 2, 3].map(
    (channel) =>
      corners[0][channel] * (1 - u) * (1 - v) +
      corners[1][channel] * u * (1 - v) +
      corners[2][channel] * (1 - u) * v +
      corners[3][channel] * u * v,
  );
}

function randomCorners(seed: number): Corner[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % 16;
  };
  return [0, 1, 2, 3].map(() => [next(), next(), next(), next()] as Corner);
}

const SAMPLES: [number, number][] = [];
for (let u = 0; u <= 1.0001; u += 0.125) {
  for (let v = 0; v <= 1.0001; v += 0.125) SAMPLES.push([u, v]);
}

describe("bilinear voxel light across a quad", () => {
  it("reproduces the bilinear blend of the four corners on either diagonal", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const corners = randomCorners(seed);
      for (const pattern of [SPLIT_AD, SPLIT_BC]) {
        for (const [u, v] of SAMPLES) {
          const got = shade(corners, pattern, u, v);
          const want = bilinear(corners, u, v);
          for (let c = 0; c < 4; c++) expect(got[c]).toBeCloseTo(want[c], 9);
        }
      }
    }
  });

  it("turns one lit corner into a rounded falloff instead of a triangle", () => {
    // Red on corner a only: per triangle, the b-c split lights one triangle
    // and leaves the other black, a hard diagonal edge through the quad.
    const corners: Corner[] = [
      [15, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const nearDiagonal = shade(corners, SPLIT_BC, 0.55, 0.55)[0];
    expect(nearDiagonal).toBeCloseTo(15 * 0.45 * 0.45, 9);
    expect(nearDiagonal).toBeGreaterThan(0);
    expect(shade(corners, SPLIT_BC, 0.5, 0.5)[0]).toBeCloseTo(15 / 4, 9);
    expect(shade(corners, SPLIT_AD, 0.5, 0.5)[0]).toBeCloseTo(15 / 4, 9);
  });

  it("leaves every quad edge on its corners' linear blend, so neighbours still meet", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const corners = randomCorners(seed);
      for (const pattern of [SPLIT_AD, SPLIT_BC]) {
        for (let t = 0; t <= 1.0001; t += 0.1) {
          for (const [u, v] of [
            [t, 0],
            [t, 1],
            [0, t],
            [1, t],
          ]) {
            const got = shade(corners, pattern, u, v);
            const want = bilinear(corners, u, v);
            for (let c = 0; c < 4; c++) expect(got[c]).toBeCloseTo(want[c], 9);
          }
        }
      }
    }
  });

  it("keeps a planar quad exactly as the triangles drew it", () => {
    const corners: Corner[] = [
      [12, 3, 0, 15],
      [11, 3, 1, 14],
      [11, 2, 1, 14],
      [10, 2, 2, 13],
    ];
    const bytes = computeQuadLightTwist(
      corners.map((c) => pack(c)),
      SPLIT_AD,
    );
    for (let v = 0; v < 4; v++) {
      expect(bytes[v * 4 + 2]).toBe(QUAD_LIGHT_TWIST_BIAS);
      expect(bytes[v * 4 + 3]).toBe(QUAD_LIGHT_TWIST_BIAS);
    }
  });

  it("reads only the light nibbles of the packed word", () => {
    const corners = randomCorners(7);
    const plain = computeQuadLightTwist(
      corners.map((c) => pack(c)),
      SPLIT_BC,
    );
    // AO, fluid, stack and the sign-bit tint all sit above bit 15.
    const tagged = computeQuadLightTwist(
      corners.map((c, i) => pack(c, (i << 16) | (1 << 21) | (1 << 31))),
      SPLIT_BC,
    );
    expect(Array.from(tagged)).toEqual(Array.from(plain));
  });

  it("marks exactly one head and one tail per quad and never overflows a byte", () => {
    const extreme: Corner[] = [
      [15, 15, 15, 15],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [15, 15, 15, 15],
    ];
    for (const corners of [extreme, [...extreme].reverse()]) {
      for (const pattern of [SPLIT_AD, SPLIT_BC]) {
        const bytes = computeQuadLightTwist(
          corners.map((c) => pack(c)),
          pattern,
        );
        let heads = 0;
        let tails = 0;
        for (let v = 0; v < 4; v++) {
          if (bytes[v * 4] >= QUAD_LIGHT_CORNER_FLAG) heads++;
          if (bytes[v * 4 + 1] >= QUAD_LIGHT_CORNER_FLAG) tails++;
          for (let c = 0; c < 4; c++) {
            expect(bytes[v * 4 + c]).toBeLessThanOrEqual(
              QUAD_LIGHT_CORNER_FLAG + 2 * QUAD_LIGHT_TWIST_BIAS,
            );
          }
        }
        expect([heads, tails]).toEqual([1, 1]);
      }
    }
  });

  it("covers every quad of a multi-quad geometry and skips foreign patterns", () => {
    const lit: Corner = [15, 0, 0, 0];
    const dark: Corner = [0, 0, 0, 0];
    const quad = [lit, dark, dark, dark].map((c) => pack(c));
    const lights = [...quad, ...quad, ...quad];
    const indices = [
      ...SPLIT_AD,
      ...SPLIT_BC.map((i) => i + 4),
      // Not a mesher quad: one triangle fan with a different order.
      8,
      10,
      9,
      9,
      10,
      11,
    ];
    const bytes = computeQuadLightTwist(lights, indices);
    expect(bytes.length).toBe(lights.length * 4);
    // Split a-d: a is the head, twist +15. Split b-c: c is the head, -15.
    expect(bytes[0] - QUAD_LIGHT_CORNER_FLAG - QUAD_LIGHT_TWIST_BIAS).toBe(15);
    expect(
      bytes[(4 + 2) * 4] - QUAD_LIGHT_CORNER_FLAG - QUAD_LIGHT_TWIST_BIAS,
    ).toBe(-15);
    for (let v = 8; v < 12; v++) {
      expect(Array.from(bytes.slice(v * 4, v * 4 + 4))).toEqual([
        ...QUAD_LIGHT_TWIST_NEUTRAL,
      ]);
    }
  });

  it("is what every chunk fragment reads its voxel light through", () => {
    const fragments = {
      opaque: SHADER_LIGHTING_CHUNK_SHADERS.fragment,
      fluid: SHADER_LIGHTING_FLUID_CHUNK_SHADERS.fragment,
      seeThrough: SHADER_LIGHTING_SEE_THROUGH_CHUNK_SHADERS.fragment,
      cross: SHADER_LIGHTING_CROSS_CHUNK_SHADERS.fragment,
    };
    for (const [name, fragment] of Object.entries(fragments)) {
      // vLight appears in its declaration and inside the helper only: a
      // direct read elsewhere would skip the correction.
      const reads = fragment.match(/\bvLight\b/g) ?? [];
      expect(reads.length, name).toBe(2);
      expect(fragment, name).toContain(
        "vec4 voxelLight = bilinearVoxelLight();",
      );
      expect(fragment, name).toContain("uniform float uBlockLightBilinear;");
    }
    expect(SHADER_LIGHTING_CHUNK_SHADERS.vertex).toContain(
      "attribute vec4 lightTwist;",
    );
    expect(SHADER_LIGHTING_CHUNK_SHADERS.vertex).toContain(
      "vLightTwist = quadLightTwist * (quadLightHead / 15.0);",
    );
  });
});
