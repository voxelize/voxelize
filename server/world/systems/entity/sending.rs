use hashbrown::{HashMap, HashSet};
use specs::{
    Entities, Entity, Join, LendJoin, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage,
};

use crate::{
    classify_interest, perf, world::system_profiler::WorldTimingContext, BackgroundEntitiesSaver,
    Bookkeeping, ClientFilter, Clients, DoNotPersistComp, ETypeComp, EntityFlag, EntityIDs,
    EntityOperation, EntityProtocol, IDComp, InteractorComp, InterestTransition, KdTree, Message,
    MessageQueues, MessageType, MetadataComp, Physics, PositionComp, ReplicatedStateBuffer, Stats,
    Vec3, VoxelComp, WorldConfig,
};

const BLOCK_ENTITY_PREFIX: &str = "block::";

#[derive(Default)]
pub struct EntitiesSendingSystem {
    updated_entities_buffer: Vec<(String, Entity)>,
    new_entity_ids_buffer: HashSet<String>,
}

impl<'a> System<'a> for EntitiesSendingSystem {
    type SystemData = (
        Entities<'a>,
        ReadExpect<'a, BackgroundEntitiesSaver>,
        ReadExpect<'a, KdTree>,
        ReadExpect<'a, Clients>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, WorldTimingContext>,
        ReadExpect<'a, Stats>,
        WriteExpect<'a, MessageQueues>,
        WriteExpect<'a, ReplicatedStateBuffer>,
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
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            entities,
            bg_saver,
            kdtree,
            clients,
            config,
            timing,
            stats,
            mut queue,
            mut replicated_state,
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
        ) = data;

        self.updated_entities_buffer.clear();
        self.new_entity_ids_buffer.clear();

        let visible_radius = config.entity_visible_radius;
        let release_radius = config.entity_release_radius;
        let keep_alive_interval = config.entity_keep_alive_interval;
        let tick = stats.tick;

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

        let mut deleted_entities: Vec<(String, String, String)> = Vec::new();

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

