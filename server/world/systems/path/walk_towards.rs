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

                    let mut i = 0;
                    let mut target = nodes[i].clone();

                    // Find the next target node
                    for (index, node) in nodes.iter().enumerate() {
                        if node.0 != vpos.0 || node.2 != vpos.2 {
                            i = index;
                            target = node.clone();
                            break;
                        }
                    }

                    // If we've reached the end of the path
                    if i == nodes.len() - 1 && target.0 == vpos.0 && target.2 == vpos.2 {
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
