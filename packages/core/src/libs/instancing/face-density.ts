/// World dimensions of one part's box, in the same units the mesh config
/// authors (BoxGeometry width/height/depth).
export interface PartBoxDims {
  width: number;
  height: number;
  depth: number;
}

/// How densely part atlases are painted: texture pixels per world block, and
/// the floor below which a face could not hold any pattern (a seam, a glint,
/// a border), so tiny parts render finer than the standard rather than
/// featureless. One density across a roster is what keeps every face of every
/// part reading at the same pixel size.
export interface TexelDensity {
  texelsPerBlock: number;
  minFaceTexels: number;
}

/// Which two of a box's world dimensions a face cell's u/v axes run along,
/// following BoxGeometry's face order (0=+x, 1=-x, 2=+y, 3=-y, 4=+z, 5=-z).
export function faceWorldSize(
  face: number,
  dims: PartBoxDims,
): { u: number; v: number } {
  switch (face) {
    case 0:
    case 1:
      return { u: dims.depth, v: dims.height };
    case 2:
    case 3:
      return { u: dims.width, v: dims.depth };
    default:
      return { u: dims.width, v: dims.height };
  }
}

export function texelsForBlocks(blocks: number, density: TexelDensity): number {
  return Math.max(1, Math.round(blocks * density.texelsPerBlock));
}

export function faceTexelSize(
  face: number,
  dims: PartBoxDims,
  maxTexels: number,
  density: TexelDensity,
): { w: number; h: number } {
  const { u, v } = faceWorldSize(face, dims);
  const clampTexels = (blocks: number) =>
    Math.min(
      maxTexels,
      Math.max(
        density.minFaceTexels,
        Math.round(blocks * density.texelsPerBlock),
      ),
    );
  return { w: clampTexels(u), h: clampTexels(v) };
}

export function partAtlasCellSize(
  partDims: PartBoxDims[],
  density: TexelDensity,
): number {
  // The atlas grid cell must hold the largest face at the shared density,
  // so upscaling below is the only direction a face cell ever maps
  // (nearest-neighbor downscale would drop painted texels).
  let maxTexels = density.minFaceTexels;
  for (const dims of partDims) {
    for (const blocks of [dims.width, dims.height, dims.depth]) {
      maxTexels = Math.max(
        maxTexels,
        Math.round(blocks * density.texelsPerBlock),
      );
    }
  }
  return maxTexels;
}

export type FacePainter = (
  ctx: CanvasRenderingContext2D,
  face: number,
  width: number,
  height: number,
) => void;

export function paintPartFacesAtDensity(
  atlasCtx: CanvasRenderingContext2D,
  cellSize: number,
  partIndex: number,
  dims: PartBoxDims,
  paintFace: FacePainter,
  density: TexelDensity,
): void {
  // Every face of every part maps onto one fixed-size atlas cell, so a
  // face's effective texel density is its cell resolution divided by its
  // world size — fixed-resolution cells give small parts many times the
  // density of large ones. Painting each face at its own world-proportional
  // resolution (face u/v extent x texelsPerBlock) and nearest-upscaling that
  // into the uniform grid pins every face of every part to the same
  // texels-per-block.
  const scratch = document.createElement("canvas");
  for (let face = 0; face < 6; face++) {
    const { w, h } = faceTexelSize(face, dims, cellSize, density);
    // Reset the backing store between faces. Apart from making the painter's
    // canvas match its native resolution, this keeps read/modify/write grain
    // passes from mutating earlier drawImage snapshots in the art renderer.
    scratch.width = w;
    scratch.height = h;
    const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
    if (!scratchCtx) {
      throw new Error("paintPartFacesAtDensity: no 2d context for a face");
    }
    scratchCtx.imageSmoothingEnabled = false;
    paintFace(scratchCtx, face, w, h);
    atlasCtx.drawImage(
      scratch,
      0,
      0,
      w,
      h,
      face * cellSize,
      partIndex * cellSize,
      cellSize,
      cellSize,
    );
  }
}
