/**
 * WebGPU vertex strides are whole 4-byte words, so an attribute of three
 * one-byte components (a quantized normal, a biome tint) needs a fourth.
 * three pads such an attribute itself, but it re-pads it on every upload
 * with a per-vertex loop that makes a view per vertex: a merged section
 * updated in play allocated ~150 MB/s and stalled frames on the collector.
 * Chunk geometry carries these attributes four-wide from the start (the
 * shaders read three; the fourth is dropped).
 */
export const BYTE_VECTOR_STRIDE = 4;

/** `source`'s three-component vectors, four-wide (the fourth zero). */
export function padByteVectors<T extends Int8Array | Uint8Array>(source: T): T {
  const count = source.length / 3;
  const padded = new (source.constructor as new (length: number) => T)(
    count * BYTE_VECTOR_STRIDE,
  );
  for (let v = 0; v < count; v++) {
    padded[v * 4] = source[v * 3];
    padded[v * 4 + 1] = source[v * 3 + 1];
    padded[v * 4 + 2] = source[v * 3 + 2];
  }
  return padded;
}

/**
 * Quantized positions are 16-bit (vertex-quantization.ts), and WebGPU has no
 * three-wide 16-bit vertex format: three widened every such attribute to 32
 * bits on its first upload, a fresh array per mesh that also replaced the
 * geometry's own, so a chunk's positions took twice the memory and the
 * region arenas adopted the widened type for every page. They are carried
 * four-wide (uint16x4) instead, the fourth lane holding the vertex's sway
 * profile (`World.swayProfileTable`, 0 for none): a shared cutout needs no
 * attribute of its own for it, and every quantized chunk geometry shares one
 * vertex layout.
 */
export const POSITION_STRIDE = 4;

/** `source`'s three-wide positions, four-wide with `swayProfile` fourth. */
export function packQuantizedPositions<T extends Uint16Array>(
  source: ArrayLike<number>,
  swayProfile = 0,
  out: T = new Uint16Array((source.length / 3) * POSITION_STRIDE) as T,
): T {
  const count = source.length / 3;
  for (let v = 0, s = 0, o = 0; v < count; v++, s += 3, o += POSITION_STRIDE) {
    out[o] = source[s];
    out[o + 1] = source[s + 1];
    out[o + 2] = source[s + 2];
    out[o + 3] = swayProfile;
  }
  return out;
}
