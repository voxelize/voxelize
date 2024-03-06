use specs::{ReadStorage, System, WriteStorage};
use crate::{MetadataComp, PathComp};

pub struct PathMetadataSystem;

impl<'a> System<'a> for PathMetadataSystem {
    type SystemData = (ReadStorage<'a, PathComp>, WriteStorage<'a, MetadataComp>);

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (paths, mut metadatas) = data;

        (&paths, &mut metadatas)
            .par_join()
            .for_each(|(path, metadata)| {
                metadata.set("path", path);
            });
    }
}
