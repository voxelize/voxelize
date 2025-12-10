import RAPIER from "@dimforge/rapier3d-compat";
import { AABB } from "@voxelize/aabb";

/**
 * Manages static colliders for voxel chunks in Rapier physics world
 * Each solid surface voxel gets a box collider in the Rapier world
 */
export class ChunkColliderManager {
  /**
   * Map from chunk coordinates (cx,cz) to list of collider handles
   */
  private chunkColliders: Map<string, number[]> = new Map();

  /**
   * Generate chunk coordinate key
   */
  private getChunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  /**
   * Update colliders for a chunk region
   * @param chunkCoords Chunk 2D coordinates [cx, cz]
   * @param getVoxel Function to get voxel ID at world position
   * @param getBlock Function to get block properties from voxel ID
   * @param world Rapier world instance
   * @param chunkSize Size of chunk (width/depth in voxels)
   * @param maxHeight Maximum height of world
   */
  updateChunkCollider(
    chunkCoords: [number, number],
    getVoxel: (vx: number, vy: number, vz: number) => number,
    getBlock: (id: number) => {
      isEmpty: boolean;
      isFluid: boolean;
      isPassable: boolean;
      aabbs: AABB[];
    },
    world: RAPIER.World,
    chunkSize: number,
    maxHeight: number
  ): void {
    const [cx, cz] = chunkCoords;
    const key = this.getChunkKey(cx, cz);

    // Remove old colliders if they exist
    const oldHandles = this.chunkColliders.get(key);
    if (oldHandles) {
      for (const handle of oldHandles) {
        const collider = world.getCollider(handle);
        if (collider) {
          world.removeCollider(collider, false);
        }
      }
      this.chunkColliders.delete(key);
    }

    const newHandles: number[] = [];

    // Calculate world bounds for this chunk
    const minX = cx * chunkSize;
    const minZ = cz * chunkSize;
    const maxX = (cx + 1) * chunkSize;
    const maxZ = (cz + 1) * chunkSize;

    // Iterate through all voxels in the chunk
    for (let vx = minX; vx < maxX; vx++) {
      for (let vz = minZ; vz < maxZ; vz++) {
        for (let vy = 0; vy < maxHeight; vy++) {
          const voxelId = getVoxel(vx, vy, vz);
          const block = getBlock(voxelId);

          // Skip non-solid voxels
          if (block.isEmpty || block.isFluid || block.isPassable) {
            continue;
          }

          // Check if this is a surface voxel (has at least one air neighbor)
          if (!this.isSurfaceVoxel(vx, vy, vz, getVoxel, getBlock)) {
            continue;
          }

          // Get AABBs for this block (supports non-cube shapes)
          const aabbs = block.aabbs || [
            new AABB({
              minX: vx,
              minY: vy,
              minZ: vz,
              maxX: vx + 1,
              maxY: vy + 1,
              maxZ: vz + 1,
            }),
          ];

          // Create box colliders for each AABB
          for (const aabb of aabbs) {
            const width = aabb.maxX - aabb.minX;
            const height = aabb.maxY - aabb.minY;
            const depth = aabb.maxZ - aabb.minZ;

            // Skip degenerate AABBs
            if (width <= 0 || height <= 0 || depth <= 0) {
              continue;
            }

            // Center position of the box
            const centerX = (aabb.minX + aabb.maxX) / 2;
            const centerY = (aabb.minY + aabb.maxY) / 2;
            const centerZ = (aabb.minZ + aabb.maxZ) / 2;

            // Rapier uses half-extents for boxes
            const halfExtents = {
              x: width / 2,
              y: height / 2,
              z: depth / 2,
            };

            // Create a static box collider
            const colliderDesc = RAPIER.ColliderDesc.cuboid(
              halfExtents.x,
              halfExtents.y,
              halfExtents.z
            ).setTranslation(centerX, centerY, centerZ);

            const collider = world.createCollider(colliderDesc);
            newHandles.push(collider.handle);
          }
        }
      }
    }

    // Store handles if any colliders were created
    if (newHandles.length > 0) {
      this.chunkColliders.set(key, newHandles);
    }
  }

  /**
   * Remove colliders for a chunk
   */
  removeChunkCollider(
    chunkCoords: [number, number],
    world: RAPIER.World
  ): void {
    const [cx, cz] = chunkCoords;
    const key = this.getChunkKey(cx, cz);

    const handles = this.chunkColliders.get(key);
    if (handles) {
      for (const handle of handles) {
        const collider = world.getCollider(handle);
        if (collider) {
          world.removeCollider(collider, false);
        }
      }
      this.chunkColliders.delete(key);
    }
  }

  /**
   * Check if a voxel is a surface voxel (has at least one air neighbor)
   */
  private isSurfaceVoxel(
    vx: number,
    vy: number,
    vz: number,
    getVoxel: (vx: number, vy: number, vz: number) => number,
    getBlock: (id: number) => { isEmpty: boolean; isFluid: boolean }
  ): boolean {
    // Check all 6 neighbors
    const neighbors = [
      [vx - 1, vy, vz],
      [vx + 1, vy, vz],
      [vx, vy - 1, vz],
      [vx, vy + 1, vz],
      [vx, vy, vz - 1],
      [vx, vy, vz + 1],
    ];

    for (const [nx, ny, nz] of neighbors) {
      const neighborId = getVoxel(nx, ny, nz);
      const neighborBlock = getBlock(neighborId);

      if (neighborBlock.isEmpty || neighborBlock.isFluid) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the number of chunks with colliders
   */
  get chunkCount(): number {
    return this.chunkColliders.size;
  }

  /**
   * Get the total number of colliders
   */
  get colliderCount(): number {
    let count = 0;
    for (const handles of this.chunkColliders.values()) {
      count += handles.length;
    }
    return count;
  }

  /**
   * Clear all chunk colliders
   */
  clear(world: RAPIER.World): void {
    for (const handles of this.chunkColliders.values()) {
      for (const handle of handles) {
        const collider = world.getCollider(handle);
        if (collider) {
          world.removeCollider(collider, false);
        }
      }
    }
    this.chunkColliders.clear();
  }
}
