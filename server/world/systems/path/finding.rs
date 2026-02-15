use std::cell::Cell;
use std::sync::{Arc, RwLock};
use std::time::Instant;

use hashbrown::HashMap;
use crate::{
    world::system_profiler::WorldTimingContext, AStar, Chunks, PathComp, PathNode, Registry,
    RigidBodyComp, TargetComp, Vec3, VoxelAccess, WorldConfig,
};
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

#[derive(Default)]
pub struct PathFindingSystem {
    voxel_cache_buffer: HashMap<(i32, i32, i32), bool>,
}

impl<'a> System<'a> for PathFindingSystem {
    type SystemData = (
        ReadExpect<'a, Chunks>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, WorldTimingContext>,
        ReadStorage<'a, RigidBodyComp>,
        ReadStorage<'a, TargetComp>,
        WriteStorage<'a, PathComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (chunks, registry, _config, timing, bodies, targets, mut paths) = data;
        let _t = timing.timer("path-finding");

        let mut voxel_cache_map = std::mem::take(&mut self.voxel_cache_buffer);
        voxel_cache_map.clear();
        if voxel_cache_map.capacity() < 256 {
            voxel_cache_map.reserve(256 - voxel_cache_map.capacity());
        }
        let voxel_cache = Arc::new(RwLock::new(voxel_cache_map));

        let get_is_voxel_passable = |vx: i32, vy: i32, vz: i32| {
            let key = (vx, vy, vz);
            if let Some(is_passable) = voxel_cache.read().unwrap().get(&key).copied() {
                return is_passable;
            }

            let voxel = chunks.get_voxel(vx, vy, vz);
            let block = registry.get_block_by_id(voxel);
            let is_passable = block.is_passable || block.is_fluid;

            let mut cache = voxel_cache.write().unwrap();
            *cache.entry(key).or_insert(is_passable)
        };

        // Returns whether or not a block can be stepped on
        let walkable = |vx: i32, vy: i32, vz: i32, h: f32| {
            if get_is_voxel_passable(vx, vy, vz) {
                return false;
            }

            let Some(height_steps) = clamped_height_scan_steps(h) else {
                return false;
            };
            for i in 1..=height_steps {
                let Some(check_y) = vy.checked_add(i) else {
                    return false;
                };
                if !get_is_voxel_passable(vx, check_y, vz) {
                    return false;
                }
            }

            true
        };

        // More lenient check for start positions - allows for edge standing and non-full blocks
        let is_position_supported = |pos: &Vec3<i32>, aabb_width: f32| -> bool {
            if !aabb_width.is_finite() || aabb_width < 0.0 {
                return false;
            }
            let half_width = clamp_f64_to_i32((f64::from(aabb_width) * 0.5).ceil()).max(0);

            // Check corners and edges of the bot's base
            let check_points = [
                (-half_width, -half_width),
                (half_width, -half_width),
                (-half_width, half_width),
                (half_width, half_width),
                (0, -half_width),
                (0, half_width),
                (-half_width, 0),
                (half_width, 0),
            ];

            for (dx, dz) in check_points {
                let Some(check_x) = pos.0.checked_add(dx) else {
                    continue;
                };
                let Some(check_z) = pos.2.checked_add(dz) else {
                    continue;
                };

                // Check if there's a solid block below this point
                let Some(below_y) = pos.1.checked_sub(1) else {
                    continue;
                };
                let below = chunks.get_voxel(check_x, below_y, check_z);
                let block = registry.get_block_by_id(below);
                if !block.is_passable && !block.is_fluid {
                    return true;
                }
            }

            false
        };

        let has_wall_nearby = |vx: i32, vy: i32, vz: i32| -> bool {
            for dx in -1..=1 {
                let Some(nx) = vx.checked_add(dx) else {
                    continue;
                };
                for dz in -1..=1 {
                    if dx == 0 && dz == 0 {
                        continue;
                    }
                    let Some(nz) = vz.checked_add(dz) else {
                        continue;
                    };
                    if !get_is_voxel_passable(nx, vy, nz) {
                        return true;
                    }
                }
            }
            false
        };

        let get_standable_voxel = |voxel: &Vec3<i32>, max_drop: i32| -> Vec3<i32> {
            let mut voxel = *voxel;
            let min_y = 0;
            let original_y = voxel.1;

            if voxel.1 < min_y {
                voxel.1 = min_y;
            }

            if !get_is_voxel_passable(voxel.0, voxel.1, voxel.2) {
                return voxel;
            }

            let min_allowed_y = original_y.saturating_sub(max_drop).max(min_y);

            while voxel.1 > min_allowed_y {
                let Some(next_y) = voxel.1.checked_sub(1) else {
                    break;
                };
                if get_is_voxel_passable(voxel.0, next_y, voxel.2) {
                    voxel.1 = next_y;
                } else {
                    break;
                }
            }

            voxel
        };

        (&bodies, &targets, &mut paths)
            .par_join()
            .for_each(|(body, target, entity_path)| {
                if let Some(target_position) = &target.position {
                    let body_vpos = body.0.get_voxel_position();

                    let height = body.0.aabb.height();
                    let max_distance_allowed = entity_path.max_distance;
                    if !max_distance_allowed.is_finite() || max_distance_allowed < 0.0 {
                        entity_path.path = None;
                        return;
                    }
                    let max_distance_sq =
                        f64::from(max_distance_allowed) * f64::from(max_distance_allowed);

                    let (Some(target_x), Some(target_y), Some(target_z)) = (
                        floor_f32_to_i32(target_position.0),
                        floor_f32_to_i32(target_position.1),
                        floor_f32_to_i32(target_position.2),
                    ) else {
                        entity_path.path = None;
                        return;
                    };
                    let target_vpos = Vec3(target_x, target_y, target_z);

                    if !get_is_voxel_passable(target_vpos.0, target_vpos.1, target_vpos.2) {
                        entity_path.path = None;
                        return;
                    }

                    // Check the distance between the robot and the target
                    // If the distance is too large, skip pathfinding for this entity
                    let distance_sq = squared_voxel_distance_f64(&body_vpos, &target_vpos);
                    if !distance_sq.is_finite() || distance_sq > max_distance_sq {
                        entity_path.path = None;
                        return;
                    }

                    // For the start position, check if we're already in a valid state
                    // (e.g., on an edge or in a non-full block)
                    let aabb_width = (body.0.aabb.max_x - body.0.aabb.min_x)
                        .max(body.0.aabb.max_z - body.0.aabb.min_z);

                    let start = if body.0.at_rest_y() < 0
                        || is_position_supported(&body_vpos, aabb_width)
                    {
                        body_vpos
                    } else {
                        get_standable_voxel(&body_vpos, 3)
                    };

                    let goal = get_standable_voxel(&target_vpos, 2);

                    if !get_is_voxel_passable(goal.0, goal.1, goal.2) {
                        entity_path.path = None;
                        return;
                    }

                    // Check if the start and goal are too far apart for pathfinding
                    let start_goal_distance_sq = squared_voxel_distance_f64(&start, &goal);
                    if !start_goal_distance_sq.is_finite()
                        || start_goal_distance_sq > max_distance_sq
                    {
                        entity_path.path = None;
                        return;
                    }

                    let start_time = Instant::now();
                    let count = Cell::new(0i32);
                    let max_depth_search = normalized_max_depth_search(entity_path.max_depth_search);
                    if max_depth_search == 0 {
                        entity_path.path = None;
                        return;
                    }
                    let goal_node = PathNode(goal.0, goal.1, goal.2);

                    let path = AStar::calculate(
                        &start,
                        &goal,
                        &|node| {
                            let &PathNode(vx, vy, vz) = node;
                            let current_count = count.get();

                            if current_count >= max_depth_search
                                || start_time.elapsed() > entity_path.max_pathfinding_time
                            {
                                return Vec::new();
                            }
                            count.set(current_count + 1);
                            if !can_expand_successors(vx, vy, vz) {
                                return Vec::new();
                            }
                            let mut successors = Vec::with_capacity(12);

                            // emptiness
                            let py = !walkable(vx, vy + 1, vz, height);
                            let px = !walkable(vx + 1, vy, vz, height);
                            let pz = !walkable(vx, vy, vz + 1, height);
                            let nx = !walkable(vx - 1, vy, vz, height);
                            let nz = !walkable(vx, vy, vz - 1, height);
                            let pxpy = !walkable(vx + 1, vy + 1, vz, height);
                            let pzpy = !walkable(vx, vy + 1, vz + 1, height);
                            let nxpy = !walkable(vx - 1, vy + 1, vz, height);
                            let nzpy = !walkable(vx, vy + 1, vz - 1, height);

                            // +X direction
                            if walkable(vx + 1, vy - 1, vz, height) {
                                let mut cost = 1;
                                if has_wall_nearby(vx + 1, vy, vz) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx + 1, vy, vz), cost));
                            } else if walkable(vx + 1, vy, vz, height) && py {
                                let mut cost = 2;
                                if has_wall_nearby(vx + 1, vy + 1, vz) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx + 1, vy + 1, vz), cost));
                            } else if walkable(vx + 1, vy - 2, vz, height) && px {
                                successors.push((PathNode(vx + 1, vy - 1, vz), 2));
                            }

