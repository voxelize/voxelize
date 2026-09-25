import { NearestFilter, SRGBColorSpace } from "three";
import { describe, expect, it } from "vitest";

import {
  bakePixelSprite,
  parsePixelGrid,
  type PixelCanvas,
  pixelBurstGrid,
  pixelBurstTexture,
} from "./pixel-sprite";

type Fill = { style: unknown; x: number; y: number; w: number; h: number };

/** A canvas that records what the baker paints, texel by texel. */
function recordingCanvas() {
  const fills: Fill[] = [];
  const context = {
    fillStyle: "" as unknown,
    clearRect() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ style: context.fillStyle, x, y, w, h });
    },
  };
  const make = (width: number, height: number): PixelCanvas => ({
    width,
    height,
    getContext: () => context,
  });
  /** The colour painted at each texel, row-major, null where untouched. */
  const texels = (width: number, height: number) => {
    const out: (unknown | null)[] = new Array(width * height).fill(null);
    for (const fill of fills) {
      for (let y = fill.y; y < fill.y + fill.h; y += 1) {
        for (let x = fill.x; x < fill.x + fill.w; x += 1) {
          out[y * width + x] = fill.style;
        }
      }
    }
    return out;
  };
  return { make, fills, texels };
}

describe("parsePixelGrid", () => {
  it("resolves every texel and leaves . and space clear", () => {
    const sprite = parsePixelGrid(["a.", " b"], { a: "#111", b: "#222" });
    expect(sprite).toEqual({
      width: 2,
      height: 2,
      cells: ["#111", null, null, "#222"],
    });
  });

  it("refuses a ragged row, naming it", () => {
    expect(() => parsePixelGrid(["aa", "a"], { a: "#111" })).toThrow(/row 1/);
  });

  it("refuses a character the palette does not name, with its place", () => {
    expect(() => parsePixelGrid(["ab"], { a: "#111" })).toThrow(
      /row 0, column 1/,
    );
  });

  it("refuses a palette key that could be read as clear", () => {
    expect(() => parsePixelGrid(["a"], { a: "#111", ".": "#222" })).toThrow(
      /one character/,
    );
  });
});

describe("bakePixelSprite", () => {
  it("bakes nearest-sampled with no mipmaps, in sRGB", () => {
    const canvas = recordingCanvas();
    const texture = bakePixelSprite(
      ["ab", "ba"],
      { a: "#111", b: "#222" },
      {
        createCanvas: canvas.make,
      },
    );
    expect(texture.magFilter).toBe(NearestFilter);
    expect(texture.minFilter).toBe(NearestFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    expect((texture.image as PixelCanvas).width).toBe(2);
  });

  it("paints exactly the opaque texels, one fill per colour run", () => {
    const canvas = recordingCanvas();
    const grid = ["aab.", ".bbb", "a..a"];
    bakePixelSprite(
      grid,
      { a: "#111", b: "#222" },
      {
        createCanvas: canvas.make,
      },
    );
    expect(canvas.texels(4, 3)).toEqual([
      "#111",
      "#111",
      "#222",
      null,
      null,
      "#222",
      "#222",
      "#222",
      "#111",
      null,
      null,
      "#111",
    ]);
    // aa|b, bbb, a|a: five runs, never one fill per texel.
    expect(canvas.fills).toHaveLength(5);
    for (const fill of canvas.fills) expect(fill.h).toBe(1);
  });
});

describe("pixelBurstGrid", () => {
  const opaque = (grid: string[]) =>
    grid.reduce((n, row) => n + row.replace(/\./g, "").length, 0);

  it("is symmetric and clear in its corners", () => {
    for (const shape of ["disc", "star", "ring"] as const) {
      const { grid } = pixelBurstGrid({
        texels: 16,
        bands: ["#fff", "#f80", "#800"],
        shape,
      });
      expect(grid).toHaveLength(16);
      expect(grid[0][0]).toBe(".");
      expect(grid[15][15]).toBe(".");
      for (let y = 0; y < 16; y += 1) {
        expect(grid[y]).toBe([...grid[y]].reverse().join(""));
        expect(grid[y]).toBe(grid[15 - y]);
      }
    }
  });

  it("steps colour outward in flat bands, centre first", () => {
    const { grid, palette } = pixelBurstGrid({
      texels: 16,
      bands: ["#fff", "#f80", "#800"],
      shape: "disc",
    });
    expect(palette).toEqual({ "0": "#fff", "1": "#f80", "2": "#800" });
    expect(grid[7][7]).toBe("0");
    expect(grid[7][0]).toBe("2");
    // Only band keys and clear texels; no in-between tones.
    for (const row of grid) expect(row).toMatch(/^[.012]+$/);
  });

  it("hollows a ring, and a thicker ring covers more", () => {
    const thin = pixelBurstGrid({
      texels: 32,
      bands: ["#ffd23f"],
      shape: "ring",
      ringTexels: 2,
    }).grid;
    const thick = pixelBurstGrid({
      texels: 32,
      bands: ["#ffd23f"],
      shape: "ring",
      ringTexels: 5,
    }).grid;
    expect(thin[16][16]).toBe(".");
    expect(thin[16][0]).toBe("0");
    expect(opaque(thick)).toBeGreaterThan(opaque(thin));
  });

  it("pinches a star to four points", () => {
    const { grid } = pixelBurstGrid({
      texels: 16,
      bands: ["#fff"],
      shape: "star",
    });
    expect(grid[7][0]).toBe("0");
    expect(grid[0][7]).toBe("0");
    expect(grid[2][2]).toBe(".");
  });

  it("refuses sizes and band counts it cannot draw", () => {
    expect(() => pixelBurstGrid({ texels: 1, bands: ["#fff"] })).toThrow();
    expect(() => pixelBurstGrid({ texels: 8, bands: [] })).toThrow();
  });

  it("bakes through the same nearest-sampled path", () => {
    const canvas = recordingCanvas();
    const texture = pixelBurstTexture(
      { texels: 8, bands: ["#fff", "#888"], shape: "puff" },
      { createCanvas: canvas.make },
    );
    expect(texture.magFilter).toBe(NearestFilter);
    expect(canvas.fills.length).toBeGreaterThan(0);
  });
});
