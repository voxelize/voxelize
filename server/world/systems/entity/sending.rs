use specs::{Entities, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    Bookkeeping, ClientFilter, ETypeComp, EntityFlag, EntityOperation, EntityProtocol, IDComp,
    Message, MessageQueue, MessageType, MetadataComp, Stats,
};

pub struct EntitiesSendingSystem;

impl<'a> System<'a> for EntitiesSendingSystem {
    type SystemData = (
        Entities<'a>,
        ReadExpect<'a, Stats>,
        WriteExpect<'a, MessageQueue>,
        WriteExpect<'a, Bookkeeping>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (entities, stats, mut queue, mut bookkeeping, flags, ids, etypes, mut metadatas) = data;

        if stats.tick % 2 == 1 {
            return;
        }

        let mut updated_entities = Vec::new();
        for (id, _) in (&ids, &flags).join() {
            updated_entities.push(id.0.to_owned());
        }

        let bookkeeping_results = bookkeeping.differentiate_entities(&updated_entities);

        let mut entities = vec![];

        for (id, etype, metadata, _) in (&ids, &etypes, &mut metadatas, &flags).join() {
            if bookkeeping_results.created.contains(&id.0) {
                entities.push(EntityProtocol {
                    operation: EntityOperation::Create,
                    id: id.0.to_owned(),
                    r#type: etype.0.to_owned(),
                    metadata: Some(metadata.to_string()),
                });

                continue;
            }

            if metadata.is_empty() {
                continue;
            }

            let (json_str, updated) = metadata.to_cached_str();

            if !updated {
                continue;
            }

            entities.push(EntityProtocol {
                operation: EntityOperation::Update,
                id: id.0.to_owned(),
                r#type: etype.0.to_owned(),
                metadata: Some(json_str),
            });

            metadata.reset();
        }

        bookkeeping_results.deleted.iter().for_each(|id| {
            entities.push(EntityProtocol {
                operation: EntityOperation::Delete,
                id: id.to_owned(),
                // Wouldn't have the data since it has been deleted.
                r#type: String::new(),
                metadata: None,
            });
        });

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
