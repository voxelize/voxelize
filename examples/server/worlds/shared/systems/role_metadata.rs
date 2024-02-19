use specs::{ReadStorage, System, WriteStorage};
use voxelize::MetadataComp;

use crate::worlds::shared::components::RoleComp;

pub struct ExtraPeerMetaSystem;

impl<'a> System<'a> for ExtraPeerMetaSystem {
    type SystemData = (ReadStorage<'a, RoleComp>, WriteStorage<'a, MetadataComp>);

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (roles, mut metadatas) = data;

        (&roles, &mut metadatas)
            .par_join()
            .for_each(|(role, metadata)| {
                metadata.set("role", role);
            });
    }
}
