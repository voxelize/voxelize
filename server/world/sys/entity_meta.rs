use serde_json::json;
use specs::{ReadStorage, System, WriteStorage};

use crate::world::comps::{
    flags::EntityFlag,
    heading::HeadingComp,
    metadata::{Metadata, MetadataComp},
    position::PositionComp,
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
            metadata.0.push(Metadata {
                component: "position".to_owned(),
                value: json!(position.0),
            });
            metadata.0.push(Metadata {
                component: "target".to_owned(),
                value: json!(target.0),
            });
            metadata.0.push(Metadata {
                component: "heading".to_owned(),
                value: json!(heading.0),
            });
        }
    }
}
