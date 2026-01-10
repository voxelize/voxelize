use hashbrown::{HashMap, HashSet};
use specs::{Entities, Entity, Join, LendJoin, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};

use crate::{
    world::system_profiler::WorldTimingContext, Bookkeeping, ClientFilter,
    Clients, DoNotPersistComp, ETypeComp, EntitiesSaver, EntityFlag, EntityIDs,
    EntityOperation, EntityProtocol, IDComp, InteractorComp, KdTree, Message, MessageQueues, MessageType,
    MetadataComp, Physics, PositionComp, Vec3, WorldConfig,
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
        ReadExpect<'a, KdTree>,
        ReadExpect<'a, Clients>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, MessageQueues>,
        WriteExpect<'a, Bookkeeping>,
        WriteExpect<'a, Physics>,
        WriteExpect<'a, EntityIDs>,
        ReadStorage<'a, EntityFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, ETypeComp>,
        ReadStorage<'a, InteractorComp>,
        ReadStorage<'a, DoNotPersistComp>,
        ReadStorage<'a, PositionComp>,
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            entities,
            entities_saver,
            kdtree,
            clients,
            config,
            mut queue,
            mut bookkeeping,
            mut physics,
            mut entity_ids,
            flags,
            ids,
            etypes,
            interactors,
            do_not_persist,
            positions,
            mut metadatas,
            timing,
        ) = data;
        let _t = timing.timer("entities-sending");

        self.updated_entities_buffer.clear();
        self.entity_updates_buffer.clear();
        self.new_entity_ids_buffer.clear();

        let entity_visible_radius =
            (config.max_chunks_per_tick as f32) * (config.chunk_size as f32);

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
        let _old_entity_positions = std::mem::take(&mut bookkeeping.entity_positions);

        let old_entity_handlers = std::mem::take(&mut physics.entity_to_handlers);

        let mut deleted_entities: Vec<(String, String, String)> = Vec::new();

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

            deleted_entities.push((id.clone(), etype.clone(), metadata.to_string()));
        }

        physics.entity_to_handlers = new_entity_handlers;

        for (id, _) in &self.updated_entities_buffer {
            if !old_ids.contains(id) {
                self.new_entity_ids_buffer.insert(id.to_owned());
            }
        }

        let mut new_bookkeeping_records = HashMap::new();
        let mut entity_positions: HashMap<String, Vec3<f32>> = HashMap::new();
        let mut entity_metadata_map: HashMap<String, (String, String, bool)> = HashMap::new();

        for (ent, id, metadata, etype, _, do_not_persist, position) in (
            &entities,
            &ids,
            &mut metadatas,
            &etypes,
            &flags,
            do_not_persist.maybe(),
            positions.maybe(),
        )
            .join()
        {
            if metadata.is_empty() {
                continue;
            }

            let persisted = do_not_persist.is_none();

            new_bookkeeping_records.insert(
                id.0.to_owned(),
                (etype.0.to_owned(), ent, metadata.to_owned(), persisted),
            );

            let pos = position.map(|p| p.0.clone()).unwrap_or(Vec3(0.0, 0.0, 0.0));
            entity_positions.insert(id.0.clone(), pos);

            let is_new = self.new_entity_ids_buffer.contains(&id.0);
            let (json_str, updated) = metadata.to_cached_str();

            if is_new || updated {
                entity_metadata_map.insert(id.0.clone(), (etype.0.clone(), json_str, is_new));
            }
        }

        let all_client_ids: Vec<String> = clients.keys().cloned().collect();

        let entity_to_client_id: HashMap<Entity, String> = clients
            .iter()
            .map(|(client_id, client)| (client.entity, client_id.clone()))
            .collect();

        let mut client_updates: HashMap<String, Vec<EntityProtocol>> = HashMap::new();

        for (entity_id, (etype, metadata_str, is_new)) in &entity_metadata_map {
            let pos = entity_positions.get(entity_id).cloned().unwrap_or(Vec3(0.0, 0.0, 0.0));
            let nearby_players = kdtree.players_within_radius(&pos, entity_visible_radius);

            for player_entity in nearby_players {
                let client_id = match entity_to_client_id.get(player_entity) {
                    Some(id) => id,
                    None => continue,
                };

                let client_known = bookkeeping
                    .client_known_entities
                    .get(client_id)
                    .map(|set| set.contains(entity_id))
                    .unwrap_or(false);

                let operation = if !client_known {
                    EntityOperation::Create
                } else if *is_new {
                    EntityOperation::Create
                } else {
                    EntityOperation::Update
                };

                client_updates
                    .entry(client_id.clone())
                    .or_default()
                    .push(EntityProtocol {
                        operation,
                        id: entity_id.clone(),
                        r#type: etype.clone(),
                        metadata: Some(metadata_str.clone()),
                    });

                bookkeeping
                    .client_known_entities
                    .entry(client_id.clone())
                    .or_default()
                    .insert(entity_id.clone());
            }
        }

        for (entity_id, etype, metadata_str) in &deleted_entities {
            for client_id in &all_client_ids {
                let client_knew = bookkeeping
                    .client_known_entities
                    .get(client_id)
                    .map(|set| set.contains(entity_id))
                    .unwrap_or(false);

                if client_knew {
                    client_updates
                        .entry(client_id.clone())
                        .or_default()
                        .push(EntityProtocol {
                            operation: EntityOperation::Delete,
                            id: entity_id.clone(),
                            r#type: etype.clone(),
                            metadata: Some(metadata_str.clone()),
                        });

                    if let Some(known) = bookkeeping.client_known_entities.get_mut(client_id) {
                        known.remove(entity_id);
                    }
                }
            }
        }

        for (client_id, client) in clients.iter() {
            let client_pos = match positions.get(client.entity) {
                Some(p) => p.0.clone(),
                None => continue,
            };

            if let Some(known_entities) = bookkeeping.client_known_entities.get_mut(client_id) {
                let entities_to_delete: Vec<String> = known_entities
                    .iter()
                    .filter(|entity_id| {
                        if let Some(entity_pos) = entity_positions.get(*entity_id) {
                            let dx = entity_pos.0 - client_pos.0;
                            let dy = entity_pos.1 - client_pos.1;
                            let dz = entity_pos.2 - client_pos.2;
                            let dist_sq = dx * dx + dy * dy + dz * dz;
                            dist_sq > entity_visible_radius * entity_visible_radius
                        } else {
                            true
                        }
                    })
                    .cloned()
                    .collect();

                for entity_id in entities_to_delete {
                    if let Some((etype, _ent, metadata, _persisted)) =
                        new_bookkeeping_records.get(&entity_id)
                    {
                        client_updates
                            .entry(client_id.clone())
                            .or_default()
                            .push(EntityProtocol {
                                operation: EntityOperation::Delete,
                                id: entity_id.clone(),
                                r#type: etype.clone(),
                                metadata: Some(metadata.to_string()),
                            });
                    }
                    known_entities.remove(&entity_id);
                }
            }
        }

        bookkeeping.entities = new_bookkeeping_records;
        bookkeeping.entity_positions = entity_positions;

        for (client_id, updates) in client_updates {
            if !updates.is_empty() {
                queue.push((
                    Message::new(&MessageType::Entity).entities(&updates).build(),
                    ClientFilter::Direct(client_id),
                ));
            }
        }
    }
}
