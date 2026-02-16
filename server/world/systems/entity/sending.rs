use hashbrown::{hash_map::RawEntryMut, HashMap, HashSet};
use specs::{
    Entities, Join, LendJoin, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage,
};

use crate::{
    world::system_profiler::WorldTimingContext, BackgroundEntitiesSaver, Bookkeeping, ClientFilter,
    Clients, DoNotPersistComp, ETypeComp, EntityFlag, EntityIDs, EntityOperation, EntityProtocol,
    IDComp, InteractorComp, KdTree, Message, MessageQueues, MessageType, MetadataComp, Physics,
    PositionComp, Vec3, VoxelComp, WorldConfig,
};

#[derive(Default)]
pub struct EntitiesSendingSystem {
    deleted_entities_buffer: Vec<(String, String, String)>,
    clients_with_updates_buffer: Vec<String>,
    client_updates_buffer: HashMap<String, Vec<EntityProtocol>>,
    metadata_json_cache_buffer: HashMap<String, String>,
    bookkeeping_records_buffer: HashMap<String, (String, specs::Entity, MetadataComp, bool)>,
}

#[inline]
fn normalized_visible_radius(radius: f32) -> (f32, f32) {
    if radius.is_nan() {
        return (f32::MAX, f32::MAX);
    }
    if radius < 0.0 {
        return (0.0, 0.0);
    }
    if !radius.is_finite() {
        return (f32::MAX, f32::MAX);
    }
    let radius_sq = f64::from(radius) * f64::from(radius);
    if !radius_sq.is_finite() || radius_sq > f64::from(f32::MAX) {
        return (radius, f32::MAX);
    }
    (radius, radius_sq as f32)
}

#[inline]
fn is_outside_visible_radius_sq(dx: f32, dy: f32, dz: f32, radius_sq: f32) -> bool {
    let dist_sq = dx * dx + dy * dy + dz * dz;
    !dist_sq.is_finite() || dist_sq > radius_sq
}

#[inline]
fn push_client_update(
    client_updates: &mut HashMap<String, Vec<EntityProtocol>>,
    touched_clients: &mut Vec<String>,
    client_id: &str,
    update: EntityProtocol,
) {
    match client_updates.raw_entry_mut().from_key(client_id) {
        RawEntryMut::Occupied(mut entry) => {
            let updates = entry.get_mut();
            if updates.is_empty() {
                touched_clients.push(client_id.to_owned());
            }
            updates.push(update);
        }
        RawEntryMut::Vacant(entry) => {
            touched_clients.push(client_id.to_owned());
            let mut updates = Vec::with_capacity(1);
            updates.push(update);
            entry.insert(client_id.to_owned(), updates);
        }
    }
}

#[inline]
fn get_or_insert_client_known_entities<'a>(
    client_known_entities: &'a mut HashMap<String, HashSet<String>>,
    client_id: &str,
) -> &'a mut HashSet<String> {
    match client_known_entities.raw_entry_mut().from_key(client_id) {
        RawEntryMut::Occupied(entry) => entry.into_mut(),
        RawEntryMut::Vacant(entry) => {
            entry
                .insert(client_id.to_owned(), HashSet::with_capacity(8))
                .1
        }
    }
}

#[inline]
fn get_or_cache_metadata_json(
    metadata_json_cache: &mut HashMap<String, String>,
    entity_id: &str,
    metadata: &MetadataComp,
) -> String {
    match metadata_json_cache.raw_entry_mut().from_key(entity_id) {
        RawEntryMut::Occupied(entry) => entry.get().clone(),
        RawEntryMut::Vacant(entry) => {
            let (_, cached_metadata_json) =
                entry.insert(entity_id.to_owned(), metadata.to_string());
            cached_metadata_json.clone()
        }
    }
}

impl<'a> System<'a> for EntitiesSendingSystem {
    type SystemData = (
        Entities<'a>,
        ReadExpect<'a, BackgroundEntitiesSaver>,
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
        ReadStorage<'a, VoxelComp>,
        WriteStorage<'a, MetadataComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            entities,
            bg_saver,
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
            voxels,
            mut metadatas,
            timing,
        ) = data;
        let _t = timing.timer("entities-sending");

        self.deleted_entities_buffer.clear();
        self.clients_with_updates_buffer.clear();
        self.metadata_json_cache_buffer.clear();
        if clients.is_empty() {
            self.client_updates_buffer.clear();
        } else if self.client_updates_buffer.len() > clients.len() {
            self.client_updates_buffer
                .retain(|client_id, _| clients.contains_key(client_id));
        }

