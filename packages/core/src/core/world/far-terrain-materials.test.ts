import { describe, expect, it } from "vitest";

import {
  buildFarMaterialTable,
  FAR_LAYER_SIZE,
  FAR_MATERIAL_TEXELS,
  FAR_TINTED_LAYER,
  farLayerTexels,
  farMaterialFaces,
  farPaletteTable,
} from "./far-terrain-materials";
import {
  FarFaceLook,
  FarTerrainMaterial,
  FarTerrainTree,
} from "./far-terrain-tiles";

// 1 grass (tinted top and side), 2 dirt, 3 stone, 4 snow, 5 and 6 two
// kinds of leaves (tinted), 7 and 8 the logs they grow on.
const faceLook = (block: number): FarFaceLook => ({
  color: [block / 10, block / 20, block / 40],
  isTinted: block === 1 || block === 5 || block === 6,
});

const meadow: FarTerrainMaterial = {
  top: 1,
  side: 2,
  deep: 3,
  covers: [{ block: 4, share: 0.2 }],
};

const trees: FarTerrainTree[] = [
  { leaves: 5, log: 7 },
  { leaves: 6, log: 8 },
];

const texel = (table: Float32Array, cls: number, slot: number) =>
  Array.from(
    table.subarray(
      (cls * FAR_MATERIAL_TEXELS + slot) * 4,
      (cls * FAR_MATERIAL_TEXELS + slot) * 4 + 4,
    ),
  );

describe("farMaterialFaces", () => {
  it("lists every face the materials and trees paint with, once each", () => {
    expect(farMaterialFaces([meadow, { top: 3, side: 3 }], trees)).toEqual([
      [1, "top"],
      [1, "side"],
      [2, "side"],
      [3, "side"],
      [4, "top"],
      [3, "top"],
      [5, "top"],
      [7, "side"],
      [6, "top"],
      [8, "side"],
    ]);
  });
});

describe("buildFarMaterialTable", () => {
  const table = buildFarMaterialTable(
    [meadow, { top: 3, side: 3 }],
    faceLook,
    trees,
  );
  const layerOf = (block: number, side: "top" | "side") =>
    farMaterialFaces([meadow, { top: 3, side: 3 }], trees).findIndex(
      ([b, s]) => b === block && s === side,
    );

  it("names the top, its flat covers by cumulative share, and the strata", () => {
    const [top, flat1, flat2, flat3] = texel(table.table, 0, 0);
    expect(top).toBe(0 + FAR_TINTED_LAYER);
    expect(flat1).toBe(4);
    expect([flat2, flat3]).toEqual([-1, -1]);
    const [s1, s2, s3, sideDepth] = texel(table.table, 0, 1);
    expect([s1, s2, s3]).toEqual(
      [0.2, 0.2, 0.2].map((v) => expect.closeTo(v, 6)),
    );
    expect(sideDepth).toBe(3);
    // Cap: the grass block's own side; then dirt, then stone.
    expect(texel(table.table, 0, 2)).toEqual([1 + FAR_TINTED_LAYER, 2, 3, 3]);
  });

  it("gives each tree species a class after the materials': leaves, then bark", () => {
    expect(table.treeClass).toBe(2);
    expect(table.classes).toBe(4);
    for (const [slot, tree] of trees.entries()) {
      const cls = table.treeClass + slot;
      const leaves = layerOf(tree.leaves, "top") + FAR_TINTED_LAYER;
      const bark = layerOf(tree.log, "side");
      const [top, flat1, flat2, flat3] = texel(table.table, cls, 0);
      expect(top).toBe(leaves);
      expect([flat1, flat2, flat3]).toEqual([-1, -1, -1]);
      expect(texel(table.table, cls, 1)).toEqual([0, 0, 0, 0]);
      expect(texel(table.table, cls, 2)).toEqual([bark, bark, bark, leaves]);
    }
  });

  it("packs one layer per face", () => {
    expect(table.layerCount).toBe(10);
    expect(table.layers.length).toBe(10 * FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4);
  });
});

describe("farLayerTexels", () => {
  it("flips the image so its top row is the layer's top, and fills gaps darker", () => {
    // A 2x2 face: top row red and see-through, bottom row blue.
    const pixels = [255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255];
    const out = new Uint8Array(FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4);
    farLayerTexels(
      { color: [0.5, 0.5, 0.5], isTinted: false, pixels, size: 2 },
      out,
      0,
    );
    const at = (x: number, y: number) =>
      Array.from(
        out.subarray(
          (y * FAR_LAYER_SIZE + x) * 4,
          (y * FAR_LAYER_SIZE + x) * 4 + 4,
        ),
      );
    // GL row 0 is the image's bottom row: blue.
    expect(at(0, 0)).toEqual([0, 0, 255, 255]);
    // The image's top-left texel is red, now in the layer's top row.
    expect(at(0, FAR_LAYER_SIZE - 1)).toEqual([255, 0, 0, 255]);
    // Its see-through neighbour is the face's colour, darker, and opaque.
    const gap = at(FAR_LAYER_SIZE - 1, FAR_LAYER_SIZE - 1);
    expect(gap[3]).toBe(255);
    expect(gap[0]).toBeLessThan(188);
    expect(gap[0]).toBe(gap[1]);
  });

  it("box-filters a larger face down in linear light", () => {
    const size = FAR_LAYER_SIZE * 2;
    const pixels: number[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const white = (x + y) % 2 === 0;
        pixels.push(white ? 255 : 0, white ? 255 : 0, white ? 255 : 0, 255);
      }
    }
    const out = new Uint8Array(FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4);
    farLayerTexels(
      { color: [0.5, 0.5, 0.5], isTinted: false, pixels, size },
      out,
      0,
    );
    // Half white in linear light is sRGB 188, not 128.
    expect(out[0]).toBe(188);
  });
});

describe("farPaletteTable", () => {
  it("paints each class one solid colour and adds a class for floating land", () => {
    const table = farPaletteTable([1, 0, 0, 0, 1, 0], [0, 0, 1], [1, 1, 1]);
    expect(table.classes).toBe(3);
    const [top] = texel(table.table, 2, 0);
    const [, side] = texel(table.table, 2, 2);
    const layerColor = (layer: number) =>
      Array.from(
        table.layers.subarray(
          layer * FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4,
          layer * FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4 + 3,
        ),
      );
    expect(layerColor(top)).toEqual([0, 0, 255]);
    expect(layerColor(side)).toEqual([255, 255, 255]);
    expect(layerColor(texel(table.table, 1, 0)[0])).toEqual([0, 255, 0]);
  });
});
