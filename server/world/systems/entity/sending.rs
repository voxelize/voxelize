use hashbrown::{HashMap, HashSet};
use log::{info, trace};
use specs::{Entities, Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    Bookkeeping, ClientFilter, ETypeComp, EntitiesSaver, EntityFlag, EntityOperation,
    EntityProtocol, IDComp, InteractorComp, Message, MessageQueue, MessageType, MetadataComp,
    Physics, Stats,
};

pub struct EntitiesSendingSystem;

impl<'a> System<'a> for EntitiesSendingSystem {
    type SystemData = (
        Entities<'a>,
        ReadExpect<'a, EntitiesSaver>,
        WriteExpect<'a, MessageQueue>,
        WriteExpect<'a, Bookkeeping>,
        WriteExpect<'a, Physics>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        ReadStorage<'a, InteractorComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            entities,
            entities_saver,
            mut queue,
            mut bookkeeping,
            mut physics,
            flags,
            ids,
            etypes,
            interactors,
            mut metadatas,
        ) = data;

        let mut new_entity_handlers = HashMap::new();

        for (ent, interactor) in (&entities, &interactors).join() {
            new_entity_handlers.insert(
                ent,
                (
                    interactor.collider_handle().clone(),
                    interactor.body_handle().clone(),
                ),
            );
        }

        let mut updated_entities = vec![];

        for (id, ent, _) in (&ids, &entities, &flags).join() {
            updated_entities.push((id.0.to_owned(), ent));
        }

        let old_entities = bookkeeping
            .entities
            .to_owned()
            .drain()
            .map(|(id, ent)| (id, ent))
            .collect::<Vec<_>>();

        // Differentiating the entities to see which entities are freshly created.
        let mut entity_updates = Vec::with_capacity(updated_entities.len());
        let mut new_entity_ids = HashSet::new();

        let old_entity_handlers = physics.entity_to_handlers.clone();

        old_entities
            .iter()
            .for_each(|(id, (etype, ent, metadata))| {
                let mut found = false;

                for (new_id, _) in &updated_entities {
                    if new_id == id {
                        found = true;
                        break;
                    }
                }

                if found {
                    return;
                }

                entities_saver.remove(id);

                if let Some((collider_handle, body_handle)) = old_entity_handlers.get(ent) {
                    physics.unregister(body_handle, collider_handle);
                }

                entity_updates.push(EntityProtocol {
                    operation: EntityOperation::Delete,
                    id: id.to_owned(),
                    r#type: etype.to_owned(),
                    metadata: Some(metadata.to_string()),
                });
            });

        physics.entity_to_handlers = new_entity_handlers;

        updated_entities
            .iter()
            .filter(|(id, _)| {
                let mut found = false;

                for (old_id, _) in &old_entities {
                    if old_id == id {
                        found = true;
                        break;
                    }
                }

                !found
            })
            .for_each(|(id, _)| {
                new_entity_ids.insert(id.to_owned());
            });

        let mut new_bookkeeping_records = HashMap::new();

        for (ent, id, metadata, etype, _) in
            (&entities, &ids, &mut metadatas, &etypes, &flags).join()
        {
            if metadata.is_empty() {
                continue;
            }

            // Make sure metadata is not empty before recording it.
            new_bookkeeping_records.insert(
                id.0.to_owned(),
                (etype.0.to_owned(), ent, metadata.to_owned()),
            );

            if new_entity_ids.contains(&id.0) {
                entity_updates.push(EntityProtocol {
                    operation: EntityOperation::Create,
                    id: id.0.to_owned(),
                    r#type: etype.0.to_owned(),
                    metadata: Some(metadata.to_string()),
                });

                continue;
            }

            let (json_str, updated) = metadata.to_cached_str();

            if !updated {
                continue;
            }

            entity_updates.push(EntityProtocol {
                operation: EntityOperation::Update,
                id: id.0.to_owned(),
                r#type: etype.0.to_owned(),
                metadata: Some(json_str),
            });

            metadata.reset();
        }

        bookkeeping.entities = new_bookkeeping_records;

        if !entity_updates.is_empty() {
            queue.push((
                Message::new(&MessageType::Entity)
                    .entities(&entity_updates)
                    .build(),
                ClientFilter::All,
            ));
        }
    }
}
