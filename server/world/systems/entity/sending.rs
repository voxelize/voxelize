use hashbrown::{HashMap, HashSet};
use specs::{
    Entities, Entity, Join, LendJoin, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage,
};

use crate::{
    world::system_profiler::WorldTimingContext, BackgroundEntitiesSaver, Bookkeeping, ClientFilter,
    Clients, DoNotPersistComp, ETypeComp, EntityFlag, EntityIDs, EntityOperation, EntityProtocol,
    IDComp, InteractorComp, KdTree, Message, MessageQueues, MessageType, MetadataComp, Physics,
    PositionComp, Vec3, VoxelComp, WorldConfig,
};

#[derive(Default)]
pub struct EntitiesSendingSystem {
    updated_entities_buffer: Vec<(String, Entity)>,
    new_entity_ids_buffer: HashSet<String>,
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

        self.updated_entities_buffer.clear();
        self.new_entity_ids_buffer.clear();

        let (entity_visible_radius, entity_visible_radius_sq) =
            normalized_visible_radius(config.entity_visible_radius);

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

        let mut deleted_entities: Vec<(String, String, String)> =
            Vec::with_capacity(old_entities.len());

        for (id, (etype, ent, metadata, persisted)) in old_entities.iter() {
            if updated_ids.contains(id) {
                continue;
            }

            if *persisted {
                bg_saver.remove(id);
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

        let mut new_bookkeeping_records =
            HashMap::with_capacity(self.updated_entities_buffer.len());
        let mut entity_positions: HashMap<String, Vec3<f32>> =
            HashMap::with_capacity(self.updated_entities_buffer.len());
        let mut entity_metadata_map: HashMap<String, (String, String, bool)> =
            HashMap::with_capacity(self.updated_entities_buffer.len());

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
            if metadata.is_empty() {
                continue;
            }

            let persisted = do_not_persist.is_none();

            new_bookkeeping_records.insert(
                id.0.to_owned(),
                (etype.0.to_owned(), ent, metadata.to_owned(), persisted),
            );

            let pos = position
                .map(|p| p.0.clone())
                .or_else(|| voxel.map(|v| Vec3(v.0 .0 as f32, v.0 .1 as f32, v.0 .2 as f32)))
                .unwrap_or(Vec3(0.0, 0.0, 0.0));
            entity_positions.insert(id.0.clone(), pos);

            let is_new = self.new_entity_ids_buffer.contains(&id.0);
            let (json_str, updated) = metadata.to_cached_str();

            if is_new || updated {
                entity_metadata_map.insert(id.0.clone(), (etype.0.clone(), json_str, is_new));
            }
        }

        let mut entity_to_client_id: HashMap<Entity, String> =
            HashMap::with_capacity(clients.len());
        for (client_id, client) in clients.iter() {
            entity_to_client_id.insert(client.entity, client_id.clone());
        }

        let mut client_updates: HashMap<String, Vec<EntityProtocol>> =
            HashMap::with_capacity(clients.len());
        let default_pos = Vec3(0.0, 0.0, 0.0);

        for (entity_id, (etype, metadata_str, is_new)) in &entity_metadata_map {
            let pos = entity_positions.get(entity_id).unwrap_or(&default_pos);
            let nearby_players = kdtree.players_within_radius(pos, entity_visible_radius);

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
            for client_id in clients.keys() {
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
            let (client_x, client_y, client_z) = match positions.get(client.entity) {
                Some(p) => (p.0 .0, p.0 .1, p.0 .2),
                None => continue,
            };

            if let Some(known_entities) = bookkeeping.client_known_entities.get_mut(client_id) {
                let entities_to_delete: Vec<String> = known_entities
                    .iter()
                    .filter(|entity_id| {
                        if let Some((etype, ..)) = new_bookkeeping_records.get(*entity_id) {
                            if etype.starts_with("block::") {
                                return false;
                            }
                        }
                        if let Some(entity_pos) = entity_positions.get(*entity_id) {
                            let dx = entity_pos.0 - client_x;
                            let dy = entity_pos.1 - client_y;
                            let dz = entity_pos.2 - client_z;
                            is_outside_visible_radius_sq(dx, dy, dz, entity_visible_radius_sq)
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
                    Message::new(&MessageType::Entity)
                        .entities(&updates)
                        .build(),
                    ClientFilter::Direct(client_id),
                ));
            }
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
