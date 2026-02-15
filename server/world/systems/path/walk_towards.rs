use crate::{BrainComp, PathComp, RigidBodyComp, Stats, Vec3, WorldTimingContext};
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

const NODE_ADVANCE_THRESHOLD: f32 = 0.7;
const FINAL_NODE_THRESHOLD: f32 = 0.3;
const CORNER_SLOWDOWN_FACTOR: f32 = 0.15;
const TIGHT_TURN_ANGLE_THRESHOLD: f32 = 100.0;

#[inline]
fn axis_delta_f64(to: i32, from: i32) -> f64 {
    (i64::from(to) - i64::from(from)) as f64
}

#[inline]
fn axis_abs_delta_u64(a: i32, b: i32) -> u64 {
    (i64::from(a) - i64::from(b)).unsigned_abs()
}

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
                    let node_count = nodes.len();
                    if node_count == 0 {
                        brain.stop();
                        return;
                    }

                    let vpos = body.0.get_voxel_position();
                    let current_pos = body.0.get_position();

                    let mut target_index = 0;

                    // Find the current and next target nodes
                    for index in 0..node_count {
                        let node = &nodes[index];
                        let dx = (current_pos.0 - (node.0 as f32 + 0.5)).abs();
                        let dz = (current_pos.2 - (node.2 as f32 + 0.5)).abs();

                        if dx < NODE_ADVANCE_THRESHOLD && dz < NODE_ADVANCE_THRESHOLD {
                            if index < node_count - 1 {
                                target_index = index + 1;
                            } else {
                                target_index = index;
                            }
                        } else if index > 0 {
                            target_index = index;
                            break;
                        }
                    }
                    let target = &nodes[target_index];

                    if target_index == node_count - 1 {
                        let dx = (current_pos.0 - (target.0 as f32 + 0.5)).abs();
                        let dz = (current_pos.2 - (target.2 as f32 + 0.5)).abs();
                        if dx < FINAL_NODE_THRESHOLD && dz < FINAL_NODE_THRESHOLD {
                            brain.stop();
                            return;
                        }
                    }

                    // jumping
                    if vpos.1 < target.1 {
                        brain.jump();
                        brain.sprint();
                    } else {
                        brain.stop_jumping();
                        brain.stop_sprinting();
                    }

                    // Smooth target calculation
                    let offset = 0.5;
                    let current_target = Vec3(
                        target.0 as f32 + offset,
                        target.1 as f32,
                        target.2 as f32 + offset,
                    );
                    let mut smooth_target = current_target;

                    if target_index < node_count - 1 {
                        let next_node = &nodes[target_index + 1];
                        let next_target = Vec3(
                            next_node.0 as f32 + offset,
                            next_node.1 as f32,
                            next_node.2 as f32 + offset,
                        );

                        let current_dx = current_pos.0 - current_target.0;
                        let current_dz = current_pos.2 - current_target.2;
                        let dist_to_current =
                            (current_dx * current_dx + current_dz * current_dz).sqrt();

                        let (is_turning, turn_angle) = if target_index > 0 {
                            let prev_node = &nodes[target_index - 1];
                            let dir1_x = axis_delta_f64(target.0, prev_node.0);
                            let dir1_z = axis_delta_f64(target.2, prev_node.2);
                            let dir2_x = axis_delta_f64(next_node.0, target.0);
                            let dir2_z = axis_delta_f64(next_node.2, target.2);

                            let is_turn = dir1_x != dir2_x || dir1_z != dir2_z;

                            let mag1 = (dir1_x * dir1_x + dir1_z * dir1_z).sqrt();
                            let mag2 = (dir2_x * dir2_x + dir2_z * dir2_z).sqrt();

                            let angle = if mag1 > 0.01 && mag2 > 0.01 {
                                let dot = (dir1_x * dir2_x + dir1_z * dir2_z) / (mag1 * mag2);
                                dot.clamp(-1.0, 1.0).acos().to_degrees() as f32
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

                    if target_index > 0 && target_index < node_count {
                        let prev_node = &nodes[target_index - 1];
                        let curr_node = &nodes[target_index];

                        let dy = i64::from(curr_node.1) - i64::from(prev_node.1);
                        let dx = axis_abs_delta_u64(curr_node.0, prev_node.0);
                        let dz = axis_abs_delta_u64(curr_node.2, prev_node.2);

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

#[cfg(test)]
mod tests {
    use super::{axis_abs_delta_u64, axis_delta_f64};

    #[test]
    fn axis_delta_f64_handles_i32_extremes() {
        assert_eq!(axis_delta_f64(i32::MAX, i32::MIN), 4_294_967_295.0);
        assert_eq!(axis_delta_f64(i32::MIN, i32::MAX), -4_294_967_295.0);
    }

    #[test]
    fn axis_abs_delta_u64_handles_i32_extremes() {
        assert_eq!(axis_abs_delta_u64(i32::MAX, i32::MIN), 4_294_967_295);
        assert_eq!(axis_abs_delta_u64(i32::MIN, i32::MAX), 4_294_967_295);
    }
}
