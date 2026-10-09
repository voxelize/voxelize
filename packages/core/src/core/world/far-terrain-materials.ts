/**
 * The far layer's materials as GPU data: one texture-array layer per block
 * face the materials name, and per class a row of layer indices and shares
 * the fragment shader reads to paint each face (far-terrain.ts). Pure: the
 * caller uploads the arrays.
 */

import type {
  FarFaceLook,
  FarFaceSide,
  FarTerrainMaterial,
  FarTerrainTree,
} from "./far-terrain-tiles";

/** Texels per side of every layer: one block face of pixel art. */
export const FAR_LAYER_SIZE = 16;

/** Texels of the class table per class row (see FarMaterialTable). */
export const FAR_MATERIAL_TEXELS = 3;

/** Added to a layer index in the class table when its face takes the tint. */
export const FAR_TINTED_LAYER = 1000;

/** Flat covers (dithered per block on a top) one class may carry. */
const FLAT_SLOTS = 3;

/**
 * Per class `FAR_MATERIAL_TEXELS` RGBA texels, row-major by class:
 * 0. top layer, then up to three flat cover layers (-1 for none);
 * 1. the flat covers' cumulative shares, then the side block's depth;
 * 2. the cap (the top block's side), side and deep layers, and the
 *    underside layer.
 * The materials' classes come first, then one per tree species from
 * `treeClass` on: its leaves on top and underneath, its log for walls.
 * A layer index carries `FAR_TINTED_LAYER` when its face takes the tint.
 */
export type FarMaterialTable = {
  classes: number;
  /** The class of the first tree species. */
  treeClass: number;
  /** RGBA float texels, `FAR_MATERIAL_TEXELS` per class. */
  table: Float32Array;
  /** `FAR_LAYER_SIZE`² RGBA8 sRGB texels per layer, bottom row first. */
  layers: Uint8Array;
  layerCount: number;
};

export type FarFaceKey = `${number}:${FarFaceSide}`;

/** Every face a set of materials and tree species paints with, once each. */
export function farMaterialFaces(
  materials: readonly FarTerrainMaterial[],
  trees: readonly FarTerrainTree[] = [],
): [number, FarFaceSide][] {
  const seen = new Set<string>();
  const faces: [number, FarFaceSide][] = [];
  const add = (block: number, side: FarFaceSide) => {
    const key = `${block}:${side}`;
    if (seen.has(key)) return;
    seen.add(key);
    faces.push([block, side]);
  };
  for (const material of materials) {
    add(material.top, "top");
    add(material.top, "side");
    add(material.side, "side");
    if (material.deep !== undefined) add(material.deep, "side");
    for (const cover of material.covers ?? []) add(cover.block, "top");
  }
  for (const tree of trees) {
    add(tree.leaves, "top");
    add(tree.log, "side");
  }
  return faces;
}

const SRGB_TO_LINEAR = (() => {
  const table = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    table[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return table;
})();

const linearToByte = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
};

/**
 * One face's texels as a `FAR_LAYER_SIZE` layer: box-filtered in linear
 * light when larger, nearest when smaller, rows flipped so the image's top
 * is the layer's top, and see-through texels (a leaf's gaps) filled with a
 * darker shade of the face's own colour, as the inside of a canopy looks.
 */
export function farLayerTexels(
  look: FarFaceLook,
  out: Uint8Array,
  offset: number,
) {
  const n = FAR_LAYER_SIZE;
  const pixels = look.pixels;
  const size = look.size ?? 0;
  const fill = look.color.map((c) => linearToByte(c * 0.55));
  if (!pixels || size <= 0) {
    const solid = look.color.map(linearToByte);
    for (let p = 0; p < n * n; p++) {
      out.set([solid[0], solid[1], solid[2], 255], offset + p * 4);
    }
    return;
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor((x * size) / n);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * size) / n));
      const y0 = Math.floor((y * size) / n);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * size) / n));
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * size + sx) * 4;
          if (pixels[at + 3] < 128) continue;
          r += SRGB_TO_LINEAR[pixels[at]];
          g += SRGB_TO_LINEAR[pixels[at + 1]];
          b += SRGB_TO_LINEAR[pixels[at + 2]];
          weight += 1;
        }
      }
      // Image row y is the layer's row n - 1 - y: GL samples bottom up.
      const to = offset + ((n - 1 - y) * n + x) * 4;
      if (weight === 0) {
        out.set([fill[0], fill[1], fill[2], 255], to);
      } else {
        out.set(
          [
            linearToByte(r / weight),
            linearToByte(g / weight),
            linearToByte(b / weight),
            255,
          ],
          to,
        );
      }
    }
  }
}

