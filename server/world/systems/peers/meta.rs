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
        use specs::Join;

        let (flag, positions, directions, names, mut metadatas) = data;

        // All three keys in one pass over the peers.
        (&positions, &directions, &names, &mut metadatas, &flag)
            .join()
            .for_each(|(position, direction, name, metadata, _)| {
                metadata.set("position", position);
                metadata.set("direction", direction);
                metadata.set("username", name);
            });
    }
}
