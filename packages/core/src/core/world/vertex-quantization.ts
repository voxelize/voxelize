/**
 * Compact vertex format for chunk geometry, adapted from Sodium's compact
 * vertex layout. Positions store as unsigned 16-bit fixed point in
 * 1/`positionUnitsPerBlock` block units, biased by `POSITION_BLOCK_BIAS`
 * blocks so face geometry that pokes slightly outside its section (rotated
 * plant crosses, dynamic-pattern parts) stays representable. The scale is
 * derived per world from its section extent — Sodium can hardcode one scale
 * because its sections are always 16 blocks tall, but a world here may run a
 * single 352-block sub-chunk, and a fixed scale wide enough for the small
 * case silently wraps every vertex above the u16 ceiling in the tall one.
 * UVs store as normalized u16 (the atlas keeps every vertex UV inside
 * [0, 1]; greedy tiling reconstructs its repeat from world position in the
 * fragment shader). Normals store as normalized i8. Together with the i32
 * packed light this is 17 bytes of attributes per vertex, down from 36.
 *
 * The dequantization scale and bias live in the mesh (or arena instance)
 * matrix, never in the shader: the CSM depth pass renders the whole scene
 * through one `scene.overrideMaterial` and can only be correct if the
 * transform carries the mapping back to block space. Chunk materials still
 * receive `POSITION_UNITS_PER_BLOCK` as a define because sway and wave
 * displacement math reads the raw `position` attribute before any matrix
 * applies.
 *
 * Geometry that the transparent sorter rewrites on the main thread (fluids
 * and depth-non-writing see-through blocks such as glass) keeps full f32
 * attributes: the sorter's per-face keys read positions directly, and those
 * buckets are a small fraction of the scene. `isMainThreadSortedBlock`
 * mirrors the `depthWrite` rule in `chunk-materials.ts` exactly — every
 * material therefore serves either only quantized or only float meshes.
 */

export const POSITION_BLOCK_BIAS = 32;

export type SectionExtentOptions = {
  chunkSize: number;
  maxHeight: number;
  subChunks: number;
};

export function positionUnitsPerBlock(options: SectionExtentOptions): number {
  const sectionHeight = Math.floor(options.maxHeight / options.subChunks);
  const spanInBlocks =
    Math.max(options.chunkSize, sectionHeight) + 2 * POSITION_BLOCK_BIAS;
  let units = 1;
  while (units * 2 * spanInBlocks <= 65535) {
    units *= 2;
  }
  return units;
}

export type TransparencyFlags = {
  isFluid: boolean;
  isSeeThrough: boolean;
  transparentStandalone: boolean;
  lightAttenuation: number;
};

export function isMainThreadSortedBlock(block: TransparencyFlags): boolean {
  if (!block.isSeeThrough) return false;
  if (block.isFluid) return true;
  return !block.transparentStandalone && block.lightAttenuation <= 0;
}

export function quantizePositions(
  positions: Float32Array | number[],
  unitsPerBlock: number,
): Uint16Array {
  const out = new Uint16Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    out[i] = Math.round((positions[i] + POSITION_BLOCK_BIAS) * unitsPerBlock);
  }
  return out;
}

export function quantizeUvs(uvs: Float32Array | number[]): Uint16Array {
  const out = new Uint16Array(uvs.length);
  for (let i = 0; i < uvs.length; i++) {
    out[i] = Math.round(Math.min(Math.max(uvs[i], 0), 1) * 65535);
  }
  return out;
}

export function quantizeNormals(normals: Float32Array): Int8Array {
  const out = new Int8Array(normals.length);
  for (let i = 0; i < normals.length; i++) {
    out[i] = Math.round(normals[i] * 127);
  }
  return out;
}
