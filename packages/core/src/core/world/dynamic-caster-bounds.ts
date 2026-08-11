import { Box3, Group, InstancedMesh, Object3D } from "three";

/**
 * World-space bounds of every live instance in an instanced-pool group,
 * folded from the translation column of each instance matrix. Freed slots
 * park a zero-scale matrix, so a basis column of exact zeros identifies them.
 *
 * Instance matrices are assumed to be world transforms (the pool group and
 * its meshes sitting at identity), which is how instanced creature pools are
 * built: per-instance placement lives entirely in the instance matrix.
 *
 * The result is what lets a shadow pass skip a pool wholesale: a pool with
 * no instance anywhere near a light contributes nothing but still costs a
 * full `renderer.render` per shadow face when drawn unconditionally — with
 * dozens of pools and up to eighteen faces a frame, that overhead was most
 * of the local-shadow bill.
 */
export function computePoolCasterBounds(pool: Group, out: Box3): Box3 {
  out.makeEmpty();
  foldObject(pool, out);
  return out;
}

const stack: Object3D[] = [];

function foldObject(root: Object3D, out: Box3): void {
  stack.length = 0;
  stack.push(root);
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || !node.visible) continue;
    const mesh = node as InstancedMesh;
    if (mesh.isInstancedMesh && mesh.count > 0) {
      const array = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        const offset = i * 16;
        // Zero-scale slot: all three basis columns collapse; testing the
        // diagonal is enough because a real creature transform never has a
        // fully zero basis diagonal.
        if (
          array[offset] === 0 &&
          array[offset + 5] === 0 &&
          array[offset + 10] === 0
        ) {
          continue;
        }
        expandByPoint(
          out,
          array[offset + 12],
          array[offset + 13],
          array[offset + 14],
        );
      }
    }
    for (const child of node.children) stack.push(child);
  }
}

function expandByPoint(box: Box3, x: number, y: number, z: number): void {
  if (x < box.min.x) box.min.x = x;
  if (y < box.min.y) box.min.y = y;
  if (z < box.min.z) box.min.z = z;
  if (x > box.max.x) box.max.x = x;
  if (y > box.max.y) box.max.y = y;
  if (z > box.max.z) box.max.z = z;
}

/**
 * Sphere-vs-box test with an inflation margin for the caster's body reach:
 * bounds fold instance origins, and a creature's silhouette extends past its
 * origin by up to its body radius.
 */
export function boundsIntersectSphere(
  bounds: Box3,
  x: number,
  y: number,
  z: number,
  radius: number,
  margin: number,
): boolean {
  if (bounds.isEmpty()) return false;
  const reach = radius + margin;
  const dx = Math.max(bounds.min.x - x, 0, x - bounds.max.x);
  const dy = Math.max(bounds.min.y - y, 0, y - bounds.max.y);
  const dz = Math.max(bounds.min.z - z, 0, z - bounds.max.z);
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}