        let (entity_visible_radius, entity_visible_radius_sq) =
            normalized_visible_radius(config.entity_visible_radius);

        let mut old_entity_handlers = std::mem::take(&mut physics.entity_to_handlers);
        let mut new_entity_handlers = HashMap::with_capacity(old_entity_handlers.len());

        for (ent, interactor) in (&entities, &interactors).join() {
            new_entity_handlers.insert(
                ent,
                (
                    *interactor.collider_handle(),
                    *interactor.body_handle(),
                ),
            );
        }

        let mut old_entities = std::mem::take(&mut bookkeeping.entities);
        let mut new_bookkeeping_records = std::mem::take(&mut self.bookkeeping_records_buffer);
        new_bookkeeping_records.clear();
        if new_bookkeeping_records.capacity() < old_entities.len() {
            new_bookkeeping_records
                .reserve(old_entities.len() - new_bookkeeping_records.len());
        }
        let mut entity_positions = std::mem::take(&mut bookkeeping.entity_positions);
        entity_positions.clear();
        if entity_positions.capacity() < old_entities.len() {
            entity_positions.reserve(old_entities.len() - entity_positions.len());
        }
        let has_clients = !clients.is_empty();
        let entity_metadata_initial_capacity = old_entities.len().min(64);
        let mut entity_metadata_map: Option<HashMap<&str, (&str, String, bool)>> = None;

        for (ent, id, metadata, etype, _, do_not_persist, position, voxel) in (
            &entities,
            &ids,
            &mut metadatas,
            &etypes,
            &flags,
            do_not_persist.maybe(),
            positions.maybe(),
            voxels.maybe(),
        )
            .join()
        {
            let is_new = old_entities.remove(&id.0).is_none();
            if metadata.is_empty() {
                continue;
            }

            let persisted = do_not_persist.is_none();

            new_bookkeeping_records.insert(
                id.0.to_owned(),
                (etype.0.to_owned(), ent, metadata.to_owned(), persisted),
            );

            let pos = if let Some(position) = position {
                position.0
            } else if let Some(voxel) = voxel {
                Vec3(voxel.0 .0 as f32, voxel.0 .1 as f32, voxel.0 .2 as f32)
            } else {
                Vec3(0.0, 0.0, 0.0)
            };
            entity_positions.insert(id.0.clone(), pos);

            if has_clients {
                if is_new {
                    let json_str = metadata.to_cached_str_for_new_record();
                    entity_metadata_map
                        .get_or_insert_with(|| HashMap::with_capacity(entity_metadata_initial_capacity))
                        .insert(id.0.as_str(), (etype.0.as_str(), json_str, true));
                } else if let Some(json_str) = metadata.to_cached_str_if_updated() {
                    entity_metadata_map
                        .get_or_insert_with(|| HashMap::with_capacity(entity_metadata_initial_capacity))
                        .insert(id.0.as_str(), (etype.0.as_str(), json_str, false));
                }
            }
        }

        if has_clients {
            self.deleted_entities_buffer.reserve(old_entities.len());
        }
        for (id, (etype, ent, mut metadata, persisted)) in old_entities.drain() {
            if persisted {
                bg_saver.remove(&id);
            }
            entity_ids.remove(&id);

            if let Some((collider_handle, body_handle)) = old_entity_handlers.remove(&ent) {
                physics.unregister(&body_handle, &collider_handle);
            }

            if has_clients {
                let metadata_json = metadata.to_cached_str_for_new_record();
                self.deleted_entities_buffer.push((id, etype, metadata_json));
            }
        }
        physics.entity_to_handlers = new_entity_handlers;

        if !has_clients {
            bookkeeping.client_known_entities.clear();
            bookkeeping.entities = new_bookkeeping_records;
            self.bookkeeping_records_buffer = old_entities;
            bookkeeping.entity_positions = entity_positions;
            return;
        }
        let has_entity_metadata_updates = entity_metadata_map
            .as_ref()
            .map_or(false, |metadata_map| !metadata_map.is_empty());
        if !has_entity_metadata_updates && self.deleted_entities_buffer.is_empty() {
            let mut has_known_entities = false;
            for known_entities in bookkeeping.client_known_entities.values() {
                if !known_entities.is_empty() {
                    has_known_entities = true;
                    break;
                }
            }
            if !has_known_entities {
                bookkeeping.entities = new_bookkeeping_records;
                self.bookkeeping_records_buffer = old_entities;
                bookkeeping.entity_positions = entity_positions;
                return;
            }
        }
        self.clients_with_updates_buffer.reserve(clients.len());
        let single_client = if clients.len() == 1 {
            if let Some((client_id, client)) = clients.iter().next() {
                Some((client_id.as_str(), client.entity))
            } else {
                None
            }
        } else {
            None
        };
        let single_client_position = if let Some((_, client_entity)) = single_client {
            positions.get(client_entity).map(|position| position.0)
        } else {
            None
        };

