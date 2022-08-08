use std::sync::Arc;

use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::{ETypeComp, Entities, IDComp, MetadataComp, Stats, WorldConfig};

pub struct EntitiesSavingSystem;

impl<'a> System<'a> for EntitiesSavingSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Entities>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (stats, config, entities, ids, etypes, mut metadatas) = data;

        if !config.saving {
            return;
        }

        if stats.tick % config.save_interval as u64 != 0 {
            return;
        }

        let entities = Arc::new(entities);

        (&ids, &etypes, &mut metadatas)
            .par_join()
            .for_each(|(id, etype, metadata)| {
                entities.save(id, etype, metadata);
            });
    }
}
