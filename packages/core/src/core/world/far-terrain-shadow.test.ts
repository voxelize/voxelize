import { describe, expect, it } from "vitest";

import {
  FAR_SHADOW_NONE,
  farShadowLines,
  toHalfFloat,
} from "./far-terrain-shadow";

const SIZE = 16;

/** A flat plain at 100 with one ridge column at x = 8 standing at 140. */
const ridge = () => {
  const heights = new Float32Array(SIZE * SIZE).fill(100);
  for (let z = 0; z < SIZE; z++) heights[z * SIZE + 8] = 140;
  return heights;
};

/** The sun at `degrees` of elevation toward +x. */
const sunToward = (degrees: number): [number, number, number] => {
  const a = (degrees * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a), 0];
};

describe("farShadowLines", () => {
  it("shades the side of a ridge away from the sun, as far as its shadow falls", () => {
    // Sun at 45 degrees toward +x, 8 blocks a texel: the ray climbs 8 a texel.
    const lines = farShadowLines({
      heights: ridge(),
      size: SIZE,
      texelBlocks: 8,
      sun: sunToward(45),
      maxDistance: 256,
    });
    const at = (x: number) => lines[4 * SIZE + x];
    // One texel short of the ridge the line is 140 - 8 = 132: the plain at
    // 100 there is shaded, and so is the rest of a 40 block shadow.
    expect(at(7)).toBeCloseTo(132);
    expect(at(4)).toBeCloseTo(108);
    expect(at(4)).toBeGreaterThan(100);
    // The shadow ends five texels (40 blocks) short, and the plain beyond
    // it is lit.
    expect(at(3)).toBeCloseTo(100);
    expect(at(2)).toBeLessThan(100);
    // Past the ridge, on the sunny side, nothing stands toward the sun.
    expect(at(12)).toBeLessThan(100);
  });

  it("casts longer shadows from a lower sun", () => {
    const low = farShadowLines({
      heights: ridge(),
      size: SIZE,
      texelBlocks: 8,
      sun: sunToward(15),
      maxDistance: 256,
    });
    // tan 15 degrees climbs about 2.1 a texel: still shaded 7 texels short.
    expect(low[4 * SIZE + 1]).toBeGreaterThan(100);
  });

  it("leaves everything lit with the sun down or overhead", () => {
    for (const sun of [
      [1, -0.2, 0],
      [0, 1, 0],
    ] as [number, number, number][]) {
      const lines = farShadowLines({
        heights: ridge(),
        size: SIZE,
        texelBlocks: 8,
        sun,
        maxDistance: 256,
      });
      expect(lines.every((line) => line === FAR_SHADOW_NONE)).toBe(true);
    }
  });

  it("stops at maxDistance", () => {
    const lines = farShadowLines({
      heights: ridge(),
      size: SIZE,
      texelBlocks: 8,
      sun: sunToward(5),
      maxDistance: 16,
    });
    // Two texels of reach: the ridge 4 texels on casts nothing here.
    expect(lines[4 * SIZE + 4]).toBeLessThan(100);
    expect(lines[4 * SIZE + 7]).toBeGreaterThan(100);
  });
});

describe("toHalfFloat", () => {
  it("encodes the heights a shadow line takes", () => {
    expect(toHalfFloat(0)).toBe(0);
    expect(toHalfFloat(1)).toBe(0x3c00);
    expect(toHalfFloat(-2)).toBe(0xc000);
    expect(toHalfFloat(132)).toBe(0x5820);
    expect(toHalfFloat(FAR_SHADOW_NONE)).toBe(0xec00);
  });
});
