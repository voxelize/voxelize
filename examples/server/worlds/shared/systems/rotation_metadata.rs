use specs::{ReadStorage, System, WriteStorage};
use voxelize::MetadataComp;

use crate::worlds::shared::components::RotationComp;

pub struct RotationMetadataSystem;

impl<'a> System<'a> for RotationMetadataSystem {
    type SystemData = (
        ReadStorage<'a, RotationComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (rotations, mut metadatas) = data;

        (&rotations, &mut metadatas)
            .par_join()
            .for_each(|(rotation, metadata)| {
                metadata.set("rotation", rotation);
            });
    }
}
