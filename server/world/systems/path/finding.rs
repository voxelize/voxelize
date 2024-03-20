use std::sync::{Arc, Mutex};

use crate::{
    AStar, Chunks, PathComp, PathNode, Registry, RigidBodyComp, TargetComp, Vec3, VoxelAccess,
    WorldConfig,
};
use log::info;
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

const MAX_DEPTH_SEARCH: i32 = 2048;

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

        let get_is_voxel_passable = |vx: i32, vy: i32, vz: i32| {
            let voxel = chunks.get_voxel(vx, vy, vz);
            let block = registry.get_block_by_id(voxel);
            block.is_passable || block.is_fluid
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
            let min_y = 0; // Set this to the minimum y value allowed in your game world

            loop {
                if voxel.1 <= min_y || get_is_voxel_passable(voxel.0, voxel.1, voxel.2) {
                    if voxel.1 <= min_y {
                        // If we've reached or passed the minimum y value, stop adjusting the voxel.
                        // This prevents an infinite loop in scenarios where no solid ground is found.
                        voxel.1 = min_y;
                    } else {
                        // If the current voxel is passable, decrement y to check the voxel below.
                        voxel.1 -= 1;
                    }
                } else {
                    // Found a non-passable voxel, indicating solid ground. Break the loop.
                    break;
                }
            }

            voxel.1 += 1; // Adjust to the standing position on top of the found solid ground.
            voxel
        };

        (&bodies, &targets, &mut paths)
            .par_join()
            .for_each(|(body, target, entity_path)| {
                if let Some(target) = target.1.to_owned() {
                    let body_pos = body.0.get_position();

                    let height = body.0.aabb.height();

                    // Position has to be rounded down because it's offset by +0.5
                    let body_vpos = Vec3(
                        body_pos.0.floor() as i32,
                        body_pos.1.floor() as i32,
                        body_pos.2.floor() as i32,
                    );
                    let target_vpos = Vec3(
                        target.0.floor() as i32,
                        target.1.floor() as i32,
                        target.2.floor() as i32,
                    );

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

                    // Check if the start and goal are too far apart for pathfinding
                    let start_goal_distance = ((start.0 - goal.0).pow(2)
                        + (start.1 - goal.1).pow(2)
                        + (start.2 - goal.2).pow(2))
                        as f64;
                    if start_goal_distance.sqrt() > max_distance_allowed {
                        entity_path.path = None;
                        return;
                    }

                    let count = Arc::new(Mutex::new(0));

                    let path = AStar::calculate(
                        &start,
                        &goal,
                        &|node| {
                            let &PathNode(vx, vy, vz) = node;
                            let mut successors = vec![];
                            let mut locked_count = count.lock().unwrap();

                            *locked_count += 1;
                            if *locked_count >= MAX_DEPTH_SEARCH {
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
                }
            });
    }
}
