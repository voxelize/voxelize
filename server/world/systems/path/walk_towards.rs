use crate::{BrainComp, PathComp, RigidBodyComp, Stats, Vec3, WorldTimingContext};
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

const NODE_ADVANCE_THRESHOLD: f32 = 0.7;
const FINAL_NODE_THRESHOLD: f32 = 0.3;
const CORNER_SLOWDOWN_FACTOR: f32 = 0.15;
const TIGHT_TURN_ANGLE_THRESHOLD: f32 = 100.0;

pub struct WalkTowardsSystem;

impl<'a> System<'a> for WalkTowardsSystem {
    #[allow(clippy::type_complexity)]
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadStorage<'a, PathComp>,
        WriteStorage<'a, RigidBodyComp>,
        WriteStorage<'a, BrainComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (stats, paths, mut bodies, mut brains, timing) = data;
        let _t = timing.timer("walk-towards");

        let delta = stats.delta;

        (&paths, &mut bodies, &mut brains)
            .par_join()
            .for_each(|(path, body, brain)| {
                if let Some(nodes) = &path.path {
                    if nodes.is_empty() {
                        brain.stop();
                        return;
                    }

                    let vpos = body.0.get_voxel_position();
                    let current_pos = body.0.get_position();

                    let mut i = 0;
                    let mut target = nodes[i].clone();

                    // Find the current and next target nodes
                    for (index, node) in nodes.iter().enumerate() {
                        let dx = (current_pos.0 - (node.0 as f32 + 0.5)).abs();
                        let dz = (current_pos.2 - (node.2 as f32 + 0.5)).abs();

                        if dx < NODE_ADVANCE_THRESHOLD && dz < NODE_ADVANCE_THRESHOLD {
                            if index < nodes.len() - 1 {
                                i = index + 1;
                                target = nodes[i].clone();
                            } else {
                                i = index;
                                target = node.clone();
                            }
                        } else if index > 0 {
                            i = index;
                            target = node.clone();
                            break;
                        }
                    }

                    if i == nodes.len() - 1 {
                        let dx = (current_pos.0 - (target.0 as f32 + 0.5)).abs();
                        let dz = (current_pos.2 - (target.2 as f32 + 0.5)).abs();
                        if dx < FINAL_NODE_THRESHOLD && dz < FINAL_NODE_THRESHOLD {
                            brain.stop();
                            return;
                        }
                    }

                    // jumping
                    if vpos.1 < nodes[i].1 {
                        brain.jump();
                        brain.sprint();
                    } else {
                        brain.stop_jumping();
                        brain.stop_sprinting();
                    }

                    // Smooth target calculation
                    let offset = 0.5;
                    let mut smooth_target = Vec3(
                        target.0 as f32 + offset,
                        target.1 as f32,
                        target.2 as f32 + offset,
                    );

                    if i < nodes.len() - 1 {
                        let next_node = &nodes[i + 1];
                        let current_target = Vec3(
                            target.0 as f32 + offset,
                            target.1 as f32,
                            target.2 as f32 + offset,
                        );
                        let next_target = Vec3(
                            next_node.0 as f32 + offset,
                            next_node.1 as f32,
                            next_node.2 as f32 + offset,
                        );

                        let dist_to_current = ((current_pos.0 - current_target.0).powi(2)
                            + (current_pos.2 - current_target.2).powi(2))
                        .sqrt();

                        let (is_turning, turn_angle) = if i > 0 {
                            let prev_node = &nodes[i - 1];
                            let dir1_x = (target.0 - prev_node.0) as f32;
                            let dir1_z = (target.2 - prev_node.2) as f32;
                            let dir2_x = (next_node.0 - target.0) as f32;
                            let dir2_z = (next_node.2 - target.2) as f32;

                            let is_turn = dir1_x != dir2_x || dir1_z != dir2_z;

                            let mag1 = (dir1_x * dir1_x + dir1_z * dir1_z).sqrt();
                            let mag2 = (dir2_x * dir2_x + dir2_z * dir2_z).sqrt();

                            let angle = if mag1 > 0.01 && mag2 > 0.01 {
                                let dot = (dir1_x * dir2_x + dir1_z * dir2_z) / (mag1 * mag2);
                                dot.clamp(-1.0, 1.0).acos().to_degrees()
                            } else {
                                0.0
                            };

                            (is_turn, angle)
                        } else {
                            (false, 0.0)
                        };

                        let is_tight_turn = turn_angle > TIGHT_TURN_ANGLE_THRESHOLD;

                        let body_width = body.0.aabb.width();
                        let body_scale = body_width / 0.5;

                        let blend_threshold = body_scale
                            * if is_tight_turn {
                                1.0
                            } else if is_turning {
                                1.3
                            } else {
                                1.5
                            };

                        let max_blend = if is_tight_turn {
                            CORNER_SLOWDOWN_FACTOR
                        } else if is_turning {
                            0.2
                        } else {
                            0.3
                        };

                        if dist_to_current < blend_threshold {
                            let blend_factor = ((blend_threshold - dist_to_current)
                                / blend_threshold)
                                .min(max_blend);
                            smooth_target = Vec3(
                                current_target.0 * (1.0 - blend_factor)
                                    + next_target.0 * blend_factor,
                                current_target.1,
                                current_target.2 * (1.0 - blend_factor)
                                    + next_target.2 * blend_factor,
                            );
                        }
                    }

                    if i > 0 && i < nodes.len() {
                        let prev_node = &nodes[i - 1];
                        let curr_node = &nodes[i];

                        let dy = curr_node.1 - prev_node.1;
                        let dx = (curr_node.0 - prev_node.0).abs();
                        let dz = (curr_node.2 - prev_node.2).abs();

                        let is_jump_up = dy > 0 && (dx > 0 || dz > 0);

                        if is_jump_up && vpos.1 < curr_node.1 {
                            smooth_target = Vec3(
                                curr_node.0 as f32 + offset,
                                curr_node.1 as f32,
                                curr_node.2 as f32 + offset,
                            );
                        }
                    }

                    brain.walk();
                    brain.operate(&smooth_target, &mut body.0, delta);
                } else {
                    brain.stop();
                }
            });
    }
}