            deleted_entities.push((id.clone(), etype.clone(), metadata.clone()));
        }

        physics.entity_to_handlers = new_entity_handlers;

        for (id, _) in &self.updated_entities_buffer {
            if !old_ids.contains(id) {
                self.new_entity_ids_buffer.insert(id.to_owned());
            }
        }

        let mut new_bookkeeping_records = HashMap::new();
        let mut entity_positions: HashMap<String, Vec3<f32>> = HashMap::new();
        let mut changed_metadata_ids: HashSet<String> = HashSet::new();

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

            let pos = position
                .map(|p| p.0.clone())
                .or_else(|| voxel.map(|v| Vec3(v.0 .0 as f32, v.0 .1 as f32, v.0 .2 as f32)))
                .unwrap_or(Vec3(0.0, 0.0, 0.0));
            entity_positions.insert(id.0.clone(), pos);

            let is_new = self.new_entity_ids_buffer.contains(&id.0);
            let (json_str, updated) = metadata.to_cached_str();

            if is_new || updated {
                changed_metadata_ids.insert(id.0.clone());
            }

            new_bookkeeping_records.insert(
                id.0.to_owned(),
                (etype.0.to_owned(), ent, json_str, persisted),
            );
        }

        let mut client_updates: HashMap<String, Vec<EntityProtocol>> = HashMap::new();

        for (id, etype, metadata) in &deleted_entities {
            for client_id in clients.keys() {
                if bookkeeping.interests.untrack(client_id, id) {
                    client_updates
                        .entry(client_id.clone())
                        .or_default()
                        .push(EntityProtocol {
                            operation: EntityOperation::Delete,
                            id: id.clone(),
                            r#type: etype.clone(),
                            metadata: Some(metadata.clone()),
                        });
                }
            }
        }

        for (client_id, client) in clients.iter() {
            let client_pos = match positions.get(client.entity) {
                Some(p) => p.0.clone(),
                None => continue,
            };

            let updates = client_updates.entry(client_id.clone()).or_default();

            if let Some(tracked) = bookkeeping.interests.tracked_mut(client_id) {
                tracked.retain(|entity_id, last_sent_tick| {
                    let Some((etype, _, json_str, _)) = new_bookkeeping_records.get(entity_id)
                    else {
                        // Despawned ids were already untracked and notified, so
                        // a missing record means the entity has no streamable
                        // state left; release it on the client as well.
                        let old_etype = old_entities
                            .get(entity_id)
                            .map(|(etype, ..)| etype.clone())
                            .unwrap_or_default();
                        updates.push(EntityProtocol {
                            operation: EntityOperation::OutOfRange,
                            id: entity_id.clone(),
                            r#type: old_etype,
                            metadata: None,
                        });
                        return false;
                    };

                    // Block entities are chunk-bound: every client keeps them
                    // for as long as they exist, with change-driven updates.
                    if etype.starts_with(BLOCK_ENTITY_PREFIX) {
                        if changed_metadata_ids.contains(entity_id) {
                            updates.push(EntityProtocol {
                                operation: EntityOperation::Update,
                                id: entity_id.clone(),
                                r#type: etype.clone(),
                                metadata: Some(json_str.clone()),
                            });
                            *last_sent_tick = tick;
                        }
                        return true;
                    }

                    let distance_sq = entity_positions
                        .get(entity_id)
                        .map(|entity_pos| {
                            let dx = entity_pos.0 - client_pos.0;
                            let dy = entity_pos.1 - client_pos.1;
                            let dz = entity_pos.2 - client_pos.2;
                            dx * dx + dy * dy + dz * dz
                        })
                        .unwrap_or(f32::INFINITY);

                    match classify_interest(true, distance_sq, visible_radius, release_radius) {
                        InterestTransition::Leave => {
                            updates.push(EntityProtocol {
                                operation: EntityOperation::OutOfRange,
                                id: entity_id.clone(),
                                r#type: etype.clone(),
                                metadata: None,
                            });
                            false
                        }
                        _ => {
                            if changed_metadata_ids.contains(entity_id) {
                                updates.push(EntityProtocol {
                                    operation: EntityOperation::Update,
                                    id: entity_id.clone(),
                                    r#type: etype.clone(),
                                    metadata: Some(json_str.clone()),
                                });
                                *last_sent_tick = tick;
                            } else if tick.saturating_sub(*last_sent_tick) >= keep_alive_interval {
                                updates.push(EntityProtocol {
                                    operation: EntityOperation::Update,
                                    id: entity_id.clone(),
                                    r#type: etype.clone(),
                                    metadata: None,
                                });
                                *last_sent_tick = tick;
                            }
                            true
                        }
                    }
                });
            }

            for (_, ent) in kdtree.entities_within_radius(&client_pos, visible_radius) {
                let Some(id) = ids.get(*ent) else {
                    continue;
                };

                if bookkeeping.interests.is_tracked(client_id, &id.0) {
                    continue;
                }

                let Some((etype, _, json_str, _)) = new_bookkeeping_records.get(&id.0) else {
                    continue;
                };

                if etype.starts_with(BLOCK_ENTITY_PREFIX) {
                    continue;
                }

                client_updates
                    .entry(client_id.clone())
                    .or_default()
                    .push(EntityProtocol {
                        operation: EntityOperation::Create,
                        id: id.0.clone(),
                        r#type: etype.clone(),
                        metadata: Some(json_str.clone()),
                    });

                bookkeeping.interests.track(client_id, &id.0, tick);
            }
        }

        // Block entities created after a client joined stream to everyone the
        // moment they first produce metadata.
        for entity_id in &changed_metadata_ids {
            let Some((etype, _, json_str, _)) = new_bookkeeping_records.get(entity_id) else {
                continue;
            };

            if !etype.starts_with(BLOCK_ENTITY_PREFIX) {
                continue;
            }

            for client_id in clients.keys() {
                if bookkeeping.interests.is_tracked(client_id, entity_id) {
                    continue;
                }

                client_updates
                    .entry(client_id.clone())
                    .or_default()
                    .push(EntityProtocol {
                        operation: EntityOperation::Create,
                        id: entity_id.clone(),
                        r#type: etype.clone(),
                        metadata: Some(json_str.clone()),
                    });

                bookkeeping.interests.track(client_id, entity_id, tick);
            }
        }

        bookkeeping.entities = new_bookkeeping_records;
        bookkeeping.entity_positions = entity_positions;

        // Channel routing (see `world::replication`): lifecycle transitions
        // (CREATE / DELETE / OUT_OF_RANGE) are reliable EVENTS a client must
        // never miss — they go through the FIFO message queue. UPDATEs are
        // latest-wins STATE — they go into the per-client, per-entity slot
        // buffer, where a newer value overwrites an undelivered older one so
        // a backed-up client can never receive a replay of stale positions.
        for (client_id, updates) in client_updates {
            if updates.is_empty() {
                continue;
            }

            let (lifecycle, state_updates): (Vec<_>, Vec<_>) = updates
                .into_iter()
                .partition(|update| update.operation != EntityOperation::Update);

            if !lifecycle.is_empty() {
                for update in &lifecycle {
                    // A pending state slot staged before this transition must
                    // never be flushed after it (it would resurrect an entity
                    // the client just released or deleted).
                    replicated_state.clear_entity(&client_id, &update.id);
                }

                let mut message = Message::new(&MessageType::Entity).entities(&lifecycle);
                if perf::is_enabled() {
                    let trace_id =
                        log_entity_batch_queue(&timing.world_name, tick, &client_id, &lifecycle);
                    message = message
                        .json(&serde_json::json!({ "townPerfTraceId": trace_id }).to_string());
                }
                queue.push((message.build(), ClientFilter::Direct(client_id.clone())));
            }

            if !state_updates.is_empty() {
                if perf::is_enabled() {
                    let trace_id = log_entity_batch_queue(
                        &timing.world_name,
                        tick,
                        &client_id,
                        &state_updates,
                    );
                    replicated_state.note_trace_id(&client_id, trace_id);
                }
                for update in state_updates {
                    replicated_state.stage_entity_update(&client_id, update);
                }
            }
        }
    }
}

fn log_entity_batch_queue(
    world_name: &str,
    tick: u64,
    client_id: &str,
    updates: &[EntityProtocol],
) -> String {
    let trace_id = perf::next_trace_id("entity");
    let metadata_bytes = updates
        .iter()
        .map(|update| update.metadata.as_ref().map_or(0, String::len))
        .sum::<usize>();
    perf::log(
        "entity_batch_queue",
        world_name,
        serde_json::json!({
            "traceId": trace_id,
            "tick": tick,
            "clientId": client_id,
            "itemCount": updates.len(),
            "metadataBytes": metadata_bytes,
        }),
    );
    trace_id
}
