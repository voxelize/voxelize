use specs::{ReadStorage, System, WriteStorage};

use crate::world::components::{EntityFlag, HeadingComp, MetadataComp, PositionComp, TargetComp};

pub struct EntityMetaSystem;

impl<'a> System<'a> for EntityMetaSystem {
    type SystemData = (
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, TargetComp>,
        ReadStorage<'a, HeadingComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (flag, positions, targets, headings, mut metadatas) = data;

        (&positions, &mut metadatas, &flag)
            .par_join()
            .for_each(|(position, metadata, _)| {
                metadata.set("position", position);
            });

        (&headings, &mut metadatas, &flag)
            .par_join()
            .for_each(|(heading, metadata, _)| {
                metadata.set("heading", heading);
            });

        (&targets, &mut metadatas, &flag)
            .par_join()
            .for_each(|(target, metadata, _)| {
                metadata.set("target", target);
            });
    }
}
