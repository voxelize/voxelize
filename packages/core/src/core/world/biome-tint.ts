import { BufferAttribute } from "three";

/** Stack-count code that marks a colour-table face under the sign bit
 * (mirrors `PIGMENT_CODE` in the mesher's vertex_light.rs and in
 * shaders.ts). Such a face keeps its table colour in every climate. */
export const PIGMENT_CODE = 15;
const STACK_COUNT_SHIFT = 26;

/** A compact, optional world color field. No new voxel or inventory types. */
export function biomeTintAttribute(
  positions: Float32Array | Uint16Array,
  lights: Uint32Array | Int32Array,
  corners: Uint8Array | undefined,
  size: number,
  positionUnits = 1,
  positionBias = 0,
): BufferAttribute {
  const colors = new Uint8Array(positions.length);
  if (corners?.length === 12) {
    const inverseSize = 1 / size;
    const inverseUnits = 1 / positionUnits;
    for (let i = 0, vertex = 0; i < positions.length; i += 3, vertex++) {
      // The sign bit marks an opted-in face, including a neutral palette.
      const light = lights[vertex] ?? 0;
      if ((light & 0x80000000) === 0) continue;
      if (((light >>> STACK_COUNT_SHIFT) & 0xf) === PIGMENT_CODE) continue;
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
      for (let c = 0; c < 3; c++) {
        const north = corners[c] + (corners[3 + c] - corners[c]) * x;
        const south = corners[6 + c] + (corners[9 + c] - corners[6 + c]) * x;
        colors[i + c] = Math.round(north + (south - north) * z);
      }
    }
  }
  // An all-zero vertex falls back to the authored stage palette. Every
  // bucket has the same attribute layout, preserving merged/arena draws.
  return new BufferAttribute(colors, 3, true);
}
