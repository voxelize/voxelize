use crate::{MetadataComp, TargetComp, WorldTimingContext};
use specs::{ReadExpect, System, WriteStorage};

pub struct TargetMetadataSystem;

impl<'a> System<'a> for TargetMetadataSystem {
    type SystemData = (
        WriteStorage<'a, TargetComp>,
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (mut targets, mut metadatas, timing) = data;
        let _t = timing.timer("target-metadata");

        (&mut targets, &mut metadatas)
            .par_join()
            .for_each(|(target, metadata)| {
                if !target.dirty && metadata.map.contains_key("target") {
                    return;
                }
                metadata.set("target", target);
                target.dirty = false;
            });
    }
}
