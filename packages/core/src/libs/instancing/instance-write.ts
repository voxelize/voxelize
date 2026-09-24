import * as THREE from "three";

/// Setting `needsUpdate` on an instanced attribute re-uploads the whole
/// buffer, so a pool of idle entities re-writing identical transforms every
/// frame pays a full GPU upload for data the GPU already holds. These writers
/// compare first and leave the buffer untouched when nothing changed; values
/// round-trip through the same floats they were written with, so exact
/// equality is the correct test.

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
  mesh.instanceMatrix.needsUpdate = true;
}

export function writeInstanceColor(
  attribute: THREE.BufferAttribute,
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
  attribute.needsUpdate = true;
}