                            // -X direction
                            if walkable(vx - 1, vy - 1, vz, height) {
                                let mut cost = 1;
                                if has_wall_nearby(vx - 1, vy, vz) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx - 1, vy, vz), cost));
                            } else if walkable(vx - 1, vy, vz, height) && py {
                                let mut cost = 2;
                                if has_wall_nearby(vx - 1, vy + 1, vz) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx - 1, vy + 1, vz), cost));
                            } else if walkable(vx - 1, vy - 2, vz, height) && nx {
                                successors.push((PathNode(vx - 1, vy - 1, vz), 2));
                            }

                            // +Z direction
                            if walkable(vx, vy - 1, vz + 1, height) {
                                let mut cost = 1;
                                if has_wall_nearby(vx, vy, vz + 1) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx, vy, vz + 1), cost));
                            } else if walkable(vx, vy, vz + 1, height) && py {
                                let mut cost = 2;
                                if has_wall_nearby(vx, vy + 1, vz + 1) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx, vy + 1, vz + 1), cost));
                            } else if walkable(vx, vy - 2, vz + 1, height) && pz {
                                successors.push((PathNode(vx, vy - 1, vz + 1), 2));
                            }

                            // -Z direction
                            if walkable(vx, vy - 1, vz - 1, height) {
                                let mut cost = 1;
                                if has_wall_nearby(vx, vy, vz - 1) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx, vy, vz - 1), cost));
                            } else if walkable(vx, vy, vz - 1, height) && py {
                                let mut cost = 2;
                                if has_wall_nearby(vx, vy + 1, vz - 1) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx, vy + 1, vz - 1), cost));
                            } else if walkable(vx, vy - 2, vz - 1, height) && nz {
                                successors.push((PathNode(vx, vy - 1, vz - 1), 2));
                            }

                            // +X+Z direction
                            if walkable(vx + 1, vy - 1, vz + 1, height)
                                && px
                                && pz
                                && get_is_voxel_passable(vx + 1, vy, vz)
                                && get_is_voxel_passable(vx, vy, vz + 1)
                            {
                                let mut cost = 2;
                                if has_wall_nearby(vx + 1, vy, vz + 1) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx + 1, vy, vz + 1), cost));
                            } else if walkable(vx + 1, vy, vz + 1, height) && py && pxpy && pzpy {
                                successors.push((PathNode(vx + 1, vy + 1, vz + 1), 3));
                            } else if walkable(vx + 1, vy - 2, vz + 1, height) && px && pz {
                                successors.push((PathNode(vx + 1, vy - 1, vz + 1), 3));
                            }

                            // +X-Z direction
                            if walkable(vx + 1, vy - 1, vz - 1, height)
                                && px
                                && nz
                                && get_is_voxel_passable(vx + 1, vy, vz)
                                && get_is_voxel_passable(vx, vy, vz - 1)
                            {
                                let mut cost = 2;
                                if has_wall_nearby(vx + 1, vy, vz - 1) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx + 1, vy, vz - 1), cost));
                            } else if walkable(vx + 1, vy, vz - 1, height) && py && pxpy && nzpy {
                                successors.push((PathNode(vx + 1, vy + 1, vz - 1), 3));
                            } else if walkable(vx + 1, vy - 2, vz - 1, height) && px && nz {
                                successors.push((PathNode(vx + 1, vy - 1, vz - 1), 3));
                            }

                            // -X+Z direction
                            if walkable(vx - 1, vy - 1, vz + 1, height)
                                && nx
                                && pz
                                && get_is_voxel_passable(vx - 1, vy, vz)
                                && get_is_voxel_passable(vx, vy, vz + 1)
                            {
                                let mut cost = 2;
                                if has_wall_nearby(vx - 1, vy, vz + 1) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx - 1, vy, vz + 1), cost));
                            } else if walkable(vx - 1, vy, vz + 1, height) && py && nxpy && pzpy {
                                successors.push((PathNode(vx - 1, vy + 1, vz + 1), 3));
                            } else if walkable(vx - 1, vy - 2, vz + 1, height) && nx && pz {
                                successors.push((PathNode(vx - 1, vy - 1, vz + 1), 3));
                            }

                            // -X-Z direction
                            if walkable(vx - 1, vy - 1, vz - 1, height)
                                && nx
                                && nz
                                && get_is_voxel_passable(vx - 1, vy, vz)
                                && get_is_voxel_passable(vx, vy, vz - 1)
                            {
                                let mut cost = 2;
                                if has_wall_nearby(vx - 1, vy, vz - 1) {
                                    cost += 1;
                                }
                                successors.push((PathNode(vx - 1, vy, vz - 1), cost));
                            } else if walkable(vx - 1, vy, vz - 1, height) && py && nxpy && nzpy {
                                successors.push((PathNode(vx - 1, vy + 1, vz - 1), 3));
                            } else if walkable(vx - 1, vy - 2, vz - 1, height) && nx && nz {
                                successors.push((PathNode(vx - 1, vy - 1, vz - 1), 3));
                            }

                            successors
                        },
                        &|p| p.distance(&goal_node) / 3,
                    );

                    if let Some((nodes, count)) = path {
                        if count > clamp_usize_to_u32(entity_path.max_nodes) {
                            entity_path.path = None;
                        } else {
                            let mut path_nodes = Vec::with_capacity(nodes.len());
                            for PathNode(nx, ny, nz) in nodes {
                                path_nodes.push(Vec3(nx, ny, nz));
                            }
                            entity_path.path = Some(path_nodes);

                            // Apply path smoothing to the first few nodes
                            if let Some(ref mut path_nodes) = entity_path.path {
                                smooth_path(path_nodes, &chunks, &registry, height);
                            }
                        }
                    } else {
                        entity_path.path = None;
                    }

                    // let elapsed = start_time.elapsed();
                    // if elapsed > entity_path.max_pathfinding_time {
                    //     warn!(
                    //         "Pathfinding exceeded time limit for entity at {:?}. Took {:?}",
                    //         body_vpos, elapsed
                    //     );
                    // }
                }
            });

        if let Ok(cache_lock) = Arc::try_unwrap(voxel_cache) {
            if let Ok(mut cache_map) = cache_lock.into_inner() {
                cache_map.clear();
                self.voxel_cache_buffer = cache_map;
            }
        }
    }
}

