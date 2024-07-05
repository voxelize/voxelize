use std::sync::Arc;

use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::{ETypeComp, EntitiesSaver, IDComp, MetadataComp, Stats, WorldConfig};

pub struct DataSavingSystem;

impl<'a> System<'a> for DataSavingSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, EntitiesSaver>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (stats, config, entities_saver, ids, etypes, mut metadatas) = data;

        if !config.saving {
            return;
        }

        if stats.tick % config.save_interval as u64 != 0 {
            return;
        }

        // Only save entities if save_entities is true
        if config.save_entities {
            let entities_saver = Arc::new(entities_saver);

            (&ids, &etypes, &mut metadatas)
                .par_join()
                .for_each(|(id, etype, metadata)| {
                    entities_saver.save(&id.0, &etype.0, etype.1, &metadata);
                });
        }

        stats.save();
    }
}
