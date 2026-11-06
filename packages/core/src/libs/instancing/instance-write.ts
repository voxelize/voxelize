import * as THREE from "three/webgpu";

/// Setting `needsUpdate` on an instanced attribute re-uploads the whole
/// buffer, so a pool of idle entities re-writing identical transforms every
/// frame pays a full GPU upload for data the GPU already holds. These writers
/// compare first and leave the buffer untouched when nothing changed; values
/// round-trip through the same floats they were written with, so exact
/// equality is the correct test. What they do write goes up as the span of
/// instances changed since the last upload (`markInstanceChanged`), not the
/// pool's whole capacity: a fish pool sized for a thousand sent 62 KB a frame
/// to move five.
///
/// A buffer written through these must be written only through these (or
/// `markInstanceChanged`): a bare `needsUpdate` in the same frame would
/// upload just the marked span and leave its own write behind.

export function writeInstanceMatrix(
  mesh: THREE.InstancedMesh,
  index: number,
  matrix: THREE.Matrix4,
): void {
  const array = mesh.instanceMatrix.array;
  const offset = index * 16;
  const elements = matrix.elements;
  let isChanged = false;
  for (let i = 0; i < 16; i++) {
    if (array[offset + i] !== elements[i]) {
      isChanged = true;
      break;
    }
  }
  if (!isChanged) return;
  mesh.setMatrixAt(index, matrix);
  markInstanceChanged(mesh.instanceMatrix, index);
}

/** A per-instance attribute: its own buffer, or a view into a packed one. */
export type InstanceAttribute =
  | THREE.BufferAttribute
  | THREE.InterleavedBufferAttribute;

export function writeInstanceColor(
  attribute: InstanceAttribute,
  index: number,
  r: number,
  g: number,
  b: number,
): void {
  if (
    attribute.getX(index) === r &&
    attribute.getY(index) === g &&
    attribute.getZ(index) === b
  ) {
    return;
  }
  attribute.setXYZ(index, r, g, b);
  markInstanceChanged(attribute, index);
}

/**
 * Marks instance `index` of `attribute` written: the next upload sends one
 * span covering every instance marked since the last upload, in the buffer
 * the attribute lives in (its own, or a packed one it shares).
 */
export function markInstanceChanged(
  attribute: InstanceAttribute,
  index: number,
): void {
  let target: { updateRanges: { start: number; count: number }[] };
  let start: number;
  if ((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const interleaved = attribute as THREE.InterleavedBufferAttribute;
    target = interleaved.data;
    start = index * interleaved.data.stride + interleaved.offset;
  } else {
    target = attribute as THREE.BufferAttribute;
    start = index * attribute.itemSize;
  }
  const end = start + attribute.itemSize;
  const span = target.updateRanges[0];
  if (span === undefined) {
    target.updateRanges.push({ start, count: end - start });
  } else {
    const first = Math.min(span.start, start);
    span.count = Math.max(span.start + span.count, end) - first;
    span.start = first;
  }
  attribute.needsUpdate = true;
}
