use specs::{ReadStorage, System, WriteStorage};

use crate::world::components::{ClientFlag, DirectionComp, MetadataComp, NameComp, PositionComp};

pub struct PeersMetaSystem;

impl<'a> System<'a> for PeersMetaSystem {
    type SystemData = (
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, DirectionComp>,
        ReadStorage<'a, NameComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (flag, positions, directions, names, mut metadatas) = data;

        // Combine all updates into a single parallel iteration to optimize performance
        (&positions, &directions, &names, &mut metadatas, &flag)
            .par_join()
            .for_each(|(position, direction, name, metadata, _)| {
                metadata.set("position", position);
                metadata.set("direction", direction);
                metadata.set("username", name);
            });
    }
}
