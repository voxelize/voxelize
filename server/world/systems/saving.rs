use specs::{Join, ReadExpect, ReadStorage, System};

use crate::{
    BackgroundEntitiesSaver, DoNotPersistComp, ETypeComp, IDComp, MetadataComp, Stats, WorldConfig,
    WorldTimingContext,
};

pub struct DataSavingSystem;

impl<'a> System<'a> for DataSavingSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, BackgroundEntitiesSaver>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        ReadStorage<'a, DoNotPersistComp>,
        ReadStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (stats, config, bg_saver, ids, etypes, do_not_persist, metadatas, timing) = data;
        let _t = timing.timer("data-saving");

        if !config.saving {
            return;
        }

        if stats.tick % config.save_interval as u64 != 0 {
            return;
        }

        if config.save_entities {
            for (id, etype, _, metadata) in (&ids, &etypes, !&do_not_persist, &metadatas).join()
            {
                bg_saver.queue_save(&id.0, &etype.0, etype.1, &metadata);
            }
        }

        stats.save();
    }
}
