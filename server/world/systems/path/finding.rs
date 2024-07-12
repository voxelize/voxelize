use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::{
    AStar, Chunks, PathComp, PathNode, Registry, RigidBodyComp, TargetComp, Vec3, VoxelAccess,
    WorldConfig,
};
use log::warn;
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

pub struct PathFindingSystem;

impl<'a> System<'a> for PathFindingSystem {
    type SystemData = (
        ReadExpect<'a, Chunks>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadStorage<'a, RigidBodyComp>,
        ReadStorage<'a, TargetComp>,
        WriteStorage<'a, PathComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (chunks, registry, config, bodies, targets, mut paths) = data;

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

        let get_standable_voxel = |voxel: &Vec3<i32>| -> Vec3<i32> {
            let mut voxel = voxel.clone();
            let min_y = 0; // Ensure this is the absolute minimum Y value in your game world.

            // Ensure we start within the world bounds.
            if voxel.1 < min_y {
                voxel.1 = min_y;
            }

            // Edge case for half blocks like slabs
            if !get_is_voxel_passable(voxel.0, voxel.1, voxel.2) {
                return voxel;
            }

            while voxel.1 > min_y {
                if get_is_voxel_passable(voxel.0, voxel.1 - 1, voxel.2) {
                    // If the voxel below is passable, decrement y to check further below.
                    voxel.1 -= 1;
                } else {
                    // Found a non-passable voxel below, indicating solid ground.
                    break;
                }
            }

            // No need to adjust voxel.1 here as we're now ensuring the loop checks the voxel below for passability,
            // meaning we're already at the correct height for standing when the loop exits.

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

                    let start = get_standable_voxel(&body_vpos);
                    let goal = get_standable_voxel(&target_vpos);

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

                    // Before starting the A* search, check if start and goal positions are valid
                    if !get_is_voxel_passable(goal.0, goal.1, goal.2) {
                        entity_path.path = None;
                        return;
                    }

                    let start_time = Instant::now();
                    let count = Arc::new(Mutex::new(0));

                    let path = AStar::calculate(
                        &start,
                        &goal,
                        &|node| {
                            let &PathNode(vx, vy, vz) = node;
                            let mut successors = vec![];
                            let mut locked_count = count.lock().unwrap();

                            *locked_count += 1;
                            if *locked_count >= entity_path.max_depth_search
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
                                successors.push((PathNode(vx + 1, vy, vz), 1));
                            } else if walkable(vx + 1, vy, vz, height) && py {
                                successors.push((PathNode(vx + 1, vy + 1, vz), 2));
                            } else if walkable(vx + 1, vy - 2, vz, height) && px {
                                successors.push((PathNode(vx + 1, vy - 1, vz), 2));
                            }

                            // -X direction
                            if walkable(vx - 1, vy - 1, vz, height) {
                                successors.push((PathNode(vx - 1, vy, vz), 1));
                            } else if walkable(vx - 1, vy, vz, height) && py {
                                successors.push((PathNode(vx - 1, vy + 1, vz), 2));
                            } else if walkable(vx - 1, vy - 2, vz, height) && nx {
                                successors.push((PathNode(vx - 1, vy - 1, vz), 2));
                            }

                            // +Z direction
                            if walkable(vx, vy - 1, vz + 1, height) {
                                successors.push((PathNode(vx, vy, vz + 1), 1));
                            } else if walkable(vx, vy, vz + 1, height) && py {
                                successors.push((PathNode(vx, vy + 1, vz + 1), 2));
                            } else if walkable(vx, vy - 2, vz + 1, height) && pz {
                                successors.push((PathNode(vx, vy - 1, vz + 1), 2));
                            }

                            // -Z direction
                            if walkable(vx, vy - 1, vz - 1, height) {
                                successors.push((PathNode(vx, vy, vz - 1), 1));
                            } else if walkable(vx, vy, vz - 1, height) && py {
                                successors.push((PathNode(vx, vy + 1, vz - 1), 2));
                            } else if walkable(vx, vy - 2, vz - 1, height) && nz {
                                successors.push((PathNode(vx, vy - 1, vz - 1), 2));
                            }

                            // +X+Z direction
                            if walkable(vx + 1, vy - 1, vz + 1, height) && px && pz {
                                successors.push((PathNode(vx + 1, vy, vz + 1), 2));
                            } else if walkable(vx + 1, vy, vz + 1, height) && py && pxpy && pzpy {
                                successors.push((PathNode(vx + 1, vy + 1, vz + 1), 3));
                            } else if walkable(vx + 1, vy - 2, vz + 1, height) && px && pz {
                                successors.push((PathNode(vx + 1, vy - 1, vz + 1), 3));
                            }

                            // +X-Z direction
                            if walkable(vx + 1, vy - 1, vz - 1, height) && px && nz {
                                successors.push((PathNode(vx + 1, vy, vz - 1), 2));
                            } else if walkable(vx + 1, vy, vz - 1, height) && py && pxpy && nzpy {
                                successors.push((PathNode(vx + 1, vy + 1, vz - 1), 3));
                            } else if walkable(vx + 1, vy - 2, vz - 1, height) && px && nz {
                                successors.push((PathNode(vx + 1, vy - 1, vz - 1), 3));
                            }

                            // -X+Z direction
                            if walkable(vx - 1, vy - 1, vz + 1, height) && nx && pz {
                                successors.push((PathNode(vx - 1, vy, vz + 1), 2));
                            } else if walkable(vx - 1, vy, vz + 1, height) && py && nxpy && pzpy {
                                successors.push((PathNode(vx - 1, vy + 1, vz + 1), 3));
                            } else if walkable(vx - 1, vy - 2, vz + 1, height) && nx && pz {
                                successors.push((PathNode(vx - 1, vy - 1, vz + 1), 3));
                            }

                            // -X-Z direction
                            if walkable(vx - 1, vy - 1, vz - 1, height) && nx && nz {
                                successors.push((PathNode(vx - 1, vy, vz - 1), 2));
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
