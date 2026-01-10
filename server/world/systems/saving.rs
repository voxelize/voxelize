use std::sync::Arc;

use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::{DoNotPersistComp, ETypeComp, EntitiesSaver, IDComp, MetadataComp, Stats, WorldConfig, WorldTimingContext};

pub struct DataSavingSystem;

impl<'a> System<'a> for DataSavingSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, EntitiesSaver>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        ReadStorage<'a, DoNotPersistComp>,
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (stats, config, entities_saver, ids, etypes, do_not_persist, mut metadatas, timing) = data;
        let _t = timing.timer("data-saving");

        if !config.saving {
            return;
        }

        if stats.tick % config.save_interval as u64 != 0 {
            return;
        }

        if config.save_entities {
            let entities_saver = Arc::new(entities_saver);

            (&ids, &etypes, !&do_not_persist, &mut metadatas)
                .par_join()
                .for_each(|(id, etype, _, metadata)| {
                    entities_saver.save(&id.0, &etype.0, etype.1, &metadata);
                });
        }

        stats.save();
    }
}
