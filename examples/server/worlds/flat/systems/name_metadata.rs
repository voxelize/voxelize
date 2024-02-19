use specs::{ReadStorage, System, WriteStorage};
use voxelize::MetadataComp;

use crate::worlds::flat::Name;

pub struct NameMetadataSystem;

impl<'a> System<'a> for NameMetadataSystem {
    type SystemData = (ReadStorage<'a, Name>, WriteStorage<'a, MetadataComp>);

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (texts, mut metadatas) = data;

        (&texts, &mut metadatas)
            .par_join()
            .for_each(|(text, metadata)| {
                metadata.set("text", text);
            });
    }
}