fn smooth_path(path: &mut Vec<Vec3<i32>>, chunks: &Chunks, registry: &Registry, height: f32) {
    if path.len() < 3 {
        return;
    }

    const EPSILON: f32 = 0.5;
    const MAX_TURN_ANGLE: f32 = 75.0;

    let simplified = rdp_simplify(path, EPSILON);

    let mut validated_path = Vec::with_capacity(path.len());
    validated_path.push(simplified[0]);
    let mut from_original_idx = 0usize;

    for i in 1..simplified.len() {
        let to = &simplified[i];
        let to_original_idx = find_path_index_from(path, from_original_idx, to);
        let from = &path[from_original_idx];

        let turn_angle = if validated_path.len() >= 2 {
            let prev = &validated_path[validated_path.len() - 2];
            calculate_angle_change(prev, from, to)
        } else {
            0.0
        };

        if turn_angle > MAX_TURN_ANGLE {
            for idx in (from_original_idx + 1)..to_original_idx {
                if idx < path.len() {
                    validated_path.push(path[idx]);
                }
            }
        }

        if can_walk_directly_with_clearance(from, to, chunks, registry, height) {
            validated_path.push(*to);
        } else {
            for idx in (from_original_idx + 1)..=to_original_idx {
                if idx < path.len() {
                    validated_path.push(path[idx]);
                }
            }
        }

        from_original_idx = to_original_idx;
    }

    if validated_path.len() >= 2 {
        *path = validated_path;
    }
}

