use std::sync::Arc;

use log::info;
use specs::{ReadExpect, ReadStorage, System, WriteExpect};

use crate::{Chunks, ETypeComp, IDComp, MetadataComp, SaveLoad, Stats, WorldConfig};

pub struct EntitySavingSystem;

impl<'a> System<'a> for EntitySavingSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, SaveLoad>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        ReadStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (stats, config, saveload, ids, etypes, metadatas) = data;

        if !config.saving {
            return;
        }

        if stats.tick % config.save_interval as u64 != 0 {
            return;
        }

        let saveload = Arc::new(saveload);

        (&ids, &etypes, &metadatas)
            .par_join()
            .for_each(|(id, etype, metadata)| {
                saveload.save(id, etype, metadata);
            });
    }
}
