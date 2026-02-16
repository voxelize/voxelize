use specs::{Join, ReadExpect, ReadStorage, System};

use crate::{
    BackgroundEntitiesSaver, DoNotPersistComp, ETypeComp, IDComp, MetadataComp, Stats, WorldConfig,
    WorldTimingContext,
};

pub struct DataSavingSystem;

#[inline]
fn should_save_now(tick: u64, save_interval: usize) -> bool {
    let interval = save_interval.max(1) as u64;
    tick % interval == 0
}

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

        if !should_save_now(stats.tick, config.save_interval) {
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

#[cfg(test)]
mod tests {
    use super::should_save_now;

    #[test]
    fn should_save_now_treats_zero_interval_as_every_tick() {
        assert!(should_save_now(0, 0));
        assert!(should_save_now(1, 0));
        assert!(should_save_now(99, 0));
    }

    #[test]
    fn should_save_now_respects_non_zero_interval() {
        assert!(should_save_now(0, 3));
        assert!(!should_save_now(1, 3));
        assert!(!should_save_now(2, 3));
        assert!(should_save_now(3, 3));
        assert!(should_save_now(6, 3));
    }
}
