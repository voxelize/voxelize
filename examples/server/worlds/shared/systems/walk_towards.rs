use specs::{ReadExpect, ReadStorage, System, WriteStorage};
use voxelize::{ChunkUtils, RigidBodyComp, Stats, Vec3, WorldConfig};

use crate::worlds::shared::components::{BrainComp, PathComp};

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

                    // let position = body.0.get_position();
                    // let voxel = Vec3(position.0 as i32, position.1 as i32, position.2 as i32);

                    // let mut i = 0;
                    // let mut target = nodes[i].clone();

                    // loop {
                    //     if i >= nodes.len() - 1 {
                    //         brain.stop();
                    //         return;
                    //     }

                    //     // means currently is in the attended node
                    //     if target == voxel {
                    //         i = i + 1;
                    //         target = nodes[i].clone();
                    //     } else {
                    //         break;
                    //     }
                    // }

                    // // jumping
                    // if nodes.len() > 1 && nodes[0].1 < nodes[1].1 {
                    //     brain.jump();
                    //     target = nodes[1].clone();
                    // } else {
                    //     brain.stop_jumping();
                    // }

                    // // diagonal
                    // if nodes.len() > 1 && nodes[0].0 != nodes[1].0 && nodes[0].1 != nodes[1].1 {
                    //     target = nodes[1].clone();
                    // }

                    // let offset = 0.5;
                    // let target = Vec3(
                    //     target.0 as f32 + offset,
                    //     target.1 as f32,
                    //     target.2 as f32 + offset,
                    // );

                    // brain.walk();
                    // brain.operate(&target, &mut body.0, delta);
                } else {
                    brain.stop();
                }
            });
    }
}
