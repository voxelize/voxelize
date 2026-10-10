/**
 * Bits 16-23 of a voxel word: the rotation and y-rotation nibbles, or the
 * state of a block whose rotation bits are state (`rotationBitsAreState`).
 * Mirrors `ROTATION_BYTE_MASK` in crates/core/src/block.rs.
 */
export const ROTATION_BYTE_MASK = 0x00ff0000;

/**
 * The state byte a voxel word carries for a block whose rotation bits are
 * state, or `undefined` for any other block, whose byte is a rotation and
 * goes through the rotation decode instead.
 */
export function stateBitsOf(
  block: { rotationBitsAreState?: boolean } | null | undefined,
  voxel: number,
): number | undefined {
  return block?.rotationBitsAreState ? (voxel >>> 16) & 0xff : undefined;
}

/** `raw` with bits 16-23 replaced by `bits`, every other bit kept. */
export function withStateBits(raw: number, bits: number): number {
  return ((raw & ~ROTATION_BYTE_MASK) | ((bits & 0xff) << 16)) >>> 0;
}