/**
 * The table and layers for `materials` and the tree species, with `look`
 * resolving each face farMaterialFaces names. A material's covers are flat
 * covers the shader dithers in per block, the first three by share.
 */
export function buildFarMaterialTable(
  materials: readonly FarTerrainMaterial[],
  look: (block: number, side: FarFaceSide) => FarFaceLook,
  trees: readonly FarTerrainTree[] = [],
): FarMaterialTable {
  const faces = farMaterialFaces(materials, trees);
  const layerOf = new Map<string, number>();
  const layers = new Uint8Array(
    Math.max(1, faces.length) * FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4,
  );
  faces.forEach(([block, side], index) => {
    layerOf.set(`${block}:${side}`, index);
    farLayerTexels(
      look(block, side),
      layers,
      index * FAR_LAYER_SIZE * FAR_LAYER_SIZE * 4,
    );
  });
  const code = (block: number, side: FarFaceSide) => {
    const layer = layerOf.get(`${block}:${side}`) ?? 0;
    return look(block, side).isTinted ? layer + FAR_TINTED_LAYER : layer;
  };

  const treeClass = materials.length;
  const classes = Math.max(1, treeClass + trees.length);
  const table = new Float32Array(classes * FAR_MATERIAL_TEXELS * 4).fill(-1);
  const row = (cls: number) => cls * FAR_MATERIAL_TEXELS * 4;
  materials.forEach((material, cls) => {
    const at = row(cls);
    const flat = (material.covers ?? []).slice(0, FLAT_SLOTS);
    table[at] = code(material.top, "top");
    let cumulative = 0;
    flat.forEach((cover, k) => {
      table[at + 1 + k] = code(cover.block, "top");
      cumulative += Math.max(0, cover.share);
      table[at + 4 + k] = Math.min(1, cumulative);
    });
    for (let k = flat.length; k < FLAT_SLOTS; k++) {
      table[at + 4 + k] = Math.min(1, cumulative);
    }
    table[at + 7] = material.sideDepth ?? 3;
    const deep = material.deep ?? material.side;
    table[at + 8] = code(material.top, "side");
    table[at + 9] = code(material.side, "side");
    table[at + 10] = code(deep, "side");
    table[at + 11] = code(deep, "side");
  });
  trees.forEach((tree, slot) => {
    const at = row(treeClass + slot);
    const leaves = code(tree.leaves, "top");
    const log = code(tree.log, "side");
    table[at] = leaves;
    table.fill(0, at + 4, at + 7);
    table[at + 7] = 0;
    table.fill(log, at + 8, at + 11);
    table[at + 11] = leaves;
  });
  return {
    classes,
    treeClass,
    table,
    layers,
    layerCount: Math.max(1, faces.length),
  };
}

/**
 * A palette as materials: one solid layer per class and no covers, then a
 * last class for floating land with `skyTop` on top and `skySide` around.
 */
export function farPaletteTable(
  palette: ArrayLike<number>,
  skyTop: readonly [number, number, number] = [0.5, 0.5, 0.5],
  skySide: readonly [number, number, number] = [0.5, 0.5, 0.5],
): FarMaterialTable {
  const classes = Math.max(1, Math.floor(palette.length / 3));
  const materials: FarTerrainMaterial[] = [];
  for (let c = 0; c < classes; c++) materials.push({ top: c, side: c });
  materials.push({ top: classes, side: classes + 1 });
  return buildFarMaterialTable(materials, (block) => {
    if (block === classes) return { color: skyTop, isTinted: false };
    if (block === classes + 1) return { color: skySide, isTinted: false };
    return {
      color:
        palette.length >= 3
          ? [palette[block * 3], palette[block * 3 + 1], palette[block * 3 + 2]]
          : [0.5, 0.5, 0.5],
      isTinted: false,
    };
  });
}
