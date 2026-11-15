import { AABB } from "@voxelize/aabb";

/**
 * Solid boxes that aren't voxels: a wall, a platform, a prop. Bodies collide
 * with them exactly as they collide with blocks. Made by
 * `Engine.addCollider`, moved by `Engine.updateCollider` and dropped by
 * `Engine.removeCollider`.
 */
class Collider {
  /**
   * The boxes, in world space. The engine indexes them where they are, so
   * they change only through `Engine.updateCollider`.
   */
  public aabbs: readonly AABB[] = [];

  /**
   * The column cells the engine indexes this collider under, as `cx, cz`
   * pairs.
   *
   * @hidden
   */
  public cells: number[] = [];
}

export { Collider };