        let mut entity_to_client_id: HashMap<u32, &str> = HashMap::new();
        if single_client.is_none() && has_entity_metadata_updates {
            entity_to_client_id.reserve(clients.len());
            for (client_id, client) in clients.iter() {
                entity_to_client_id.insert(client.entity.id(), client_id.as_str());
            }
        }

        let default_pos = Vec3(0.0, 0.0, 0.0);

        if let Some(entity_metadata_map) = entity_metadata_map.as_ref() {
            for (entity_id, (etype, metadata_str, is_new)) in entity_metadata_map {
                let entity_id = *entity_id;
                let pos = entity_positions.get(entity_id).unwrap_or(&default_pos);
                if let Some((single_client_id, _)) = single_client {
                    let Some(client_pos) = single_client_position else {
                        continue;
                    };
                    let dx = pos.0 - client_pos.0;
                    let dy = pos.1 - client_pos.1;
                    let dz = pos.2 - client_pos.2;
                    if is_outside_visible_radius_sq(dx, dy, dz, entity_visible_radius_sq) {
                        continue;
                    }
                    let known_entities = get_or_insert_client_known_entities(
                        &mut bookkeeping.client_known_entities,
                        single_client_id,
                    );
                    let client_known = known_entities.contains(entity_id);
                    let entity_id_owned = entity_id.to_owned();
                    if !client_known {
                        known_entities.insert(entity_id_owned.clone());
                    }
                    let operation = if !client_known || *is_new {
                        EntityOperation::Create
                    } else {
                        EntityOperation::Update
                    };
                    push_client_update(
                        &mut self.client_updates_buffer,
                        &mut self.clients_with_updates_buffer,
                        single_client_id,
                        EntityProtocol {
                            operation,
                            id: entity_id_owned,
                            r#type: (*etype).to_owned(),
                            metadata: Some(metadata_str.clone()),
                        },
                    );
                    continue;
                }
                kdtree.for_each_player_id_within_radius(pos, entity_visible_radius, |player_entity_id| {
                    if let Some(client_id) = entity_to_client_id.get(&player_entity_id) {
                        let client_id = *client_id;
                        let known_entities = get_or_insert_client_known_entities(
                            &mut bookkeeping.client_known_entities,
                            client_id,
                        );
                        let client_known = known_entities.contains(entity_id);
                        let entity_id_owned = entity_id.to_owned();
                        if !client_known {
                            known_entities.insert(entity_id_owned.clone());
                        }
                        let operation = if !client_known || *is_new {
                            EntityOperation::Create
                        } else {
                            EntityOperation::Update
                        };

                        push_client_update(
                            &mut self.client_updates_buffer,
                            &mut self.clients_with_updates_buffer,
                            client_id,
                            EntityProtocol {
                                operation,
                                id: entity_id_owned,
                                r#type: (*etype).to_owned(),
                                metadata: Some(metadata_str.clone()),
                            },
                        );
                    }
                });
            }
        }

