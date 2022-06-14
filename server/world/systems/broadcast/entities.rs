use specs::{ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    ClientFilter, ETypeComp, EntityFlag, EntityProtocol, IDComp, Message, MessageQueue,
    MessageType, MetadataComp, Stats,
};

pub struct BroadcastEntitiesSystem;

impl<'a> System<'a> for BroadcastEntitiesSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        WriteExpect<'a, MessageQueue>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, mut queue, flag, ids, etypes, mut metadatas) = data;

        if stats.tick % 2 == 1 {
            return;
        }

        let mut entities = vec![];
        for (id, etype, metadata, _) in (&ids, &etypes, &mut metadatas, &flag).join() {
            entities.push(EntityProtocol {
                id: id.0.to_owned(),
                r#type: etype.0.to_owned(),
                metadata: Some(metadata.to_json_string()),
            });

            metadata.reset();
        }

        if entities.is_empty() {
            return;
        }

        queue.push((
            Message::new(&MessageType::Entity)
                .entities(&entities)
                .build(),
            ClientFilter::All,
        ));
    }
}
