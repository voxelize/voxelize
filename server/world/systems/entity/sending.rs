use fnv::{FnvHashMap, FnvHashSet};
use hashbrown::HashMap;
use log::{info, trace};
use rayon::prelude::*;
use smallvec::{smallvec, SmallVec};
use specs::{Entities, Join, ParJoin, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

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

        let mut new_entity_handlers = HashMap::default();
        let mut updated_entities = Vec::with_capacity(flags.count());
        let mut new_entity_ids = FnvHashSet::default();
        let mut entity_updates: SmallVec<[EntityProtocol; 16]> = SmallVec::default();
        let mut new_bookkeeping_records = HashMap::default();

        // Collect new entity handlers
        for (ent, interactor) in (&entities, &interactors).join() {
            new_entity_handlers.insert(
                ent,
                (
                    interactor.collider_handle().clone(),
                    interactor.body_handle().clone(),
                ),
            );
        }

        // Collect updated entities
        updated_entities.extend(
            (&ids, &entities, &flags)
                .join()
                .map(|(id, ent, _)| (id.0.clone(), ent)),
        );

        let old_entities: Vec<_> = bookkeeping.entities.drain().collect();
        let old_entity_handlers = physics.entity_to_handlers.clone();

        // Process old entities
        let mut delete_updates = Vec::new();
        for (id, (etype, ent, metadata)) in old_entities.iter() {
            if !updated_entities.iter().any(|(new_id, _)| new_id == id) {
                entities_saver.remove(id);
                if let Some((collider_handle, body_handle)) = old_entity_handlers.get(ent) {
                    physics.unregister(body_handle, collider_handle);
                }
                delete_updates.push(EntityProtocol {
                    operation: EntityOperation::Delete,
                    id: id.clone(),
                    r#type: etype.clone(),
                    metadata: Some(metadata.to_string()),
                });
            }
        }
        entity_updates.extend(delete_updates);

        physics.entity_to_handlers = new_entity_handlers;

        // Identify new entities
        new_entity_ids.extend(
            updated_entities
                .iter()
                .filter(|(id, _)| !old_entities.iter().any(|(old_id, _)| old_id == id))
                .map(|(id, _)| id.clone()),
        );

        // Process updated entities
        let new_updates: Vec<_> = (&entities, &ids, &mut metadatas, &etypes, &flags)
            .join()
            .filter_map(|(ent, id, metadata, etype, _)| {
                if metadata.is_empty() {
                    return None;
                }
                new_bookkeeping_records
                    .insert(id.0.clone(), (etype.0.clone(), ent, metadata.clone()));

                if new_entity_ids.contains(&id.0) {
                    Some(EntityProtocol {
                        operation: EntityOperation::Create,
                        id: id.0.clone(),
                        r#type: etype.0.clone(),
                        metadata: Some(metadata.to_string()),
                    })
                } else {
                    let (json_str, updated) = metadata.to_cached_str();
                    if updated {
                        Some(EntityProtocol {
                            operation: EntityOperation::Update,
                            id: id.0.clone(),
                            r#type: etype.0.clone(),
                            metadata: Some(json_str),
                        })
                    } else {
                        None
                    }
                }
            })
            .collect();

        entity_updates.extend(new_updates);

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
