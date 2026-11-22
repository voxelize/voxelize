import { BufferAttribute } from "three/webgpu";

import { BYTE_VECTOR_STRIDE } from "./vertex-layout";

/** Stack-count code that marks a colour-table face under the sign bit
 * (mirrors `PIGMENT_CODE` in the mesher's vertex_light.rs and in
 * shaders.ts). Such a face keeps its table colour in every climate. */
export const PIGMENT_CODE = 15;
const STACK_COUNT_SHIFT = 26;
/** The fluid bit of a vertex's light word (`FLUID_SHIFT` in the shaders). */
const FLUID_SHIFT = 18;

/** Bytes of a chunk's land colour corners: four corners of RGB. */
export const BIOME_TINT_CORNER_BYTES = 12;
/** Bytes of a chunk's water look corners: four corners of RGBA. */
export const WATER_TINT_CORNER_BYTES = 16;

/** The water corners, or undefined when they are absent or plain water. */
function liveWaterCorners(corners: Uint8Array | undefined) {
  if (corners?.length !== WATER_TINT_CORNER_BYTES) return undefined;
  return corners[3] | corners[7] | corners[11] | corners[15]
    ? corners
    : undefined;
}

/**
 * One byte of a corner field at (x, z) in 0..1 across the chunk: corners
 * are x-fast, `stride` bytes each, and `c` is the channel.
 */
function cornerByte(
  corners: Uint8Array,
  stride: number,
  c: number,
  x: number,
  z: number,
) {
  const north = corners[c] + (corners[stride + c] - corners[c]) * x;
  const south =
    corners[stride * 2 + c] +
    (corners[stride * 3 + c] - corners[stride * 2 + c]) * x;
  return Math.round(north + (south - north) * z);
}

/**
 * A chunk's regional water look at a point of it, x and z in 0..1 across
 * the chunk: the colour the water takes on there (0..1, not premultiplied)
 * and how far it has turned (0 plain water, 1 wholly that colour). Blended
 * between the four corners the way a water vertex is, so the camera and
 * the surface it looks at agree. Null where the chunk has plain water.
 */
export function waterLookInChunk(
  corners: Uint8Array | undefined,
  x: number,
  z: number,
): { r: number; g: number; b: number; amount: number } | null {
  const live = liveWaterCorners(corners);
  if (!live) return null;
  const fx = Math.max(0, Math.min(1, x));
  const fz = Math.max(0, Math.min(1, z));
  const amount = cornerByte(live, 4, 3, fx, fz);
  if (amount === 0) return null;
  return {
    r: cornerByte(live, 4, 0, fx, fz) / amount,
    g: cornerByte(live, 4, 1, fx, fz) / amount,
    b: cornerByte(live, 4, 2, fx, fz) / amount,
    amount: amount / 255,
  };
}

/** A compact, optional world color field. No new voxel or inventory types. */
export function biomeTintAttribute(
  positions: Float32Array | Uint16Array,
  lights: Uint32Array | Int32Array,
  corners: Uint8Array | undefined,
  size: number,
  positionUnits = 1,
  positionBias = 0,
  waterCorners?: Uint8Array,
): BufferAttribute {
  const colors = new Uint8Array((positions.length / 3) * BYTE_VECTOR_STRIDE);
  writeBiomeTint(
    colors,
    0,
    positions,
    lights,
    corners,
    size,
    positionUnits,
    positionBias,
    waterCorners,
  );
  // An all-zero vertex falls back to the authored stage palette. Every
  // bucket has the same attribute layout, preserving merged/arena draws.
  return new BufferAttribute(colors, BYTE_VECTOR_STRIDE, true);
}

/**
 * The regional colour of each vertex of one geometry, written into `target`
 * from `offset` (a merge writes many geometries into one array). An opted-in
 * land vertex takes the biome colour, three bytes. A fluid vertex takes the
 * chunk's water look, four bytes: the colour premultiplied by the amount in
 * the fourth. Every other vertex, and every colour-table face, is written
 * zero: land keeps its stage palette and water stays the world's plain
 * water.
 */
