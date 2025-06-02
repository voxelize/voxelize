use crate::{Registry, Vec3, VoxelAccess};

/// A set of utility functions for pathfinding and walkability checks in a Voxelize world.
pub struct PathValidator;

impl PathValidator {
    /// Check if a voxel position is walkable (has solid ground and enough space above)
    pub fn is_walkable(
        space: &dyn VoxelAccess,
        position: &Vec3<i32>,
        height: f32,
        registry: &Registry,
    ) -> bool {
        let Vec3(vx, vy, vz) = position;

        // Check if there's solid ground
        let ground_voxel = space.get_voxel(*vx, *vy - 1, *vz);
        let ground_block = registry.get_block_by_id(ground_voxel);
        if ground_block.is_passable || ground_block.is_fluid {
            return false;
        }

        // Check if there's enough space above
        let height_needed = height.ceil() as i32;
        for i in 0..=height_needed {
            let check_voxel = space.get_voxel(*vx, *vy + i, *vz);
            let check_block = registry.get_block_by_id(check_voxel);
            if !check_block.is_passable && !check_block.is_fluid {
                return false;
            }
        }

        true
    }

    /// Find a walkable position near the target position
    pub fn find_walkable_near(
        space: &dyn VoxelAccess,
        target: &Vec3<i32>,
        search_radius: i32,
        height: f32,
        registry: &Registry,
        max_attempts: usize,
    ) -> Option<Vec3<i32>> {
        // First check if the target itself is walkable
        if Self::is_walkable(space, target, height, registry) {
            return Some(target.clone());
        }

        // Try to find a walkable position nearby
        let mut attempts = 0;
        while attempts < max_attempts {
            let dx = fastrand::i32(-search_radius..=search_radius);
            let dy = fastrand::i32(-2..=2); // Limited vertical search
            let dz = fastrand::i32(-search_radius..=search_radius);

            let test_pos = Vec3(target.0 + dx, target.1 + dy, target.2 + dz);

            if Self::is_walkable(space, &test_pos, height, registry) {
                return Some(test_pos);
            }

            attempts += 1;
        }

        None
    }

    /// Simple line-of-sight path check (doesn't guarantee full pathfinding)
    pub fn has_simple_path(
        space: &dyn VoxelAccess,
        from: &Vec3<i32>,
        to: &Vec3<i32>,
        height: f32,
        registry: &Registry,
        max_distance: f32,
    ) -> bool {
        let dx = (to.0 - from.0) as f32;
        let dy = (to.1 - from.1) as f32;
        let dz = (to.2 - from.2) as f32;

        let distance = (dx * dx + dy * dy + dz * dz).sqrt();
        if distance > max_distance {
            return false;
        }

        // Simple line check - sample points along the path
        let steps = distance.ceil() as usize;
        if steps == 0 {
            return true;
        }

        for i in 0..=steps {
            let t = i as f32 / steps as f32;
            let check_pos = Vec3(
                (from.0 as f32 + dx * t).round() as i32,
                (from.1 as f32 + dy * t).round() as i32,
                (from.2 as f32 + dz * t).round() as i32,
            );

            // Allow some flexibility in height for slopes
            let mut found_walkable = false;
            for y_offset in -2..=2 {
                let adjusted_pos = Vec3(check_pos.0, check_pos.1 + y_offset, check_pos.2);
                if Self::is_walkable(space, &adjusted_pos, height, registry) {
                    found_walkable = true;
                    break;
                }
            }

            if !found_walkable {
                return false;
            }
        }

        true
    }

    /// Get the actual walkable Y position at a given X,Z coordinate
    pub fn get_ground_level(
        space: &dyn VoxelAccess,
        x: i32,
        z: i32,
        start_y: i32,
        registry: &Registry,
        max_search_depth: i32,
    ) -> Option<i32> {
        // Search downward from start_y
        for y in (0..=start_y).rev().take(max_search_depth as usize) {
            let ground = space.get_voxel(x, y - 1, z);
            let ground_block = registry.get_block_by_id(ground);
            let current = space.get_voxel(x, y, z);
            let current_block = registry.get_block_by_id(current);

            if !ground_block.is_passable
                && !ground_block.is_fluid
                && (current_block.is_passable || current_block.is_fluid)
            {
                return Some(y);
            }
        }

        None
    }
}
