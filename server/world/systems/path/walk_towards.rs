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

                    // Add a safety counter to prevent infinite loops
                    let mut safety_counter = 0;
                    let max_iterations = 100; // Adjust as needed

                    let mut i = 0;
                    let mut target = nodes[i].clone();

                    loop {
                        if i >= nodes.len() - 1 || safety_counter >= max_iterations {
                            break;
                        }

                        // means currently is in the attended node
                        if target.0 == vpos.0 && target.2 == vpos.2 {
                            i += 1;
                            target = nodes[i].clone();
                        } else {
                            break;
                        }

                        safety_counter += 1;
                    }

                    // Check if we've hit the safety limit
                    if safety_counter >= max_iterations {
                        warn!("Hit safety limit for entity at position {:?}", vpos);
                        brain.stop();
                        return;
                    }

                    // jumping
                    if vpos.1 < nodes[i].1 {
                        brain.jump();
                    } else {
                        brain.stop_jumping();
                    }

                    let offset = 0.5;
                    let target = Vec3(
                        target.0 as f32 + offset,
                        target.1 as f32,
                        target.2 as f32 + offset,
                    );

                    brain.walk();
                    brain.operate(&target, &mut body.0, delta);
                } else {
                    brain.stop();
                }
            });
    }
}
