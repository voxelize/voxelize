use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::{
    world::system_profiler::WorldTimingContext, AStar, Chunks, PathComp, PathNode, Registry,
    RigidBodyComp, TargetComp, Vec3, VoxelAccess, WorldConfig,
};
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

pub struct PathFindingSystem;

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

        let voxel_cache = Arc::new(Mutex::new(HashMap::new()));

        let get_is_voxel_passable = |vx: i32, vy: i32, vz: i32| {
            let key = (vx, vy, vz);
            let mut cache = voxel_cache.lock().unwrap();
            *cache.entry(key).or_insert_with(|| {
                let voxel = chunks.get_voxel(vx, vy, vz);
                let block = registry.get_block_by_id(voxel);
                block.is_passable || block.is_fluid
            })
        };

        // Returns whether or not a block can be stepped on
        let walkable = |vx: i32, vy: i32, vz: i32, h: f32| {
            if get_is_voxel_passable(vx, vy, vz) {
                return false;
            }

            for i in 1..(h.ceil() as i32 + 1) {
                if !get_is_voxel_passable(vx, vy + i, vz) {
                    return false;
                }
            }

            true
        };

        // More lenient check for start positions - allows for edge standing and non-full blocks
        let is_position_supported = |pos: &Vec3<i32>, aabb_width: f32| -> bool {
            let half_width = (aabb_width / 2.0).ceil() as i32;

            // Check corners and edges of the bot's base
            let check_points = vec![
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
                let check_x = pos.0 + dx;
                let check_z = pos.2 + dz;

                // Check if there's a solid block below this point
                let below = chunks.get_voxel(check_x, pos.1 - 1, check_z);
                let block = registry.get_block_by_id(below);
                if !block.is_passable && !block.is_fluid {
                    return true;
                }
            }

            false
        };

        let has_wall_nearby = |vx: i32, vy: i32, vz: i32| -> bool {
            for dx in -1..=1 {
                for dz in -1..=1 {
                    if dx == 0 && dz == 0 {
                        continue;
                    }
                    if !get_is_voxel_passable(vx + dx, vy, vz + dz) {
                        return true;
                    }
                }
            }
            false
        };

        let get_standable_voxel = |voxel: &Vec3<i32>, max_drop: i32| -> Vec3<i32> {
            let mut voxel = voxel.clone();
            let min_y = 0;
            let original_y = voxel.1;

            if voxel.1 < min_y {
                voxel.1 = min_y;
            }

            if !get_is_voxel_passable(voxel.0, voxel.1, voxel.2) {
                return voxel;
            }

            let min_allowed_y = (original_y - max_drop).max(min_y);

            while voxel.1 > min_allowed_y {
                if get_is_voxel_passable(voxel.0, voxel.1 - 1, voxel.2) {
                    voxel.1 -= 1;
                } else {
                    break;
                }
            }

            voxel
        };

        (&bodies, &targets, &mut paths)
            .par_join()
            .for_each(|(body, target, entity_path)| {
                if let Some(target_position) = target.position.to_owned() {
                    let body_vpos = body.0.get_voxel_position();

                    let height = body.0.aabb.height();

                    let target_vpos = Vec3(
                        target_position.0.floor() as i32,
                        target_position.1.floor() as i32,
                        target_position.2.floor() as i32,
                    );

                    if !get_is_voxel_passable(target_vpos.0, target_vpos.1, target_vpos.2) {
                        entity_path.path = None;
                        return;
                    }

                    // Check the distance between the robot and the target
                    // If the distance is too large, skip pathfinding for this entity
                    let max_distance_allowed = entity_path.max_distance as f64; // Set this to a suitable value for your game
                    let distance = ((body_vpos.0 - target_vpos.0).pow(2)
                        + (body_vpos.1 - target_vpos.1).pow(2)
                        + (body_vpos.2 - target_vpos.2).pow(2))
                        as f64;
                    if distance.sqrt() > max_distance_allowed {
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
                        body_vpos.clone()
                    } else {
                        get_standable_voxel(&body_vpos, 3)
                    };

                    let goal = get_standable_voxel(&target_vpos, 2);

                    if !get_is_voxel_passable(goal.0, goal.1, goal.2) {
                        entity_path.path = None;
                        return;
                    }

                    // Check if the start and goal are too far apart for pathfinding
                    let start_goal_distance = ((start.0 - goal.0).pow(2)
                        + (start.1 - goal.1).pow(2)
                        + (start.2 - goal.2).pow(2))
                        as f64;
                    if start_goal_distance.sqrt() > max_distance_allowed {
                        entity_path.path = None;
                        return;
                    }

                    // Before starting the A* search, check if goal position is valid
                    // Note: We don't check the start position here because the bot might be
                    // in a valid but unconventional position (on edge, in fence, etc.)
                    if !get_is_voxel_passable(goal.0, goal.1, goal.2) {
                        entity_path.path = None;
                        return;
                    }

                    let start_time = Instant::now();
                    let count = AtomicI32::new(0);

                    let path = AStar::calculate(
                        &start,
                        &goal,
                        &|node| {
                            let &PathNode(vx, vy, vz) = node;
                            let mut successors = vec![];
                            let current_count = count.fetch_add(1, Ordering::Relaxed);

                            if current_count >= entity_path.max_depth_search
                                || start_time.elapsed() > entity_path.max_pathfinding_time
                            {
                                return successors;
                            }

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
                        &|p| p.distance(&PathNode(goal.0, goal.1, goal.2)) / 3,
                    );

                    if let Some((nodes, count)) = path {
                        if count > entity_path.max_nodes as u32 {
                            entity_path.path = None;
                        } else {
                            entity_path.path = Some(
                                nodes
                                    .clone()
                                    .iter()
                                    .map(|p| Vec3(p.0, p.1, p.2))
                                    .collect::<Vec<_>>(),
                            );

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
    }
}

fn smooth_path(path: &mut Vec<Vec3<i32>>, chunks: &Chunks, registry: &Registry, height: f32) {
    if path.len() < 3 {
        return;
    }

    const EPSILON: f32 = 0.5;
    const MAX_TURN_ANGLE: f32 = 75.0;

    let simplified = rdp_simplify(path, EPSILON);

    let mut validated_path = vec![simplified[0].clone()];

    for i in 1..simplified.len() {
        let from = validated_path[validated_path.len() - 1].clone();
        let to = simplified[i].clone();

        let turn_angle = if validated_path.len() >= 2 {
            let prev = validated_path[validated_path.len() - 2].clone();
            calculate_angle_change(&prev, &from, &to)
        } else {
            0.0
        };

        if turn_angle > MAX_TURN_ANGLE {
            let original_idx = path.iter().position(|p| *p == from).unwrap_or(0);
            let next_original_idx = path.iter().position(|p| *p == to).unwrap_or(path.len() - 1);

            for idx in (original_idx + 1)..next_original_idx {
                if idx < path.len() {
                    validated_path.push(path[idx].clone());
                }
            }
        }

        if can_walk_directly_with_clearance(&from, &to, chunks, registry, height) {
            validated_path.push(to.clone());
        } else {
            let original_idx = path.iter().position(|p| *p == from).unwrap_or(0);
            let next_original_idx = path.iter().position(|p| *p == to).unwrap_or(path.len() - 1);

            for idx in (original_idx + 1)..=next_original_idx {
                if idx < path.len() {
                    validated_path.push(path[idx].clone());
                }
            }
        }
    }

    if validated_path.len() >= 2 {
        *path = validated_path;
    }
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
        vec![points[0].clone(), points[end].clone()]
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

/// Calculate the angle change in degrees between three points
fn calculate_angle_change(p1: &Vec3<i32>, p2: &Vec3<i32>, p3: &Vec3<i32>) -> f32 {
    // Vector from p1 to p2
    let v1_x = (p2.0 - p1.0) as f32;
    let v1_z = (p2.2 - p1.2) as f32;

    // Vector from p2 to p3
    let v2_x = (p3.0 - p2.0) as f32;
    let v2_z = (p3.2 - p2.2) as f32;

    // Calculate magnitudes
    let mag1 = (v1_x * v1_x + v1_z * v1_z).sqrt();
    let mag2 = (v2_x * v2_x + v2_z * v2_z).sqrt();

    if mag1 == 0.0 || mag2 == 0.0 {
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
    dot.acos().to_degrees()
}

/// Check if we can walk directly between two points
fn can_walk_directly(
    from: &Vec3<i32>,
    to: &Vec3<i32>,
    chunks: &Chunks,
    registry: &Registry,
    height: f32,
) -> bool {
    let dx = to.0 - from.0;
    let dy = to.1 - from.1;
    let dz = to.2 - from.2;

    // Don't try to smooth if there's significant height change
    if dy.abs() > 1 {
        return false;
    }

    // Use Bresenham-like line algorithm with proper corner checking
    let steps = dx.abs().max(dz.abs());

    if steps == 0 {
        return true;
    }

    let step_x = dx as f32 / steps as f32;
    let step_z = dz as f32 / steps as f32;

    // Check each position along the line
    for i in 0..=steps {
        let x = (from.0 as f32 + step_x * i as f32).round() as i32;
        let z = (from.2 as f32 + step_z * i as f32).round() as i32;
        let y = from.1 + ((dy as f32 * i as f32 / steps as f32).round() as i32);

        // Check if position is walkable
        if !is_position_walkable(x, y, z, chunks, registry, height) {
            return false;
        }

        // Also check adjacent positions to avoid corner clipping
        // This is important when moving diagonally
        if i > 0 && i < steps {
            let prev_x = (from.0 as f32 + step_x * (i - 1) as f32).round() as i32;
            let prev_z = (from.2 as f32 + step_z * (i - 1) as f32).round() as i32;

            // Check the two cells that form the "corner" when moving diagonally
            if x != prev_x && z != prev_z {
                // We're moving diagonally, check if we can navigate the corner
                let corner_clear = is_position_walkable(x, y, z, chunks, registry, height);
                let side1_clear = is_position_walkable(prev_x, y, z, chunks, registry, height);
                let side2_clear = is_position_walkable(x, y, prev_z, chunks, registry, height);

                if !corner_clear && !side1_clear && !side2_clear {
                    return false;
                }
            }
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
    let below_voxel = chunks.get_voxel(x, y - 1, z);
    let below_block = registry.get_block_by_id(below_voxel);

    // Must have solid ground below
    if below_block.is_passable || below_block.is_fluid {
        return false;
    }

    // Check space for bot height
    for h in 0..(height.ceil() as i32 + 1) {
        let check_voxel = chunks.get_voxel(x, y + h, z);
        let check_block = registry.get_block_by_id(check_voxel);

        // Space must be passable
        if !check_block.is_passable {
            return false;
        }
    }

    true
}
