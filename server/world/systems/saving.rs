use specs::{Join, ReadExpect, ReadStorage, System, WriteStorage};

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
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (stats, config, bg_saver, ids, etypes, do_not_persist, mut metadatas, timing) = data;
        let _t = timing.timer("data-saving");

        if !config.saving {
            return;
        }

        if stats.tick % config.save_interval as u64 != 0 {
            return;
        }

        if config.save_entities {
            for (id, etype, _, metadata) in (&ids, &etypes, !&do_not_persist, &mut metadatas).join()
            {
                let metadata_json = metadata.to_cached_str_for_new_record();
                bg_saver.queue_save(&id.0, &etype.0, etype.1, metadata_json);
            }
        }

        stats.save();
    }
}
