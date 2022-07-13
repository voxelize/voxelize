use specs::{ReadStorage, System, WriteStorage};

use crate::world::components::{EntityFlag, MetadataComp, PositionComp};

pub struct EntityMetaSystem;

impl<'a> System<'a> for EntityMetaSystem {
    type SystemData = (
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, PositionComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (flag, positions, mut metadatas) = data;

        (&positions, &mut metadatas, &flag)
            .par_join()
            .for_each(|(position, metadata, _)| {
                metadata.set("position", position);
            });
    }
}
