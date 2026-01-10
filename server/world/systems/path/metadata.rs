use specs::{ReadExpect, ReadStorage, System, WriteStorage};
use crate::{MetadataComp, PathComp, WorldTimingContext};

pub struct PathMetadataSystem;

impl<'a> System<'a> for PathMetadataSystem {
    type SystemData = (ReadStorage<'a, PathComp>, WriteStorage<'a, MetadataComp>, ReadExpect<'a, WorldTimingContext>);

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (paths, mut metadatas, timing) = data;
        let _t = timing.timer("path-metadata");

        (&paths, &mut metadatas)
            .par_join()
            .for_each(|(path, metadata)| {
                metadata.set("path", path);
            });
    }
}
