use specs::{ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    common::ClientFilter,
    server::models::{Entity, Message, MessageType},
    world::{
        comps::{etype::ETypeComp, flags::EntityFlag, id::IDComp, metadata::MetadataComp},
        messages::MessageQueue,
    },
};

pub struct BroadcastEntitiesSystem;

impl<'a> System<'a> for BroadcastEntitiesSystem {
    type SystemData = (
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (mut queue, flag, ids, etypes, mut metadatas) = data;

        let mut entities = vec![];
        for (id, etype, metadata, _) in (&ids, &etypes, &mut metadatas, &flag).join() {
            entities.push(Entity {
                id: id.0.to_owned(),
                r#type: etype.0.to_owned(),
                metadata: Some(serde_json::to_string(&metadata.0).unwrap()),
            });

            metadata.0.clear();
        }

        queue.push((
            Message::new(&MessageType::Entity)
                .entities(&entities)
                .build(),
            ClientFilter::All,
        ));
    }
}
