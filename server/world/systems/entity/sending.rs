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
    known_entities_to_delete_buffer: Vec<String>,
    clients_with_updates_buffer: Vec<String>,
    client_updates_buffer: HashMap<String, Vec<EntityProtocol>>,
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
        self.known_entities_to_delete_buffer.clear();
        self.clients_with_updates_buffer.clear();
        if clients.is_empty() {
            self.client_updates_buffer.clear();
        } else if self.client_updates_buffer.len() > clients.len() {
            self.client_updates_buffer
                .retain(|client_id, _| clients.contains_key(client_id));
        }

        let (entity_visible_radius, entity_visible_radius_sq) =
            normalized_visible_radius(config.entity_visible_radius);

        let old_entity_handlers = std::mem::take(&mut physics.entity_to_handlers);
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
        let mut new_bookkeeping_records = HashMap::with_capacity(old_entities.len());
        let mut entity_positions: HashMap<String, Vec3<f32>> = HashMap::with_capacity(old_entities.len());
        let has_clients = !clients.is_empty();
        let mut entity_metadata_map: HashMap<String, (&str, String, bool)> = if has_clients {
            HashMap::with_capacity(old_entities.len())
        } else {
            HashMap::new()
        };

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

            let pos = position
                .map(|p| p.0)
                .or_else(|| voxel.map(|v| Vec3(v.0 .0 as f32, v.0 .1 as f32, v.0 .2 as f32)))
                .unwrap_or(Vec3(0.0, 0.0, 0.0));
            entity_positions.insert(id.0.clone(), pos);

            if has_clients {
                let (json_str, updated) = metadata.to_cached_str();
                if is_new || updated {
                    entity_metadata_map.insert(id.0.clone(), (etype.0.as_str(), json_str, is_new));
                }
            }
        }

        if has_clients {
            self.deleted_entities_buffer.reserve(old_entities.len());
        }
        for (id, (etype, ent, metadata, persisted)) in old_entities.into_iter() {
            if persisted {
                bg_saver.remove(&id);
            }
            entity_ids.remove(&id);

            if let Some((collider_handle, body_handle)) = old_entity_handlers.get(&ent) {
                physics.unregister(body_handle, collider_handle);
            }

            if has_clients {
                self.deleted_entities_buffer
                    .push((id, etype, metadata.to_string()));
            }
        }
        physics.entity_to_handlers = new_entity_handlers;

        if !has_clients {
            bookkeeping.client_known_entities.clear();
            bookkeeping.entities = new_bookkeeping_records;
            bookkeeping.entity_positions = entity_positions;
            return;
        }
        self.clients_with_updates_buffer.reserve(clients.len());

        let mut entity_to_client_id: HashMap<u32, &str> = HashMap::new();
        if !entity_metadata_map.is_empty() {
            entity_to_client_id.reserve(clients.len());
            for (client_id, client) in clients.iter() {
                entity_to_client_id.insert(client.entity.id(), client_id.as_str());
            }
        }

        let default_pos = Vec3(0.0, 0.0, 0.0);

        for (entity_id, (etype, metadata_str, is_new)) in &entity_metadata_map {
            let pos = entity_positions.get(entity_id).unwrap_or(&default_pos);
            kdtree.for_each_player_id_within_radius(pos, entity_visible_radius, |player_entity_id| {
                if let Some(client_id) = entity_to_client_id.get(&player_entity_id) {
                    let client_id = *client_id;
                    let known_entities = get_or_insert_client_known_entities(
                        &mut bookkeeping.client_known_entities,
                        client_id,
                    );
                    let inserted = known_entities.insert(entity_id.clone());

                    let operation = if inserted || *is_new {
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
                            id: entity_id.clone(),
                            r#type: (*etype).to_owned(),
                            metadata: Some(metadata_str.clone()),
                        },
                    );
                }
            });
        }

        if !self.deleted_entities_buffer.is_empty() {
            if self.deleted_entities_buffer.len() == 1 {
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
            } else if self.deleted_entities_buffer.len() <= 4 {
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
                let mut deleted_entities_lookup: HashMap<&str, (&String, &String)> =
                    HashMap::with_capacity(self.deleted_entities_buffer.len());
                for (entity_id, etype, metadata_str) in &self.deleted_entities_buffer {
                    deleted_entities_lookup.insert(entity_id.as_str(), (etype, metadata_str));
                }

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
                    if self.deleted_entities_buffer.len() < known_entities.len() {
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
                    let entities_to_delete = &mut self.known_entities_to_delete_buffer;
                    entities_to_delete.clear();
                    if entities_to_delete.capacity() < known_entities.len() {
                        entities_to_delete
                            .reserve(known_entities.len() - entities_to_delete.capacity());
                    }

                    for entity_id in known_entities.iter() {
                        let Some((etype, metadata_str)) =
                            deleted_entities_lookup.get(entity_id.as_str())
                        else {
                            continue;
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
                        entities_to_delete.push(entity_id.clone());
                    }

                    for entity_id in entities_to_delete.iter() {
                        known_entities.remove(entity_id);
                    }
                }
            }
        }

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
            let entities_to_delete = &mut self.known_entities_to_delete_buffer;
            entities_to_delete.clear();
            if entities_to_delete.capacity() < known_entities.len() {
                entities_to_delete.reserve(known_entities.len() - entities_to_delete.capacity());
            }
            for entity_id in known_entities.iter() {
                if let Some((etype, ..)) = new_bookkeeping_records.get(entity_id) {
                    if etype.starts_with("block::") {
                        continue;
                    }
                }
                if let Some(entity_pos) = entity_positions.get(entity_id) {
                    let dx = entity_pos.0 - client_x;
                    let dy = entity_pos.1 - client_y;
                    let dz = entity_pos.2 - client_z;
                    if is_outside_visible_radius_sq(dx, dy, dz, entity_visible_radius_sq) {
                        entities_to_delete.push(entity_id.clone());
                    }
                } else {
                    entities_to_delete.push(entity_id.clone());
                }
            }

            for entity_id in entities_to_delete.iter() {
                if let Some((etype, _ent, metadata, _persisted)) =
                    new_bookkeeping_records.get(entity_id)
                {
                    push_client_update(
                        &mut self.client_updates_buffer,
                        &mut self.clients_with_updates_buffer,
                        client_id,
                        EntityProtocol {
                            operation: EntityOperation::Delete,
                            id: entity_id.clone(),
                            r#type: etype.clone(),
                            metadata: Some(metadata.to_string()),
                        },
                    );
                }
                known_entities.remove(entity_id);
            }
        }

        bookkeeping.entities = new_bookkeeping_records;
        bookkeeping.entity_positions = entity_positions;

        for client_id in self.clients_with_updates_buffer.drain(..) {
            let updates = match self.client_updates_buffer.get_mut(&client_id) {
                Some(updates) => updates,
                None => continue,
            };
            if updates.is_empty() {
                continue;
            }
            queue.push((
                Message::new(&MessageType::Entity)
                    .entities(&updates)
                    .build(),
                ClientFilter::Direct(client_id),
            ));
            updates.clear();
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
