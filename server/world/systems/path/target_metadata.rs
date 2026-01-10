use crate::{MetadataComp, TargetComp, WorldTimingContext};
use specs::{ReadExpect, ReadStorage, System, WriteStorage};

pub struct TargetMetadataSystem;

impl<'a> System<'a> for TargetMetadataSystem {
    type SystemData = (ReadStorage<'a, TargetComp>, WriteStorage<'a, MetadataComp>, ReadExpect<'a, WorldTimingContext>);

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (targets, mut metadatas, timing) = data;
        let _t = timing.timer("target-metadata");

        (&targets, &mut metadatas)
            .par_join()
            .for_each(|(target, metadata)| {
                metadata.set("target", target);
            });
    }
}
