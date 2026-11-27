use specs::{ReadStorage, System, WriteStorage};

use crate::world::components::{ClientFlag, DirectionComp, MetadataComp, NameComp, PositionComp};
use crate::world::VoiceStateComp;

pub struct PeersMetaSystem;

impl<'a> System<'a> for PeersMetaSystem {
    type SystemData = (
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, DirectionComp>,
        ReadStorage<'a, NameComp>,
        ReadStorage<'a, VoiceStateComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::{Join, LendJoin};

        let (flag, positions, directions, names, voices, mut metadatas) = data;

        // Every key in one pass over the peers.
        (
            &positions,
            &directions,
            &names,
            voices.maybe(),
            &mut metadatas,
            &flag,
        )
            .join()
            .for_each(|(position, direction, name, voice, metadata, _)| {
                metadata.set("position", position);
                metadata.set("direction", direction);
                metadata.set("username", name);
                // Only a client that has spoken for its voice carries the
                // key (see `world::voice`): most peers never turn it on.
                if let Some(voice) = voice {
                    metadata.set("voice", voice);
                }
            });
    }
}
