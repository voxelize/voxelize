use crate::{BrainComp, PathComp, RigidBodyComp, Stats, Vec3};
use log::warn;
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

pub struct WalkTowardsSystem;

impl<'a> System<'a> for WalkTowardsSystem {
    #[allow(clippy::type_complexity)]
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadStorage<'a, PathComp>,
        WriteStorage<'a, RigidBodyComp>,
        WriteStorage<'a, BrainComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (stats, paths, mut bodies, mut brains) = data;

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
                        // Check if we've passed this node (with some tolerance)
                        let dx = (current_pos.0 - (node.0 as f32 + 0.5)).abs();
                        let dz = (current_pos.2 - (node.2 as f32 + 0.5)).abs();

                        // If we're close enough to this node, target the next one
                        if dx < 1.2 && dz < 1.2 {
                            if index < nodes.len() - 1 {
                                i = index + 1;
                                target = nodes[i].clone();
                            } else {
                                i = index;
                                target = node.clone();
                            }
                        } else if index > 0 {
                            // We haven't reached this node yet
                            i = index;
                            target = node.clone();
                            break;
                        }
                    }

                    // If we've reached the end of the path
                    if i == nodes.len() - 1 {
                        let dx = (current_pos.0 - (target.0 as f32 + 0.5)).abs();
                        let dz = (current_pos.2 - (target.2 as f32 + 0.5)).abs();
                        if dx < 0.3 && dz < 0.3 {
                            brain.stop();
                            return;
                        }
                    }

                    // jumping
                    if vpos.1 < nodes[i].1 {
                        brain.jump();
                    } else {
                        brain.stop_jumping();
                    }

                    // Smooth target calculation
                    let offset = 0.5;
                    let mut smooth_target = Vec3(
                        target.0 as f32 + offset,
                        target.1 as f32,
                        target.2 as f32 + offset,
                    );

                    // If we have a next node, create a smoother target by interpolating
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

                        // Calculate distance to current target
                        let dist_to_current = ((current_pos.0 - current_target.0).powi(2)
                            + (current_pos.2 - current_target.2).powi(2))
                        .sqrt();

                        // Check if we're making a turn (direction change)
                        let is_turning = if i > 0 {
                            let prev_node = &nodes[i - 1];
                            let dir1_x = target.0 - prev_node.0;
                            let dir1_z = target.2 - prev_node.2;
                            let dir2_x = next_node.0 - target.0;
                            let dir2_z = next_node.2 - target.2;
                            dir1_x != dir2_x || dir1_z != dir2_z
                        } else {
                            false
                        };

                        // Be more conservative with blending at corners
                        let blend_threshold = if is_turning { 1.0 } else { 1.5 };
                        let blend_range = if is_turning { 0.5 } else { 1.0 };

                        // Start blending when we're close to the current target
                        if dist_to_current < blend_threshold {
                            let blend_factor =
                                ((blend_threshold - dist_to_current) / blend_range).min(0.3);
                            smooth_target = Vec3(
                                current_target.0 * (1.0 - blend_factor)
                                    + next_target.0 * blend_factor,
                                current_target.1, // Keep Y from current target for jumping logic
                                current_target.2 * (1.0 - blend_factor)
                                    + next_target.2 * blend_factor,
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
