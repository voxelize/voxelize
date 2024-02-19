use specs::{ReadStorage, System, WriteStorage};
use voxelize::MetadataComp;

use crate::worlds::shared::components::TargetComp;

pub struct TargetMetadataSystem;

impl<'a> System<'a> for TargetMetadataSystem {
    type SystemData = (ReadStorage<'a, TargetComp>, WriteStorage<'a, MetadataComp>);

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (targets, mut metadatas) = data;

        (&targets, &mut metadatas)
            .par_join()
            .for_each(|(target, metadata)| {
                metadata.set("target", target);
            });
    }
}
