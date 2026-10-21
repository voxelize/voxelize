import { describe, expect, it } from "vitest";

import { AtlasTexture } from "./textures";

const MARGIN = 8;
const DIMENSION = 16;
const CELL = DIMENSION + 2 * MARGIN;

/**
 * A 2D context that rasterizes `drawImage` with nearest sampling into a grid
 * of source texel ids ("x,y"), so a test can read which source texel landed
 * on each cell pixel.
 */
function rasterContext() {
  const pixels: (string | null)[][] = Array.from({ length: CELL }, () =>
    Array.from({ length: CELL }, () => null),
  );
  const drawImage = (
    source: { width: number; height: number },
    ...a: number[]
  ) => {
    const [sx, sy, sw, sh, dx, dy, dw, dh] =
      a.length === 4
        ? [0, 0, source.width, source.height, ...a]
        : (a as [
            number,
            number,
            number,
            number,
            number,
            number,
            number,
            number,
          ]);
    for (let j = 0; j < dh; j++) {
      for (let i = 0; i < dw; i++) {
        const tx = sx + Math.floor(((i + 0.5) * sw) / dw);
        const ty = sy + Math.floor(((j + 0.5) * sh) / dh);
        pixels[dy + j][dx + i] = `${tx},${ty}`;
      }
    }
  };
  return { context: { drawImage }, pixels };
}

function paint() {
  const { context, pixels } = rasterContext();
  const atlas = { atlasMargin: MARGIN, dimension: DIMENSION, atlasRatio: 1 };
  const draw = (
    AtlasTexture.prototype as unknown as {
      drawPaddedTile: (...args: unknown[]) => void;
    }
  ).drawPaddedTile;
  draw.call(atlas, context, { width: DIMENSION, height: DIMENSION }, 0, 0);
  return pixels;
}

describe("atlas tile margin", () => {
  it("draws the texture 1:1 in the middle of the cell", () => {
    const pixels = paint();
    expect(pixels[MARGIN][MARGIN]).toBe("0,0");
    expect(pixels[MARGIN + 5][MARGIN + 3]).toBe("3,5");
    expect(pixels[MARGIN + DIMENSION - 1][MARGIN + DIMENSION - 1]).toBe(
      "15,15",
    );
  });

  it("repeats only the edge texels out across the margin", () => {
    // A plant's edge rows are clear and its petals sit a few texels in; a
    // margin holding inner texels drew them as dashes along the quad border.
    const pixels = paint();
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const tx = Math.min(Math.max(x - MARGIN, 0), DIMENSION - 1);
        const ty = Math.min(Math.max(y - MARGIN, 0), DIMENSION - 1);
        expect(pixels[y][x], `cell pixel ${x},${y}`).toBe(`${tx},${ty}`);
      }
    }
  });
});
