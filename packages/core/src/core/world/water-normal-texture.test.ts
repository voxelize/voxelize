import { describe, expect, it } from "vitest";

import {
  bakeWaterNormalData,
  ridgedHeight,
  WaterNormalTextureOptions,
} from "./water-normal-texture";
import { WATER_OPTICS } from "./water-optics";

const OPTIONS: WaterNormalTextureOptions = {
  ...WATER_OPTICS.surfaceNormalTexture,
  size: 64,
};

describe("ridgedHeight", () => {
  it("wraps seamlessly across the tile", () => {
    for (const t of [0.13, 0.5, 0.87]) {
      expect(ridgedHeight(0, t, OPTIONS)).toBeCloseTo(
        ridgedHeight(1, t, OPTIONS),
        6,
      );
      expect(ridgedHeight(t, 0, OPTIONS)).toBeCloseTo(
        ridgedHeight(t, 1, OPTIONS),
        6,
      );
    }
  });

  it("is deterministic per seed and changes with it", () => {
    expect(ridgedHeight(0.3, 0.7, OPTIONS)).toBe(
      ridgedHeight(0.3, 0.7, { ...OPTIONS }),
    );
    expect(ridgedHeight(0.3, 0.7, OPTIONS)).not.toBe(
      ridgedHeight(0.3, 0.7, { ...OPTIONS, seed: OPTIONS.seed + 1 }),
    );
  });

  it("has creases: its curvature is heavier-tailed than a sinusoid's", () => {
    // The whole point of the fold. A crest is a slope discontinuity, so it
    // lives in the second difference: a sum of sinusoids has bounded,
    // rounded curvature (kurtosis under 2), while a ridged field packs its
    // curvature into thin spikes along the crests (measured 6.6 here, 1.9
    // for three sinusoids). A Gaussian sits at 3.
    const size = 128;
    const curvatureKurtosis = (f: (x: number, y: number) => number) => {
      const curvature: number[] = [];
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          curvature.push(
            f((x + 1) / size, y / size) -
              2 * f(x / size, y / size) +
              f((x - 1) / size, y / size),
          );
        }
      }
      const n = curvature.length;
      const mean = curvature.reduce((a, b) => a + b, 0) / n;
      const m2 = curvature.reduce((a, c) => a + (c - mean) ** 2, 0) / n;
      const m4 = curvature.reduce((a, c) => a + (c - mean) ** 4, 0) / n;
      return m4 / (m2 * m2);
    };
    const sinusoids = (x: number, y: number) =>
      Math.sin(x * Math.PI * 6 + y * 2) * 0.5 +
      Math.sin(y * Math.PI * 10 - x * 3) * 0.3 +
      Math.cos((x + y) * Math.PI * 14) * 0.2;
    expect(curvatureKurtosis(sinusoids)).toBeLessThan(3);
    expect(
      curvatureKurtosis((x, y) => ridgedHeight(x, y, OPTIONS)),
    ).toBeGreaterThan(3);
  });
});

describe("bakeWaterNormalData", () => {
  it("rejects non-power-of-two sizes", () => {
    expect(() => bakeWaterNormalData({ ...OPTIONS, size: 96 })).toThrow(
      /power of two/,
    );
  });

  it("encodes slopes centered on 0.5 with the steepest facet at the range edge", () => {
    const { data, maxAbsSlope } = bakeWaterNormalData(OPTIONS);
    expect(data).toHaveLength(OPTIONS.size * OPTIONS.size * 4);
    expect(maxAbsSlope).toBeGreaterThan(0);

    let minR = 255;
    let maxR = 0;
    let sumR = 0;
    let sumG = 0;
    for (let i = 0; i < data.length; i += 4) {
      minR = Math.min(minR, data[i]);
      maxR = Math.max(maxR, data[i]);
      sumR += data[i] - 127.5;
      sumG += data[i + 1] - 127.5;
      expect(data[i + 3]).toBe(255);
    }
    const count = data.length / 4;
    // Normalized to the steepest facet: one channel touches an edge.
    expect(Math.min(minR, 255 - maxR)).toBeLessThanOrEqual(1);
    // A periodic field's slope integrates to zero, so every mip level of
    // the map averages toward a flat normal — distant water calms itself.
    expect(Math.abs(sumR / count)).toBeLessThan(1);
    expect(Math.abs(sumG / count)).toBeLessThan(1);
  });

  it("spans the full height range in the blue channel", () => {
    const { data } = bakeWaterNormalData(OPTIONS);
    let minB = 255;
    let maxB = 0;
    for (let i = 2; i < data.length; i += 4) {
      minB = Math.min(minB, data[i]);
      maxB = Math.max(maxB, data[i]);
    }
    expect(minB).toBe(0);
    expect(maxB).toBe(255);
  });

  it("tiles: the slope across the seam matches the interior", () => {
    const { data } = bakeWaterNormalData(OPTIONS);
    const { size } = OPTIONS;
    const texel = (x: number, y: number) => {
      const i = (((y + size) % size) * size + ((x + size) % size)) * 4;
      return [data[i], data[i + 1]];
    };
    // Central differences at the seam use wrapped neighbours, so the last
    // column's slope is continuous with the first column's.
    for (let y = 0; y < size; y += 8) {
      const [rEdge] = texel(size - 1, y);
      const [rWrap] = texel(0, y);
      expect(Math.abs(rEdge - rWrap)).toBeLessThan(96);
    }
  });
});