#[inline]
fn find_path_index_from(path: &[Vec3<i32>], start_idx: usize, point: &Vec3<i32>) -> usize {
    if path.is_empty() {
        return 0;
    }
    let mut index = start_idx.min(path.len() - 1);
    while index < path.len() {
        if path[index] == *point {
            return index;
        }
        index += 1;
    }
    path.len() - 1
}

fn rdp_simplify(points: &[Vec3<i32>], epsilon: f32) -> Vec<Vec3<i32>> {
    if points.len() < 3 {
        return points.to_vec();
    }

    let mut max_dist = 0.0;
    let mut max_index = 0;
    let end = points.len() - 1;

    for i in 1..end {
        let dist = perpendicular_distance(&points[i], &points[0], &points[end]);
        if dist > max_dist {
            max_dist = dist;
            max_index = i;
        }
    }

    if max_dist > epsilon {
        let left = rdp_simplify(&points[0..=max_index], epsilon);
        let right = rdp_simplify(&points[max_index..=end], epsilon);

        let mut result = left;
        result.extend_from_slice(&right[1..]);
        result
    } else {
        vec![points[0], points[end]]
    }
}

fn perpendicular_distance(point: &Vec3<i32>, line_start: &Vec3<i32>, line_end: &Vec3<i32>) -> f32 {
    let dx = (line_end.0 - line_start.0) as f32;
    let dz = (line_end.2 - line_start.2) as f32;
    let mag = (dx * dx + dz * dz).sqrt();

    if mag < 0.001 {
        let px = (point.0 - line_start.0) as f32;
        let pz = (point.2 - line_start.2) as f32;
        return (px * px + pz * pz).sqrt();
    }

    let u = (((point.0 - line_start.0) as f32 * dx + (point.2 - line_start.2) as f32 * dz)
        / (mag * mag))
        .clamp(0.0, 1.0);

    let closest_x = line_start.0 as f32 + u * dx;
    let closest_z = line_start.2 as f32 + u * dz;

    let dist_x = point.0 as f32 - closest_x;
    let dist_z = point.2 as f32 - closest_z;

    (dist_x * dist_x + dist_z * dist_z).sqrt()
}

