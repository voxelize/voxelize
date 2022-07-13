use specs::{ReadStorage, System, WriteStorage};

use crate::{
    world::components::{MetadataComp, PositionComp},
    ClientFlag, DirectionComp, NameComp,
};

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

        (&positions, &mut metadatas, &flag)
            .par_join()
            .for_each(|(position, metadata, _)| {
                metadata.set("position", position);
            });

        (&names, &mut metadatas, &flag)
            .par_join()
            .for_each(|(name, metadata, _)| {
                metadata.set("username", name);
            });

        (&directions, &mut metadatas, &flag)
            .par_join()
            .for_each(|(direction, metadata, _)| {
                metadata.set("direction", direction);
            });
    }
}
