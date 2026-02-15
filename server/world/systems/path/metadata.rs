use crate::{MetadataComp, PathComp, WorldTimingContext};
use specs::{ReadExpect, System, WriteStorage};

pub struct PathMetadataSystem;

impl<'a> System<'a> for PathMetadataSystem {
    type SystemData = (
        WriteStorage<'a, PathComp>,
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (mut paths, mut metadatas, timing) = data;
        let _t = timing.timer("path-metadata");

        (&mut paths, &mut metadatas)
            .par_join()
            .for_each(|(path, metadata)| {
                if !path.dirty {
                    metadata.set_once("path", path);
                    return;
                }
                metadata.set("path", path);
                path.dirty = false;
            });
    }
}