fn can_walk_directly_with_clearance(
    from: &Vec3<i32>,
    to: &Vec3<i32>,
    chunks: &Chunks,
    registry: &Registry,
    height: f32,
) -> bool {
    if !can_walk_directly(from, to, chunks, registry, height) {
        return false;
    }

    let dx = (to.0 - from.0) as f32;
    let dz = (to.2 - from.2) as f32;
    let mag = (dx * dx + dz * dz).sqrt();

    if mag < 0.001 {
        return true;
    }

    let perp_x = -dz / mag;
    let perp_z = dx / mag;

    let body_width = height;
    let clearance = body_width * 1.2;
    let check_offsets = [
        (perp_x * clearance, perp_z * clearance),
        (-perp_x * clearance, -perp_z * clearance),
    ];

    for (offset_x, offset_z) in &check_offsets {
        let offset_from = Vec3(
            (from.0 as f32 + offset_x).round() as i32,
            from.1,
            (from.2 as f32 + offset_z).round() as i32,
        );
        let offset_to = Vec3(
            (to.0 as f32 + offset_x).round() as i32,
            to.1,
            (to.2 as f32 + offset_z).round() as i32,
        );

        if !can_walk_directly(&offset_from, &offset_to, chunks, registry, height) {
            return false;
        }
    }

    true
}

#[inline]
fn floor_f32_to_i32(value: f32) -> Option<i32> {
    if !value.is_finite() {
        return None;
    }
    let floored = f64::from(value).floor();
    if floored < f64::from(i32::MIN) || floored > f64::from(i32::MAX) {
        return None;
    }
    Some(floored as i32)
}

#[inline]
fn axis_delta_i64(to: i32, from: i32) -> i64 {
    i64::from(to) - i64::from(from)
}

#[inline]
fn squared_voxel_distance_f64(a: &Vec3<i32>, b: &Vec3<i32>) -> f64 {
    let dx = axis_delta_i64(a.0, b.0) as f64;
    let dy = axis_delta_i64(a.1, b.1) as f64;
    let dz = axis_delta_i64(a.2, b.2) as f64;
    dx.mul_add(dx, dy.mul_add(dy, dz * dz))
}

