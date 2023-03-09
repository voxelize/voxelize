use std::sync::Arc;

use specs::{ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ClientFilter, ETypeComp, EntitiesSaver, IDComp, Message, MessageQueue, MessageType,
    MetadataComp, Stats, WorldConfig,
};

pub struct DataSavingSystem;

impl<'a> System<'a> for DataSavingSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, EntitiesSaver>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (stats, config, entities_saver, mut queue, ids, etypes, mut metadatas) = data;

        if !config.saving {
            return;
        }

        if stats.tick % config.save_interval as u64 != 0 {
            return;
        }

        let entities_saver = Arc::new(entities_saver);

        (&ids, &etypes, &mut metadatas)
            .par_join()
            .for_each(|(id, etype, metadata)| {
                entities_saver.save(id, etype, metadata);
            });

        stats.save();
    }
}
