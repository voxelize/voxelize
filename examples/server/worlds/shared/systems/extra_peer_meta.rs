use specs::{ReadStorage, System, WriteStorage};
use voxelize::MetadataComp;

use crate::worlds::shared::components::HoldingObjectIdComp;
use crate::worlds::shared::components::RoleComp;

pub struct ExtraPeerMetaSystem;

impl<'a> System<'a> for ExtraPeerMetaSystem {
    type SystemData = (
        ReadStorage<'a, RoleComp>,
        ReadStorage<'a, HoldingObjectIdComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (roles, holding_object_ids, mut metadatas) = data;

        (&roles, &holding_object_ids, &mut metadatas)
            .par_join()
            .for_each(|(role, holding_object_id, metadata)| {
                metadata.set("role", role);
                metadata.set("holding_object_id", holding_object_id);
            });
    }
}
