use hashbrown::{HashMap, HashSet};
use specs::{
    Entities, Entity, Join, LendJoin, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage,
};

use crate::{
    classify_interest, perf, world::system_profiler::WorldTimingContext, BackgroundEntitiesSaver,
    Bookkeeping, ClientFilter, Clients, DoNotPersistComp, ETypeComp, EntityFlag, EntityIDs,
    EntityOperation, EntityProtocol, IDComp, InteractorComp, InterestTransition, KdTree, Message,
    MessageQueues, MessageType, MetadataComp, Physics, PositionComp, Stats, Vec3, VoxelComp,
    WorldConfig,
};

const BLOCK_ENTITY_PREFIX: &str = "block::";

#[derive(Default)]
pub struct EntitiesSendingSystem {
    updated_entities_buffer: Vec<(String, Entity)>,
    new_entity_ids_buffer: HashSet<String>,
}

#[derive(Default)]
struct ClientEntityUpdates {
    critical: Vec<EntityProtocol>,
    streaming: Vec<EntityProtocol>,
}

struct PendingEntityUpdate {
    id: String,
    distance_sq: f32,
    revision: u64,
    last_sent_tick: u64,
    is_full_rate: bool,
    is_keep_alive: bool,
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
        let full_rate_radius_sq = config.entity_full_rate_radius * config.entity_full_rate_radius;
        let far_update_interval = config.entity_far_update_interval;
        let stream_interval = config.entity_stream_interval;
        let max_updates_per_tick = config.max_entity_updates_per_tick;
        let outbound_queue_threshold = config.entity_outbound_queue_threshold;
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
        let old_entity_revisions = std::mem::take(&mut bookkeeping.entity_revisions);
        let mut entity_revisions = HashMap::new();

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
            let previous_revision = old_entity_revisions.get(&id.0).copied().unwrap_or_default();
            let revision = if is_new || updated {
                previous_revision.saturating_add(1)
            } else {
                previous_revision
            };
            entity_revisions.insert(id.0.clone(), revision);