        if !self.deleted_entities_buffer.is_empty() {
            let deleted_entities_count = self.deleted_entities_buffer.len();
            if let Some((single_client_id, _)) = single_client {
                if let Some(known_entities) =
                    bookkeeping.client_known_entities.get_mut(single_client_id)
                {
                    if !known_entities.is_empty() {
                        for (deleted_entity_id, etype, metadata_str) in
                            self.deleted_entities_buffer.drain(..)
                        {
                            if !known_entities.remove(&deleted_entity_id) {
                                continue;
                            }
                            push_client_update(
                                &mut self.client_updates_buffer,
                                &mut self.clients_with_updates_buffer,
                                single_client_id,
                                EntityProtocol {
                                    operation: EntityOperation::Delete,
                                    id: deleted_entity_id,
                                    r#type: etype,
                                    metadata: Some(metadata_str),
                                },
                            );
                        }
                    } else {
                        self.deleted_entities_buffer.clear();
                    }
                } else {
                    self.deleted_entities_buffer.clear();
                }
            } else if self.deleted_entities_buffer.len() == 1 {
                let (entity_id, etype, metadata_str) = &self.deleted_entities_buffer[0];
                for client_id in clients.keys() {
                    let client_id = client_id.as_str();
                    let Some(known_entities) =
                        bookkeeping.client_known_entities.get_mut(client_id)
                    else {
                        continue;
                    };
                    if known_entities.is_empty() {
                        continue;
                    }
                    if !known_entities.remove(entity_id) {
                        continue;
                    }
                    push_client_update(
                        &mut self.client_updates_buffer,
                        &mut self.clients_with_updates_buffer,
                        client_id,
                        EntityProtocol {
                            operation: EntityOperation::Delete,
                            id: entity_id.clone(),
                            r#type: etype.clone(),
                            metadata: Some(metadata_str.clone()),
                        },
                    );
                }
            } else if deleted_entities_count <= 4 {
                for client_id in clients.keys() {
                    let client_id = client_id.as_str();
                    let Some(known_entities) =
                        bookkeeping.client_known_entities.get_mut(client_id)
                    else {
                        continue;
                    };
                    if known_entities.is_empty() {
                        continue;
                    }
                    for (deleted_entity_id, etype, metadata_str) in &self.deleted_entities_buffer {
                        if !known_entities.remove(deleted_entity_id) {
                            continue;
                        }
                        push_client_update(
                            &mut self.client_updates_buffer,
                            &mut self.clients_with_updates_buffer,
                            client_id,
                            EntityProtocol {
                                operation: EntityOperation::Delete,
                                id: deleted_entity_id.clone(),
                                r#type: etype.clone(),
                                metadata: Some(metadata_str.clone()),
                            },
                        );
                    }
                }
            } else {
                let mut deleted_entities_lookup: Option<HashMap<&str, (&String, &String)>> = None;

                for client_id in clients.keys() {
                    let client_id = client_id.as_str();
                    let Some(known_entities) =
                        bookkeeping.client_known_entities.get_mut(client_id)
                    else {
                        continue;
                    };
                    if known_entities.is_empty() {
                        continue;
                    }
                    if deleted_entities_count < known_entities.len() {
                        for (deleted_entity_id, etype, metadata_str) in &self.deleted_entities_buffer
                        {
                            if !known_entities.remove(deleted_entity_id) {
                                continue;
                            }
                            push_client_update(
                                &mut self.client_updates_buffer,
                                &mut self.clients_with_updates_buffer,
                                client_id,
                                EntityProtocol {
                                    operation: EntityOperation::Delete,
                                    id: deleted_entity_id.clone(),
                                    r#type: etype.clone(),
                                    metadata: Some(metadata_str.clone()),
                                },
                            );
                        }
                        continue;
                    }
                    let deleted_entities_lookup = deleted_entities_lookup.get_or_insert_with(|| {
                        let mut lookup = HashMap::with_capacity(deleted_entities_count);
                        for (entity_id, etype, metadata_str) in &self.deleted_entities_buffer {
                            lookup.insert(entity_id.as_str(), (etype, metadata_str));
                        }
                        lookup
                    });
                    known_entities.retain(|entity_id| {
                        let Some((etype, metadata_str)) =
                            deleted_entities_lookup.get(entity_id.as_str())
                        else {
                            return true;
                        };
                        push_client_update(
                            &mut self.client_updates_buffer,
                            &mut self.clients_with_updates_buffer,
                            client_id,
                            EntityProtocol {
                                operation: EntityOperation::Delete,
                                id: entity_id.clone(),
                                r#type: (*etype).clone(),
                                metadata: Some((*metadata_str).clone()),
                            },
                        );
                        false
                    });
                }
            }
        }

