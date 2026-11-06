import { BufferAttribute, BufferGeometry } from "three/webgpu";

import { BYTE_VECTOR_STRIDE, POSITION_STRIDE } from "./vertex-layout";

/**
 * A one-triangle geometry with the attributes a chunk mesh carries, in the
 * formats the meshes carry them (`World.makeChunkBufferGeometry`): what a
 * warmup draws a chunk material with. A pipeline is keyed by its vertex
 * layout as much as by its material, so a stand-in with other attributes or
 * other formats would build a pipeline no chunk ever draws with.
 */
export function makeChunkStandInGeometry(options: {
  /**
   * Fixed-point positions (four-wide, the sway profile fourth) and
   * normalized uvs/normals: the shipped meshes.
   */
  isQuantized: boolean;
  /** The climate tint (every chunk with biome data). */
  hasBiomeTint?: boolean;
}): BufferGeometry {
  const { isQuantized, hasBiomeTint = true } = options;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    isQuantized
      ? new BufferAttribute(new Uint16Array(3 * POSITION_STRIDE), POSITION_STRIDE)
      : new BufferAttribute(new Float32Array(9), 3),
  );
  geometry.setAttribute(
    "uv",
    new BufferAttribute(
      isQuantized ? new Uint16Array(6) : new Float32Array(6),
      2,
      isQuantized,
    ),
  );
  geometry.setAttribute("light", new BufferAttribute(new Int32Array(3), 1));
  geometry.setAttribute(
    "lightTwist",
    new BufferAttribute(new Uint8Array(12), 4),
  );
  if (hasBiomeTint) {
    geometry.setAttribute(
      "biomeTint",
      new BufferAttribute(new Uint8Array(12), BYTE_VECTOR_STRIDE, true),
    );
  }
  geometry.setAttribute(
    "normal",
    isQuantized
      ? new BufferAttribute(new Int8Array(12), BYTE_VECTOR_STRIDE, true)
      : new BufferAttribute(new Float32Array(9), 3),
  );
  geometry.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  return geometry;
}
