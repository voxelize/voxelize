use crate::{Registry, Vec3, VoxelAccess};

/// A set of utility functions for pathfinding and walkability checks in a Voxelize world.
pub struct PathValidator;

#[inline]
fn checked_offset(base: i32, offset: i32) -> Option<i32> {
    base.checked_add(offset)
}

#[inline]
fn max_search_depth_limit(max_search_depth: i32) -> usize {
    if max_search_depth <= 0 {
        0
    } else {
        max_search_depth as usize
    }
}

#[inline]
fn required_height_steps(height: f32) -> Option<i32> {
    if !height.is_finite() || height < 0.0 {
        return None;
    }
    let ceil_height = height.ceil();
    if ceil_height > i32::MAX as f32 {
        return None;
    }
    Some(ceil_height as i32)
}

impl PathValidator {
    /// Check if a voxel position is walkable (has solid ground and enough space above)
    pub fn is_walkable(
        space: &dyn VoxelAccess,
        position: &Vec3<i32>,
        height: f32,
        registry: &Registry,
    ) -> bool {
        let Vec3(vx, vy, vz) = position;
        let Some(height_needed) = required_height_steps(height) else {
            return false;
        };

        // Check if there's solid ground
        let Some(ground_y) = checked_offset(*vy, -1) else {
            return false;
        };
        let ground_voxel = space.get_voxel(*vx, ground_y, *vz);
        let ground_block = registry.get_block_by_id(ground_voxel);
        if ground_block.is_passable || ground_block.is_fluid {
            return false;
        }

        // Check if there's enough space above
        for i in 0..=height_needed {
            let Some(check_y) = checked_offset(*vy, i) else {
                return false;
            };
            let check_voxel = space.get_voxel(*vx, check_y, *vz);
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

            let Some(test_x) = checked_offset(target.0, dx) else {
                attempts += 1;
                continue;
            };
            let Some(test_y) = checked_offset(target.1, dy) else {
                attempts += 1;
                continue;
            };
            let Some(test_z) = checked_offset(target.2, dz) else {
                attempts += 1;
                continue;
            };
            let test_pos = Vec3(test_x, test_y, test_z);

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
        if !max_distance.is_finite() || max_distance < 0.0 {
            return false;
        }

        let dx = (i64::from(to.0) - i64::from(from.0)) as f64;
        let dy = (i64::from(to.1) - i64::from(from.1)) as f64;
        let dz = (i64::from(to.2) - i64::from(from.2)) as f64;

        let distance = dx.mul_add(dx, dy.mul_add(dy, dz * dz)).sqrt() as f32;
        if !distance.is_finite() {
            return false;
        }
        if distance > max_distance {
            return false;
        }

        // Simple line check - sample points along the path
        let steps = distance.ceil() as usize;
        if steps == 0 {
            return true;
        }

        for i in 0..=steps {
            let t = i as f64 / steps as f64;
            let check_pos = Vec3(
                (f64::from(from.0) + dx * t).round() as i32,
                (f64::from(from.1) + dy * t).round() as i32,
                (f64::from(from.2) + dz * t).round() as i32,
            );

            // Allow some flexibility in height for slopes
            let mut found_walkable = false;
            for y_offset in -2..=2 {
                let Some(adjusted_y) = checked_offset(check_pos.1, y_offset) else {
                    continue;
                };
                let adjusted_pos = Vec3(check_pos.0, adjusted_y, check_pos.2);
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
        let search_depth = max_search_depth_limit(max_search_depth);
        if search_depth == 0 {
            return None;
        }

        // Search downward from start_y
        for y in (0..=start_y).rev().take(search_depth) {
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

#[cfg(test)]
mod tests {
    use super::{checked_offset, max_search_depth_limit, required_height_steps};

    #[test]
    fn checked_offset_rejects_i32_overflow() {
        assert_eq!(checked_offset(i32::MAX, 1), None);
        assert_eq!(checked_offset(i32::MIN, -1), None);
        assert_eq!(checked_offset(10, -3), Some(7));
    }

    #[test]
    fn max_search_depth_limit_rejects_non_positive_values() {
        assert_eq!(max_search_depth_limit(-1), 0);
        assert_eq!(max_search_depth_limit(0), 0);
        assert_eq!(max_search_depth_limit(3), 3);
    }

    #[test]
    fn required_height_steps_rejects_invalid_inputs() {
        assert_eq!(required_height_steps(-0.1), None);
        assert_eq!(required_height_steps(f32::NAN), None);
        assert_eq!(required_height_steps(f32::INFINITY), None);
    }

    #[test]
    fn required_height_steps_rounds_up_and_clamps_range() {
        assert_eq!(required_height_steps(0.0), Some(0));
        assert_eq!(required_height_steps(1.1), Some(2));
        assert_eq!(required_height_steps(i32::MAX as f32 + 1000.0), None);
    }
}
