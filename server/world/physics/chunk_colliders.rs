use hashbrown::HashMap;
use rapier3d::prelude::{
    ColliderBuilder, ColliderHandle, ColliderSet, IslandManager,
    RigidBodySet as RapierBodySet,
};
use nalgebra::Vector3;

use crate::{Vec2, Vec3, VoxelAccess};
use super::Registry;

/// Manages static colliders for voxel chunks
/// Each solid surface voxel gets a box collider in Rapier's physics world
pub struct ChunkColliderManager {
    /// Map from chunk 2D coordinates (cx, cz) to list of collider handles
    chunk_colliders: HashMap<Vec2<i32>, Vec<ColliderHandle>>,
}

impl ChunkColliderManager {
    pub fn new() -> Self {
        Self {
            chunk_colliders: HashMap::new(),
        }
    }

    /// Generate or update colliders for a chunk region
    /// This creates box colliders for all solid, surface voxels in the specified region
    pub fn update_chunk_collider(
        &mut self,
        chunk_coords: &Vec2<i32>,
        space: &dyn VoxelAccess,
        registry: &Registry,
        collider_set: &mut ColliderSet,
        island_manager: &mut IslandManager,
        body_set: &mut RapierBodySet,
        chunk_size: usize,
        max_height: usize,
    ) {
        // Remove old colliders if they exist
        if let Some(handles) = self.chunk_colliders.remove(chunk_coords) {
            for handle in handles {
                collider_set.remove(handle, island_manager, body_set, false);
            }
        }

        let Vec2(cx, cz) = *chunk_coords;
        let mut new_handles = Vec::new();

        // Calculate world bounds for this chunk
        let min_x = cx * chunk_size as i32;
        let min_z = cz * chunk_size as i32;
        let max_x = (cx + 1) * chunk_size as i32;
        let max_z = (cz + 1) * chunk_size as i32;

        // Iterate through all voxels in the chunk
        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..max_height as i32 {
                    let voxel_id = space.get_voxel(vx, vy, vz);
                    let block = registry.get_block_by_id(voxel_id);

                    // Skip non-solid voxels
                    if block.is_empty || block.is_fluid || block.is_passable {
                        continue;
                    }

                    // Check if this is a surface voxel (has at least one air neighbor)
                    if !Self::is_surface_voxel(space, registry, vx, vy, vz) {
                        continue;
                    }

                    // Get AABBs for this block (supports non-cube shapes)
                    let voxel_pos = Vec3(vx, vy, vz);
                    let aabbs = block.get_aabbs(&voxel_pos, space, registry);

                    // Create box colliders for each AABB
                    for aabb in aabbs {
                        let width = aabb.max_x - aabb.min_x;
                        let height = aabb.max_y - aabb.min_y;
                        let depth = aabb.max_z - aabb.min_z;

                        // Skip degenerate AABBs
                        if width <= 0.0 || height <= 0.0 || depth <= 0.0 {
                            continue;
                        }

                        // Center position of the box
                        let center_x = (aabb.min_x + aabb.max_x) / 2.0;
                        let center_y = (aabb.min_y + aabb.max_y) / 2.0;
                        let center_z = (aabb.min_z + aabb.max_z) / 2.0;

                        // Rapier uses half-extents for boxes
                        let half_extents = Vector3::new(width / 2.0, height / 2.0, depth / 2.0);

                        // Create a static box collider
                        let collider = ColliderBuilder::cuboid(
                            half_extents.x,
                            half_extents.y,
                            half_extents.z,
                        )
                        .translation(Vector3::new(center_x, center_y, center_z))
                        .build();

                        let handle = collider_set.insert(collider);
                        new_handles.push(handle);
                    }
                }
            }
        }

        // Store handles if any colliders were created
        if !new_handles.is_empty() {
            self.chunk_colliders.insert(chunk_coords.clone(), new_handles);
        }
    }

    /// Remove colliders for a chunk
    pub fn remove_chunk_collider(
        &mut self,
        chunk_coords: &Vec2<i32>,
        collider_set: &mut ColliderSet,
        island_manager: &mut IslandManager,
        body_set: &mut RapierBodySet,
    ) {
        if let Some(handles) = self.chunk_colliders.remove(chunk_coords) {
            for handle in handles {
                collider_set.remove(handle, island_manager, body_set, false);
            }
        }
    }

    /// Check if a voxel is a surface voxel (has at least one air neighbor)
    fn is_surface_voxel(
        space: &dyn VoxelAccess,
        registry: &Registry,
        vx: i32,
        vy: i32,
        vz: i32,
    ) -> bool {
        // Check all 6 neighbors
        let neighbors = [
            (vx - 1, vy, vz),
            (vx + 1, vy, vz),
            (vx, vy - 1, vz),
            (vx, vy + 1, vz),
            (vx, vy, vz - 1),
            (vx, vy, vz + 1),
        ];

        for &(nx, ny, nz) in &neighbors {
            let neighbor_id = space.get_voxel(nx, ny, nz);
            let neighbor_block = registry.get_block_by_id(neighbor_id);

            if neighbor_block.is_empty || neighbor_block.is_fluid {
                return true;
            }
        }

        false
    }

    /// Get the number of chunks with colliders
    pub fn chunk_count(&self) -> usize {
        self.chunk_colliders.len()
    }

    /// Get the total number of colliders
    pub fn collider_count(&self) -> usize {
        self.chunk_colliders.values().map(|v| v.len()).sum()
    }

    /// Clear all chunk colliders
    pub fn clear(
        &mut self,
        collider_set: &mut ColliderSet,
        island_manager: &mut IslandManager,
        body_set: &mut RapierBodySet,
    ) {
        for (_, handles) in self.chunk_colliders.drain() {
            for handle in handles {
                collider_set.remove(handle, island_manager, body_set, false);
            }
        }
    }
}

impl Default for ChunkColliderManager {
    fn default() -> Self {
        Self::new()
    }
}
