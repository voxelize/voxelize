import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { ENTITY_ATLAS_COLS } from "./entity-surface";
import {
  FacePainter,
  PartBoxDims,
  TexelDensity,
  paintPartFacesAtDensity,
  partAtlasCellSize,
} from "./face-density";

export type Vec3Tuple = readonly [number, number, number];

/**
 * One box of a skinned body. Coordinates are mesh units with the entity's
 * origin at its feet, +y up and +z forward (the direction it faces); the
 * pool scales the whole mesh by the instance's size.
 *
 * Its index in the part list is its row in the part atlas.
 */
export interface SkinnedPart {
  /** The bone that moves this box (an index into the family's bones). */
  bone: number;
  /** Width (x), height (y), depth (z). */
  size: Vec3Tuple;
  /** Center of the box. */
  at: Vec3Tuple;
  /**
   * The joint the bone turns this box about (a hip, a neck). Every box on
   * one bone should share it. Defaults to the origin.
   */
  pivot?: Vec3Tuple;
  /**
   * The six faces' art: one CSS colour for every face, or a painter called
   * per face (0=+x, 1=-x, 2=+y, 3=-y, 4=+z front, 5=-z back) on a canvas
   * sized to the face at the atlas's texel density.
   */
  paint?: string | FacePainter;
}

/** Texels per block for part atlases built here, and the smallest face. */
export const DEFAULT_PART_TEXEL_DENSITY: TexelDensity = {
  texelsPerBlock: 16,
  minFaceTexels: 4,
};

/**
 * Bakes a part list into the geometry a {@link SkinnedInstancePool} draws:
 * every vertex carries its bone (`skinIndex`/`skinWeight`), its joint
 * (`pivotOffset`) and its atlas row (`partIndex`).
 *
 * @example
 * ```ts
 * const BONE = { BODY: 0, HEAD: 1 } as const;
 * const parts: SkinnedPart[] = [
 *   { bone: BONE.BODY, size: [0.6, 0.5, 0.9], at: [0, 0.55, 0], paint: "#8a6a4a" },
 *   { bone: BONE.HEAD, size: [0.4, 0.4, 0.4], at: [0, 0.8, 0.55],
 *     pivot: [0, 0.7, 0.4], paint: "#9b7b5a" },
 * ];
 * const geometry = buildSkinnedPartsGeometry(parts);
 * ```
 */
export function buildSkinnedPartsGeometry(
  parts: readonly SkinnedPart[],
): THREE.BufferGeometry {
  if (parts.length === 0) {
    throw new Error(
      "buildSkinnedPartsGeometry: a body needs at least one part",
    );
  }
  const geometries = parts.map((part, partIndex) => {
    const box = new THREE.BoxGeometry(...part.size);
    box.translate(...part.at);
    const count = box.attributes.position.count;
    const [px, py, pz] = part.pivot ?? [0, 0, 0];
    const skinIndex = new Float32Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const pivotOffset = new Float32Array(count * 3);
    const partIndices = new Float32Array(count).fill(partIndex);
    for (let v = 0; v < count; v++) {
      skinIndex[v * 4] = part.bone;
      skinWeight[v * 4] = 1;
      pivotOffset[v * 3] = px;
      pivotOffset[v * 3 + 1] = py;
      pivotOffset[v * 3 + 2] = pz;
    }
    box.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4));
    box.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4));
    box.setAttribute("pivotOffset", new THREE.BufferAttribute(pivotOffset, 3));
    box.setAttribute("partIndex", new THREE.BufferAttribute(partIndices, 1));
    return box;
  });
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) {
    throw new Error("buildSkinnedPartsGeometry: parts could not be merged");
  }
  return merged;
}

/**
 * Paints a part list's atlas: one row per part, six face cells per row,
 * every face at the same texels per block. Pair with
 * `atlasSurface(parts.length)`, the pool's default surface.
 */
export function paintSkinnedPartsAtlas(
  parts: readonly SkinnedPart[],
  density: TexelDensity = DEFAULT_PART_TEXEL_DENSITY,
): THREE.CanvasTexture {
  const dims: PartBoxDims[] = parts.map(({ size }) => ({
    width: size[0],
    height: size[1],
    depth: size[2],
  }));
  const cellSize = partAtlasCellSize(dims, density);
  const canvas = document.createElement("canvas");
  canvas.width = ENTITY_ATLAS_COLS * cellSize;
  canvas.height = parts.length * cellSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("paintSkinnedPartsAtlas: no 2d context");
  ctx.imageSmoothingEnabled = false;

  parts.forEach((part, partIndex) => {
    const paint = part.paint ?? "#ffffff";
    const painter: FacePainter =
      typeof paint === "string"
        ? (faceCtx, _face, width, height) => {
            faceCtx.fillStyle = paint;
            faceCtx.fillRect(0, 0, width, height);
          }
        : paint;
    paintPartFacesAtDensity(
      ctx,
      cellSize,
      partIndex,
      dims[partIndex],
      painter,
      density,
    );
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  return texture;
}
