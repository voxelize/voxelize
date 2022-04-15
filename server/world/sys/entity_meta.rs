use log::info;
use serde_json::json;
use specs::{ReadStorage, System, WriteStorage};

use crate::world::comps::{
    flags::EntityFlag, heading::HeadingComp, metadata::MetadataComp, position::PositionComp,
    target::TargetComp,
};

pub struct EntityMetaSystem;

impl<'a> System<'a> for EntityMetaSystem {
    type SystemData = (
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, PositionComp>,
        ReadStorage<'a, TargetComp>,
        ReadStorage<'a, HeadingComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (flag, positions, targets, headings, mut metadatas) = data;

        for (position, target, heading, metadata, _) in
            (&positions, &targets, &headings, &mut metadatas, &flag).join()
        {
            metadata.set("position", json!(position.0));
            metadata.set("target", json!(target.0));
            metadata.set("heading", json!(heading.0));
        }
    }
}
