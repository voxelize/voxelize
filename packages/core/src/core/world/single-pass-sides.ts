import type { Material, Side } from "three";
import { DoubleSide } from "three";

const NORMAL_EPSILON = 1e-4;

/**
 * Whether every vertex normal in a flat-shaded buffer points the same way.
 *
 * Quads that all face one direction are either all front-facing or all
 * back-facing from any viewpoint, apart from a camera standing between two
 * parallel quads, where each ray still meets at most one of them. So no pixel
 * ever sees both sides of such a mesh at once.
 */
export function normalsShareOneDirection(normals: ArrayLike<number>): boolean {
  if (normals.length < 3) return false;
  const nx = normals[0];
  const ny = normals[1];
  const nz = normals[2];
  for (let i = 3; i < normals.length; i += 3) {
    if (
      Math.abs(normals[i] - nx) > NORMAL_EPSILON ||
      Math.abs(normals[i + 1] - ny) > NORMAL_EPSILON ||
      Math.abs(normals[i + 2] - nz) > NORMAL_EPSILON
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Draw a transparent double-sided mesh in one pass when doing so cannot
 * change a pixel.
 *
 * three draws a transparent `DoubleSide` material twice, back faces first and
 * then front faces, so a closed shape blends its far side under its near
 * side. Each of those passes flips `material.side` and sets `needsUpdate`,
 * so every such draw also rebuilds the material's program parameters and
 * cache-key string, and switches between two programs. When all the mesh's
 * faces point one way (a plant card, one side of a pane), a pixel never sees
 * both sides, the back pass and the front pass never overlap, and one
 * `DoubleSide` pass writes exactly the same fragments.
 */
export function singlePassWhenOneFacing(
  material: Material & { side: Side },
  normals: ArrayLike<number> | undefined,
): void {
  if (!material.transparent || material.side !== DoubleSide || !normals) {
    return;
  }
  if (normalsShareOneDirection(normals)) {
    material.forceSinglePass = true;
  }
}
