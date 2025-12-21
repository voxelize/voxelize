use hashbrown::{HashMap, HashSet};
use specs::{Entities, Entity, Join, LendJoin, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    Bookkeeping, ClientFilter, DoNotPersistComp, ETypeComp, EntitiesSaver, EntityFlag, EntityIDs,
    EntityOperation, EntityProtocol, IDComp, InteractorComp, Message, MessageQueue, MessageType,
    MetadataComp, Physics,
};

#[derive(Default)]
pub struct EntitiesSendingSystem {
    updated_entities_buffer: Vec<(String, Entity)>,
    entity_updates_buffer: Vec<EntityProtocol>,
    new_entity_ids_buffer: HashSet<String>,
}

impl<'a> System<'a> for EntitiesSendingSystem {
    type SystemData = (
        Entities<'a>,
        ReadExpect<'a, EntitiesSaver>,
        WriteExpect<'a, MessageQueue>,
        WriteExpect<'a, Bookkeeping>,
        WriteExpect<'a, Physics>,
        WriteExpect<'a, EntityIDs>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        ReadStorage<'a, InteractorComp>,
        ReadStorage<'a, DoNotPersistComp>,
        WriteStorage<'a, MetadataComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            entities,
            entities_saver,
            mut queue,
            mut bookkeeping,
            mut physics,
            mut entity_ids,
            flags,
            ids,
            etypes,
            interactors,
            do_not_persist,
            mut metadatas,
        ) = data;

        self.updated_entities_buffer.clear();
        self.entity_updates_buffer.clear();
        self.new_entity_ids_buffer.clear();

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

        let mut updated_ids: HashSet<&String> = HashSet::new();

        for (id, ent, _) in (&ids, &entities, &flags).join() {
            updated_ids.insert(&id.0);
            self.updated_entities_buffer.push((id.0.to_owned(), ent));
        }

        let old_entities = std::mem::take(&mut bookkeeping.entities);
        let old_ids: HashSet<&String> = old_entities.keys().collect();

        let old_entity_handlers = std::mem::take(&mut physics.entity_to_handlers);

        for (id, (etype, ent, metadata, persisted)) in old_entities.iter() {
            if updated_ids.contains(id) {
                continue;
            }

            if *persisted {
                entities_saver.remove(id);
            }
            entity_ids.remove(id);

            if let Some((collider_handle, body_handle)) = old_entity_handlers.get(ent) {
                physics.unregister(body_handle, collider_handle);
            }

            self.entity_updates_buffer.push(EntityProtocol {
                operation: EntityOperation::Delete,
                id: id.to_owned(),
                r#type: etype.to_owned(),
                metadata: Some(metadata.to_string()),
            });
        }

        physics.entity_to_handlers = new_entity_handlers;

        for (id, _) in &self.updated_entities_buffer {
            if !old_ids.contains(id) {
                self.new_entity_ids_buffer.insert(id.to_owned());
            }
        }

        let mut new_bookkeeping_records = HashMap::new();

        for (ent, id, metadata, etype, _, do_not_persist) in
            (&entities, &ids, &mut metadatas, &etypes, &flags, do_not_persist.maybe()).join()
        {
            if metadata.is_empty() {
                continue;
            }

            let persisted = do_not_persist.is_none();

            new_bookkeeping_records.insert(
                id.0.to_owned(),
                (etype.0.to_owned(), ent, metadata.to_owned(), persisted),
            );

            if self.new_entity_ids_buffer.contains(&id.0) {
                self.entity_updates_buffer.push(EntityProtocol {
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

            self.entity_updates_buffer.push(EntityProtocol {
                operation: EntityOperation::Update,
                id: id.0.to_owned(),
                r#type: etype.0.to_owned(),
                metadata: Some(json_str),
            });
        }

        bookkeeping.entities = new_bookkeeping_records;

        if !self.entity_updates_buffer.is_empty() {
            queue.push((
                Message::new(&MessageType::Entity)
                    .entities(&self.entity_updates_buffer)
                    .build(),
                ClientFilter::All,
            ));
        }
    }
}