            new_bookkeeping_records.insert(
                id.0.to_owned(),
                (etype.0.to_owned(), ent, json_str, persisted),
            );
        }

        let mut client_updates: HashMap<String, ClientEntityUpdates> = HashMap::new();

        for (id, etype, metadata) in &deleted_entities {
            for client_id in clients.keys() {
                if bookkeeping.interests.untrack(client_id, id) {
                    client_updates
                        .entry(client_id.clone())
                        .or_default()
                        .critical
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
            let mut pending_updates = Vec::new();

            if let Some(tracked) = bookkeeping.interests.tracked_mut(client_id) {
                tracked.retain(|entity_id, interest| {
                    let Some((etype, _, _, _)) = new_bookkeeping_records.get(entity_id) else {
                        let old_etype = old_entities
                            .get(entity_id)
                            .map(|(etype, ..)| etype.clone())
                            .unwrap_or_default();
                        updates.critical.push(EntityProtocol {
                            operation: EntityOperation::OutOfRange,
                            id: entity_id.clone(),
                            r#type: old_etype,
                            metadata: None,
                        });
                        return false;
                    };

                    let revision = entity_revisions.get(entity_id).copied().unwrap_or_default();

                    if etype.starts_with(BLOCK_ENTITY_PREFIX) {
                        let is_changed = revision > interest.last_sent_revision;
                        let is_keep_alive =
                            tick.saturating_sub(interest.last_sent_tick) >= keep_alive_interval;
                        if is_changed || is_keep_alive {
                            pending_updates.push(PendingEntityUpdate {
                                id: entity_id.clone(),
                                distance_sq: 0.0,
                                revision,
                                last_sent_tick: interest.last_sent_tick,
                                is_full_rate: true,
                                is_keep_alive: !is_changed,
                            });
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
                            updates.critical.push(EntityProtocol {
                                operation: EntityOperation::OutOfRange,
                                id: entity_id.clone(),
                                r#type: etype.clone(),
                                metadata: None,
                            });
                            false
                        }
                        _ => {
                            let is_changed = revision > interest.last_sent_revision;
                            let is_full_rate = distance_sq <= full_rate_radius_sq;
                            let is_far_update_due =
                                tick.saturating_sub(interest.last_sent_tick) >= far_update_interval;
                            let is_keep_alive = !is_changed
                                && tick.saturating_sub(interest.last_sent_tick)
                                    >= keep_alive_interval;

                            if (is_changed && (is_full_rate || is_far_update_due)) || is_keep_alive
                            {
                                pending_updates.push(PendingEntityUpdate {
                                    id: entity_id.clone(),
                                    distance_sq,
                                    revision,
                                    last_sent_tick: interest.last_sent_tick,
                                    is_full_rate,
                                    is_keep_alive,
                                });
                            }
                            true
                        }
                    }
                });
            }

            let is_stream_tick = tick % stream_interval == 0;
            if is_stream_tick && client.sender.entity_len() < outbound_queue_threshold {
                pending_updates.sort_unstable_by(|left, right| {
                    right
                        .is_full_rate
                        .cmp(&left.is_full_rate)
                        .then_with(|| left.last_sent_tick.cmp(&right.last_sent_tick))
                        .then_with(|| left.distance_sq.total_cmp(&right.distance_sq))
                });

                for pending in pending_updates.into_iter().take(max_updates_per_tick) {
                    let Some((etype, _, json_str, _)) = new_bookkeeping_records.get(&pending.id)
                    else {
                        continue;
                    };

                    updates.streaming.push(EntityProtocol {
                        operation: EntityOperation::Update,
                        id: pending.id.clone(),
                        r#type: etype.clone(),
                        metadata: (!pending.is_keep_alive).then(|| json_str.clone()),
                    });

                    if let Some(interest) = bookkeeping
                        .interests
                        .tracked_mut(client_id)
                        .and_then(|tracked| tracked.get_mut(&pending.id))
                    {
                        interest.last_sent_tick = tick;
                        interest.last_sent_revision = pending.revision;
                    }
                }
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

                updates.critical.push(EntityProtocol {
                    operation: EntityOperation::Create,
                    id: id.0.clone(),
                    r#type: etype.clone(),
                    metadata: Some(json_str.clone()),
                });

                let revision = entity_revisions.get(&id.0).copied().unwrap_or_default();
                bookkeeping
                    .interests
                    .track(client_id, &id.0, tick, revision);
            }
        }

        for (entity_id, revision) in &entity_revisions {
            if old_entity_revisions
                .get(entity_id)
                .copied()
                .unwrap_or_default()
                >= *revision
            {
                continue;
            }

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
                    .critical
                    .push(EntityProtocol {
                        operation: EntityOperation::Create,
                        id: entity_id.clone(),
                        r#type: etype.clone(),
                        metadata: Some(json_str.clone()),
                    });

                bookkeeping
                    .interests
                    .track(client_id, entity_id, tick, *revision);
            }
        }

        bookkeeping.entities = new_bookkeeping_records;
        bookkeeping.entity_positions = entity_positions;
        bookkeeping.entity_revisions = entity_revisions;

        for (client_id, updates) in client_updates {
            for updates in [updates.critical, updates.streaming] {
                if updates.is_empty() {
                    continue;
                }

                let mut message = Message::new(&MessageType::Entity).entities(&updates);
                if perf::is_enabled() {
                    let trace_id = perf::next_trace_id("entity");
                    let metadata_bytes = updates
                        .iter()
                        .map(|update| update.metadata.as_ref().map_or(0, String::len))
                        .sum::<usize>();
                    message = message
                        .json(&serde_json::json!({ "townPerfTraceId": trace_id }).to_string());
                    perf::log(
                        "entity_batch_queue",
                        &timing.world_name,
                        serde_json::json!({
                            "traceId": trace_id,
                            "tick": tick,
                            "clientId": client_id.clone(),
                            "itemCount": updates.len(),
                            "metadataBytes": metadata_bytes,
                        }),
                    );
                }
                queue.push((message.build(), ClientFilter::Direct(client_id.clone())));
            }
        }
    }
}