#[inline]
fn clamped_height_scan_steps(height: f32) -> Option<i32> {
    if !height.is_finite() || height < 0.0 {
        return None;
    }
    let ceil_height = height.ceil();
    if ceil_height > i32::MAX as f32 {
        return None;
    }
    Some(ceil_height as i32)
}

#[inline]
fn clamp_f64_to_i32(value: f64) -> i32 {
    value.clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

#[inline]
fn clamp_usize_to_u32(value: usize) -> u32 {
    if value > u32::MAX as usize {
        u32::MAX
    } else {
        value as u32
    }
}

#[inline]
fn normalized_max_depth_search(value: i32) -> i32 {
    value.max(0)
}

#[inline]
fn can_expand_successors(vx: i32, vy: i32, vz: i32) -> bool {
    vx > i32::MIN + 1
        && vx < i32::MAX - 1
        && vy > i32::MIN + 2
        && vy < i32::MAX - 1
        && vz > i32::MIN + 1
        && vz < i32::MAX - 1
}

/// Calculate the angle change in degrees between three points
fn calculate_angle_change(p1: &Vec3<i32>, p2: &Vec3<i32>, p3: &Vec3<i32>) -> f32 {
    // Vector from p1 to p2
    let v1_x = axis_delta_i64(p2.0, p1.0) as f64;
    let v1_z = axis_delta_i64(p2.2, p1.2) as f64;

    // Vector from p2 to p3
    let v2_x = axis_delta_i64(p3.0, p2.0) as f64;
    let v2_z = axis_delta_i64(p3.2, p2.2) as f64;

    // Calculate magnitudes
    let mag1 = (v1_x * v1_x + v1_z * v1_z).sqrt();
    let mag2 = (v2_x * v2_x + v2_z * v2_z).sqrt();

    if mag1 <= f64::EPSILON || mag2 <= f64::EPSILON {
        return 0.0;
    }

    // Normalize vectors
    let v1_x = v1_x / mag1;
    let v1_z = v1_z / mag1;
    let v2_x = v2_x / mag2;
    let v2_z = v2_z / mag2;

    // Calculate dot product
    let dot = v1_x * v2_x + v1_z * v2_z;

    // Clamp to avoid numerical errors
    let dot = dot.clamp(-1.0, 1.0);

    // Calculate angle in degrees
    dot.acos().to_degrees() as f32
}

/// Check if we can walk directly between two points
fn can_walk_directly(
    from: &Vec3<i32>,
    to: &Vec3<i32>,
    chunks: &Chunks,
    registry: &Registry,
    height: f32,
) -> bool {
    let dx = axis_delta_i64(to.0, from.0);
    let dy = axis_delta_i64(to.1, from.1);
    let dz = axis_delta_i64(to.2, from.2);

    // Don't try to smooth if there's significant height change
    if dy.unsigned_abs() > 1 {
        return false;
    }

    // Use Bresenham-like line algorithm with proper corner checking
    let steps = dx.unsigned_abs().max(dz.unsigned_abs());

    if steps == 0 {
        return true;
    }
    if steps > i32::MAX as u64 {
        return false;
    }
    let steps_i32 = steps as i32;

    let step_x = dx as f64 / steps as f64;
    let step_z = dz as f64 / steps as f64;
    let step_y = dy as f64 / steps as f64;

    // Check each position along the line
    for i in 0..=steps_i32 {
        let step = i as f64;
        let x = clamp_f64_to_i32((f64::from(from.0) + step_x * step).round());
        let z = clamp_f64_to_i32((f64::from(from.2) + step_z * step).round());
        let y = clamp_f64_to_i32((f64::from(from.1) + step_y * step).round());

        // Check if position is walkable
        if !is_position_walkable(x, y, z, chunks, registry, height) {
            return false;
        }
    }

    true
}

/// Check if a specific position is walkable
fn is_position_walkable(
    x: i32,
    y: i32,
    z: i32,
    chunks: &Chunks,
    registry: &Registry,
    height: f32,
) -> bool {
    // Check ground below
    let Some(y_below) = y.checked_sub(1) else {
        return false;
    };
    let below_voxel = chunks.get_voxel(x, y_below, z);
    let below_block = registry.get_block_by_id(below_voxel);

    // Must have solid ground below
    if below_block.is_passable || below_block.is_fluid {
        return false;
    }

    // Check space for bot height
    let Some(height_steps) = clamped_height_scan_steps(height) else {
        return false;
    };
    for h in 0..=height_steps {
        let Some(check_y) = y.checked_add(h) else {
            return false;
        };
        let check_voxel = chunks.get_voxel(x, check_y, z);
        let check_block = registry.get_block_by_id(check_voxel);

        // Space must be passable
        if !check_block.is_passable {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::{
        axis_delta_i64, can_expand_successors, clamp_f64_to_i32, clamp_usize_to_u32,
        clamped_height_scan_steps, find_path_index_from, floor_f32_to_i32,
        normalized_max_depth_search, squared_voxel_distance_f64,
    };
    use crate::Vec3;

    #[test]
    fn axis_delta_i64_handles_i32_extreme_values() {
        assert_eq!(axis_delta_i64(i32::MAX, i32::MIN), 4_294_967_295);
        assert_eq!(axis_delta_i64(i32::MIN, i32::MAX), -4_294_967_295);
    }

    #[test]
    fn clamped_height_scan_steps_rejects_invalid_values() {
        assert_eq!(clamped_height_scan_steps(-1.0), None);
        assert_eq!(clamped_height_scan_steps(f32::NAN), None);
        assert_eq!(clamped_height_scan_steps(f32::INFINITY), None);
    }

    #[test]
    fn clamp_f64_to_i32_saturates_extreme_values() {
        assert_eq!(clamp_f64_to_i32(f64::from(i32::MAX) + 10_000.0), i32::MAX);
        assert_eq!(clamp_f64_to_i32(f64::from(i32::MIN) - 10_000.0), i32::MIN);
        assert_eq!(clamp_f64_to_i32(42.0), 42);
    }

    #[test]
    fn floor_f32_to_i32_rejects_non_finite_and_out_of_range_values() {
        assert_eq!(floor_f32_to_i32(f32::NAN), None);
        assert_eq!(floor_f32_to_i32(f32::INFINITY), None);
        assert_eq!(floor_f32_to_i32(i32::MAX as f32 + 1000.0), None);
        assert_eq!(floor_f32_to_i32(12.9), Some(12));
    }

    #[test]
    fn squared_voxel_distance_f64_handles_i32_extreme_values() {
        let a = Vec3(i32::MIN, i32::MIN, i32::MIN);
        let b = Vec3(i32::MAX, i32::MAX, i32::MAX);
        let dist = squared_voxel_distance_f64(&a, &b);
        assert!(dist.is_finite());
        assert!(dist > 0.0);
    }

    #[test]
    fn clamp_usize_to_u32_saturates_large_values() {
        assert_eq!(clamp_usize_to_u32(5), 5);
        assert_eq!(clamp_usize_to_u32(usize::MAX), u32::MAX);
    }

    #[test]
    fn normalized_max_depth_search_rejects_negative_values() {
        assert_eq!(normalized_max_depth_search(-10), 0);
        assert_eq!(normalized_max_depth_search(0), 0);
        assert_eq!(normalized_max_depth_search(25), 25);
    }

    #[test]
    fn find_path_index_from_scans_forward_and_falls_back_to_end() {
        let path = vec![Vec3(0, 0, 0), Vec3(1, 0, 0), Vec3(2, 0, 0)];
        assert_eq!(find_path_index_from(&path, 0, &Vec3(1, 0, 0)), 1);
        assert_eq!(find_path_index_from(&path, 2, &Vec3(0, 0, 0)), 2);
        assert_eq!(find_path_index_from(&path, usize::MAX, &Vec3(5, 0, 0)), 2);
    }

    #[test]
    fn can_expand_successors_rejects_values_near_overflow_boundaries() {
        assert!(can_expand_successors(0, 0, 0));
        assert!(!can_expand_successors(i32::MAX, 0, 0));
        assert!(!can_expand_successors(i32::MIN, 0, 0));
        assert!(!can_expand_successors(0, i32::MAX, 0));
        assert!(!can_expand_successors(0, i32::MIN, 0));
        assert!(!can_expand_successors(0, i32::MIN + 2, 0));
    }
}