export function writeBiomeTint(
  target: Uint8Array,
  offset: number,
  positions: Float32Array | Uint16Array,
  lights: Uint32Array | Int32Array,
  corners: Uint8Array | undefined,
  size: number,
  positionUnits = 1,
  positionBias = 0,
  waterCorners?: Uint8Array,
) {
  const vertexCount = positions.length / 3;
  target.fill(0, offset, offset + vertexCount * BYTE_VECTOR_STRIDE);
  const land = corners?.length === BIOME_TINT_CORNER_BYTES ? corners : undefined;
  const water = liveWaterCorners(waterCorners);
  if (!land && !water) return;
  const inverseSize = 1 / size;
  const inverseUnits = 1 / positionUnits;
  for (let i = 0, vertex = 0; i < positions.length; i += 3, vertex++) {
    const light = lights[vertex] ?? 0;
    const isFluid = ((light >>> FLUID_SHIFT) & 1) === 1;
    if (isFluid ? !water : !land) continue;
    if (!isFluid) {
      // The sign bit marks an opted-in face, including a neutral palette.
      if ((light & 0x80000000) === 0) continue;
      if (((light >>> STACK_COUNT_SHIFT) & 0xf) === PIGMENT_CODE) continue;
    }
    const x = Math.max(
      0,
      Math.min(1, (positions[i] * inverseUnits - positionBias) * inverseSize),
    );
    const z = Math.max(
      0,
      Math.min(
        1,
        (positions[i + 2] * inverseUnits - positionBias) * inverseSize,
      ),
    );
    const at = offset + vertex * BYTE_VECTOR_STRIDE;
    if (isFluid && water) {
      for (let c = 0; c < 4; c++) target[at + c] = cornerByte(water, 4, c, x, z);
    } else if (land) {
      for (let c = 0; c < 3; c++) target[at + c] = cornerByte(land, 3, c, x, z);
    }
  }
}

export type BiomeTintAtOptions = {
  positions: Float32Array | Uint16Array;
  lights: Uint32Array | Int32Array;
  /** World position, in blocks, of a vertex whose position is zero. */
  origin: [number, number, number];
  positionUnits: number;
  positionBias: number;
  chunkSize: number;
  /** The colour corners of the chunk at these coordinates, if it has any. */
  cornersAt: (cx: number, cz: number) => Uint8Array | undefined;
  /** Its water look corners, if it has any. */
  waterCornersAt?: (cx: number, cz: number) => Uint8Array | undefined;
};

/**
 * The same field for geometry that belongs to no one chunk: each vertex
 * takes the corners of the chunk its world position falls in, so a mesh
 * lifted out of the world keeps the colours of the ground it stood on.
 */
export function biomeTintAttributeAt({
  positions,
  lights,
  origin,
  positionUnits,
  positionBias,
  chunkSize,
  cornersAt,
  waterCornersAt,
}: BiomeTintAtOptions): BufferAttribute {
  const colors = new Uint8Array((positions.length / 3) * BYTE_VECTOR_STRIDE);
  const inverseUnits = 1 / positionUnits;
  for (let i = 0, vertex = 0; i < positions.length; i += 3, vertex++) {
    const light = lights[vertex] ?? 0;
    const isFluid = ((light >>> FLUID_SHIFT) & 1) === 1;
    if (!isFluid) {
      if ((light & 0x80000000) === 0) continue;
      if (((light >>> STACK_COUNT_SHIFT) & 0xf) === PIGMENT_CODE) continue;
    } else if (!waterCornersAt) {
      continue;
    }
    const worldX = origin[0] + positions[i] * inverseUnits - positionBias;
    const worldZ = origin[2] + positions[i + 2] * inverseUnits - positionBias;
    const cx = Math.floor(worldX / chunkSize);
    const cz = Math.floor(worldZ / chunkSize);
    const x = Math.max(0, Math.min(1, worldX / chunkSize - cx));
    const z = Math.max(0, Math.min(1, worldZ / chunkSize - cz));
    const at = vertex * BYTE_VECTOR_STRIDE;
    if (isFluid) {
      const water = liveWaterCorners(waterCornersAt?.(cx, cz));
      if (!water) continue;
      for (let c = 0; c < 4; c++) colors[at + c] = cornerByte(water, 4, c, x, z);
      continue;
    }
    const corners = cornersAt(cx, cz);
    if (corners?.length !== BIOME_TINT_CORNER_BYTES) continue;
    for (let c = 0; c < 3; c++) colors[at + c] = cornerByte(corners, 3, c, x, z);
  }
  return new BufferAttribute(colors, BYTE_VECTOR_STRIDE, true);
}