        if let Some((single_client_id, _)) = single_client {
            if let Some(client_pos) = single_client_position {
                let (client_x, client_y, client_z) = (client_pos.0, client_pos.1, client_pos.2);
                if let Some(known_entities) = bookkeeping.client_known_entities.get_mut(single_client_id)
                {
                    if !known_entities.is_empty() {
                        known_entities.retain(|entity_id| {
                            let record = new_bookkeeping_records.get(entity_id);
                            if let Some((etype, ..)) = record {
                                if etype.starts_with("block::") {
                                    return true;
                                }
                            }
                            let should_delete = if let Some(entity_pos) =
                                entity_positions.get(entity_id)
                            {
                                let dx = entity_pos.0 - client_x;
                                let dy = entity_pos.1 - client_y;
                                let dz = entity_pos.2 - client_z;
                                is_outside_visible_radius_sq(dx, dy, dz, entity_visible_radius_sq)
                            } else {
                                true
                            };

                            if !should_delete {
                                return true;
                            }
                            if let Some((etype, _ent, metadata, _persisted)) = record {
                                let metadata_json = get_or_cache_metadata_json(
                                    &mut self.metadata_json_cache_buffer,
                                    entity_id,
                                    metadata,
                                );
                                push_client_update(
                                    &mut self.client_updates_buffer,
                                    &mut self.clients_with_updates_buffer,
                                    single_client_id,
                                    EntityProtocol {
                                        operation: EntityOperation::Delete,
                                        id: entity_id.clone(),
                                        r#type: etype.clone(),
                                        metadata: Some(metadata_json),
                                    },
                                );
                            }
                            false
                        });
                    }
                }
            }
        } else {
            for (client_id, client) in clients.iter() {
                let (client_x, client_y, client_z) = match positions.get(client.entity) {
                    Some(p) => (p.0 .0, p.0 .1, p.0 .2),
                    None => continue,
                };

                let Some(known_entities) = bookkeeping.client_known_entities.get_mut(client_id)
                else {
                    continue;
                };
                if known_entities.is_empty() {
                    continue;
                }
                known_entities.retain(|entity_id| {
                    let record = new_bookkeeping_records.get(entity_id);
                    if let Some((etype, ..)) = record {
                        if etype.starts_with("block::") {
                            return true;
                        }
                    }
                    let should_delete = if let Some(entity_pos) = entity_positions.get(entity_id) {
                        let dx = entity_pos.0 - client_x;
                        let dy = entity_pos.1 - client_y;
                        let dz = entity_pos.2 - client_z;
                        is_outside_visible_radius_sq(dx, dy, dz, entity_visible_radius_sq)
                    } else {
                        true
                    };

                    if !should_delete {
                        return true;
                    }
                    if let Some((etype, _ent, metadata, _persisted)) = record {
                        let metadata_json = get_or_cache_metadata_json(
                            &mut self.metadata_json_cache_buffer,
                            entity_id,
                            metadata,
                        );
                        push_client_update(
                            &mut self.client_updates_buffer,
                            &mut self.clients_with_updates_buffer,
                            client_id,
                            EntityProtocol {
                                operation: EntityOperation::Delete,
                                id: entity_id.clone(),
                                r#type: etype.clone(),
                                metadata: Some(metadata_json),
                            },
                        );
                    }
                    false
                });
            }
        }

        bookkeeping.entities = new_bookkeeping_records;
        self.bookkeeping_records_buffer = old_entities;
        bookkeeping.entity_positions = entity_positions;

        for client_id in self.clients_with_updates_buffer.drain(..) {
            let updates = match self.client_updates_buffer.get_mut(&client_id) {
                Some(updates) => updates,
                None => continue,
            };
            if updates.is_empty() {
                continue;
            }
            let next_update_capacity = updates.capacity();
            let updates_to_send = std::mem::replace(updates, Vec::with_capacity(next_update_capacity));
            queue.push((
                Message::new(&MessageType::Entity)
                    .entities_owned(updates_to_send)
                    .build(),
                ClientFilter::Direct(client_id),
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{is_outside_visible_radius_sq, normalized_visible_radius};

    #[test]
    fn normalized_visible_radius_handles_invalid_values() {
        assert_eq!(normalized_visible_radius(-1.0), (0.0, 0.0));
        assert_eq!(
            normalized_visible_radius(f32::INFINITY),
            (f32::MAX, f32::MAX)
        );
        assert_eq!(
            normalized_visible_radius(f32::NAN),
            (f32::MAX, f32::MAX)
        );
    }

    #[test]
    fn normalized_visible_radius_clamps_squared_radius() {
        assert_eq!(normalized_visible_radius(5.0), (5.0, 25.0));
        assert_eq!(
            normalized_visible_radius(f32::MAX),
            (f32::MAX, f32::MAX)
        );
    }

    #[test]
    fn is_outside_visible_radius_sq_rejects_non_finite_distance() {
        assert!(!is_outside_visible_radius_sq(1.0, 2.0, 2.0, 9.0));
        assert!(is_outside_visible_radius_sq(4.0, 0.0, 0.0, 9.0));
        assert!(is_outside_visible_radius_sq(f32::NAN, 0.0, 0.0, 9.0));
    }
}
