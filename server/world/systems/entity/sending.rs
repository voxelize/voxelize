use hashbrown::{HashMap, HashSet};
use specs::{
    Entities, Entity, Join, LendJoin, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage,
};

use crate::{
    classify_interest, motion_max_age_for, perf, world::system_profiler::WorldTimingContext,
    BackgroundEntitiesSaver, Bookkeeping, ClientFilter, Clients, DirectionComp, DoNotPersistComp,
    ETypeComp, EntityFlag, EntityIDs, EntityOperation, EntityProtocol, IDComp, InteractorComp,
    InterestTransition, KdTree, Message, MessageQueues, MessageType, MetadataComp, MotionSample,
    Physics, PositionComp, QuantizedMotion, ReplicatedStateBuffer, RigidBodyComp, Stats,
    TargetComp, Vec3, VoxelComp, WorldConfig, METADATA_MAX_AGE_MS,
};

const BLOCK_ENTITY_PREFIX: &str = "block::";

#[derive(Default)]
pub struct EntitiesSendingSystem {
    updated_entities_buffer: Vec<(String, Entity)>,
    new_entity_ids_buffer: HashSet<String>,
}

/// Per-client output of one tick: lifecycle transitions (reliable events)
/// plus counters for the state staged into the latest-wins buffer.
#[derive(Default)]
struct ClientUpdates {
    lifecycle: Vec<EntityProtocol>,
    staged_count: usize,
    staged_bytes: usize,
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
        ReadStorage<'a, DirectionComp>,
        ReadStorage<'a, RigidBodyComp>,
        ReadStorage<'a, TargetComp>,
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
            directions,
            rigid_bodies,
            targets,
            voxels,
            mut metadatas,
        ) = data;

        self.updated_entities_buffer.clear();
        self.new_entity_ids_buffer.clear();

        let visible_radius = config.entity_visible_radius;
        let release_radius = config.entity_release_radius;
        let keep_alive_interval = config.entity_keep_alive_interval;
        let motion_max_age_ms = config.entity_motion_max_age_ms;
        let tick = stats.tick;
        let now_ms = stats.elapsed().as_millis() as u64;

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
        let old_motion = std::mem::take(&mut bookkeeping.motion);

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
        let mut new_motion: HashMap<String, QuantizedMotion> = HashMap::new();
        let mut entity_positions: HashMap<String, Vec3<f32>> = HashMap::new();
        // Legacy trigger for block entities: full-map change (or first sight).
        let mut changed_metadata_ids: HashSet<String> = HashSet::new();
        // Motion lane: entity id -> encoded motion.v1 payload, present when
        // the QUANTIZED motion changed — sub-resolution jitter stages nothing.
        let mut changed_motion: HashMap<String, Vec<u8>> = HashMap::new();
        // Metadata lane: entity id -> non-motion JSON, present when it changed.
        let mut changed_non_motion: HashMap<String, String> = HashMap::new();

        for (ent, id, metadata, etype, _, do_not_persist, position, direction, rigid_body, target, voxel) in (
            &entities,
            &ids,
            &mut metadatas,
            &etypes,
            &flags,
            do_not_persist.maybe(),
            positions.maybe(),
            directions.maybe(),
            rigid_bodies.maybe(),
            targets.maybe(),
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
            let is_block_entity = etype.0.starts_with(BLOCK_ENTITY_PREFIX);

            if !is_block_entity {
                if let Some(position) = position {
                    let sample = MotionSample {
                        position: [position.0 .0, position.0 .1, position.0 .2],
                        direction: direction.map(|d| [d.0 .0, d.0 .1, d.0 .2]),
                        rigid_body: rigid_body.map(|r| (r.0.in_fluid, r.0.ratio_in_fluid)),
                        target: target.and_then(|t| {
                            t.position.as_ref().map(|p| [p.0, p.1, p.2])
                        }),
                    };
                    let quantized = QuantizedMotion::from_sample(&sample);
                    let is_motion_changed = old_motion.get(&id.0) != Some(&quantized);
                    if is_motion_changed && !is_new {
                        changed_motion.insert(id.0.clone(), quantized.encode());
                    }
                    new_motion.insert(id.0.clone(), quantized);
                }
            }

            let snapshot = metadata.snapshot_for_replication();

            if is_new || snapshot.is_full_updated {
                changed_metadata_ids.insert(id.0.clone());
            }
            if !is_new {
                if let Some(non_motion) = snapshot.updated_non_motion_json {
                    changed_non_motion.insert(id.0.clone(), non_motion);
                }
            }

            new_bookkeeping_records.insert(
                id.0.to_owned(),
                (etype.0.to_owned(), ent, snapshot.full_json, persisted),
            );
        }

        let mut client_updates: HashMap<String, ClientUpdates> = HashMap::new();

        for (id, etype, metadata) in &deleted_entities {
            for client_id in clients.keys() {
                if bookkeeping.interests.untrack(client_id, id) {
                    client_updates
                        .entry(client_id.clone())
                        .or_default()
                        .lifecycle
                        .push(EntityProtocol {
                            operation: EntityOperation::Delete,
                            id: id.clone(),
                            r#type: etype.clone(),
                            metadata: Some(metadata.clone()),
                            motion: None,
                        });
                }
            }
        }

        for (client_id, client) in clients.iter() {
            let client_pos = match positions.get(client.entity) {
                Some(p) => p.0.clone(),
                None => continue,
            };

            let is_compact = client.motion_protocol.is_compact();
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
                        updates.lifecycle.push(EntityProtocol {
                            operation: EntityOperation::OutOfRange,
                            id: entity_id.clone(),
                            r#type: old_etype,
                            metadata: None,
                            motion: None,
                        });
                        return false;
                    };

                    // Block entities are chunk-bound: every client keeps them
                    // for as long as they exist, with change-driven updates.
                    // Distance zero gives their rare updates flush priority.
                    if etype.starts_with(BLOCK_ENTITY_PREFIX) {
                        if changed_metadata_ids.contains(entity_id) {
                            replicated_state.stage_metadata(
                                client_id,
                                entity_id,
                                etype,
                                json_str.clone(),
                                false,
                                0.0,
                                now_ms,
                                METADATA_MAX_AGE_MS,
                            );
                            updates.staged_count += 1;
                            updates.staged_bytes += json_str.len();
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
                            updates.lifecycle.push(EntityProtocol {
                                operation: EntityOperation::OutOfRange,
                                id: entity_id.clone(),
                                r#type: etype.clone(),
                                metadata: None,
                                motion: None,
                            });
                            false
                        }
                        _ => {
                            let is_motion_fresh = changed_motion.contains_key(entity_id);
                            let max_age_ms =
                                motion_max_age_for(motion_max_age_ms, distance_sq, visible_radius);
                            let mut is_staged = false;

                            if is_compact {
                                if let Some(payload) = changed_motion.get(entity_id) {
                                    replicated_state.stage_motion(
                                        client_id,
                                        entity_id,
                                        etype,
                                        payload.clone(),
                                        distance_sq,
                                        now_ms,
                                        max_age_ms,
                                    );
                                    updates.staged_count += 1;
                                    updates.staged_bytes += payload.len();
                                    is_staged = true;
                                }
                                if let Some(non_motion) = changed_non_motion.get(entity_id) {
                                    replicated_state.stage_metadata(
                                        client_id,
                                        entity_id,
                                        etype,
                                        non_motion.clone(),
                                        false,
                                        distance_sq,
                                        now_ms,
                                        METADATA_MAX_AGE_MS,
                                    );
                                    updates.staged_count += 1;
                                    updates.staged_bytes += non_motion.len();
                                    is_staged = true;
                                }
                            } else if is_motion_fresh
                                || changed_non_motion.contains_key(entity_id)
                            {
                                // Legacy clients receive the full metadata
                                // map exactly as before the compact path
                                // existed, but scheduled with motion-lane
                                // urgency whenever the entity actually moved
                                // — same freshness, fatter encoding.
                                replicated_state.stage_metadata(
                                    client_id,
                                    entity_id,
                                    etype,
                                    json_str.clone(),
                                    is_motion_fresh,
                                    distance_sq,
                                    now_ms,
                                    if is_motion_fresh {
                                        max_age_ms
                                    } else {
                                        METADATA_MAX_AGE_MS
                                    },
                                );
                                updates.staged_count += 1;
                                updates.staged_bytes += json_str.len();
                                is_staged = true;
                            }

                            if is_staged {
                                *last_sent_tick = tick;
                            } else if tick.saturating_sub(*last_sent_tick) >= keep_alive_interval
                            {
                                replicated_state.stage_keep_alive(
                                    client_id, entity_id, etype, distance_sq, now_ms,
                                );
                                updates.staged_count += 1;
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
                    .lifecycle
                    .push(EntityProtocol {
                        operation: EntityOperation::Create,
                        id: id.0.clone(),
                        r#type: etype.clone(),
                        metadata: Some(json_str.clone()),
                        motion: None,
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
                    .lifecycle
                    .push(EntityProtocol {
                        operation: EntityOperation::Create,
                        id: entity_id.clone(),
                        r#type: etype.clone(),
                        metadata: Some(json_str.clone()),
                        motion: None,
                    });

                bookkeeping.interests.track(client_id, entity_id, tick);
            }
        }

        bookkeeping.entities = new_bookkeeping_records;
        bookkeeping.entity_positions = entity_positions;
        bookkeeping.motion = new_motion;

        // Channel routing (see `world::replication`): lifecycle transitions
        // (CREATE / DELETE / OUT_OF_RANGE) are reliable EVENTS a client must
        // never miss — they go through the FIFO message queue. Motion and
        // metadata UPDATEs are latest-wins STATE — they were staged above
        // into the per-client, per-entity slot buffer, where a newer value
        // overwrites an undelivered older one, and the broadcast system
        // flushes them earliest-deadline-first under a dynamic budget.
        for (client_id, updates) in client_updates {
            let ClientUpdates {
                lifecycle,
                staged_count,
                staged_bytes,
            } = updates;

            if !lifecycle.is_empty() {
                for update in &lifecycle {
                    // A pending state slot staged before this transition must
                    // never be flushed after it (it would resurrect an entity
                    // the client just released or deleted).
                    replicated_state.clear_entity(&client_id, &update.id);
                }

                let mut message = Message::new(&MessageType::Entity)
                    .entities(&lifecycle)
                    .tick(tick);
                if perf::is_enabled() {
                    let trace_id = log_entity_batch_queue(
                        &timing.world_name,
                        tick,
                        &client_id,
                        lifecycle.len(),
                        lifecycle
                            .iter()
                            .map(|update| update.metadata.as_ref().map_or(0, String::len))
                            .sum(),
                    );
                    message = message
                        .json(&serde_json::json!({ "townPerfTraceId": trace_id }).to_string());
                }
                queue.push((message.build(), ClientFilter::Direct(client_id.clone())));
            }

            if staged_count > 0 && perf::is_enabled() {
                let trace_id = log_entity_batch_queue(
                    &timing.world_name,
                    tick,
                    &client_id,
                    staged_count,
                    staged_bytes,
                );
                replicated_state.note_trace_id(&client_id, trace_id);
            }
        }
    }
}

fn log_entity_batch_queue(
    world_name: &str,
    tick: u64,
    client_id: &str,
    item_count: usize,
    payload_bytes: usize,
) -> String {
    let trace_id = perf::next_trace_id("entity");
    perf::log(
        "entity_batch_queue",
        world_name,
        serde_json::json!({
            "traceId": trace_id,
            "tick": tick,
            "clientId": client_id,
            "itemCount": item_count,
            "metadataBytes": payload_bytes,
        }),
    );
    trace_id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{decode_motion, Client, MotionProtocol, WorldConfig, WsSender};
    use serde_json::json;
    use specs::{Builder, RunNow, World, WorldExt};

    const CLIENT_ID: &str = "client";

    fn make_world_with_protocol(entity_count: usize, motion_protocol: MotionProtocol) -> World {
        // A motion max age far beyond test runtime keeps deadline forcing
        // out of these system-level tests; the wall-clock SLA behavior is
        // covered with a simulated clock in replication::tests.
        let config = WorldConfig::new().entity_motion_max_age_ms(600_000).build();
        make_world_custom(entity_count, motion_protocol, config)
    }

    fn make_world_custom(
        entity_count: usize,
        motion_protocol: MotionProtocol,
        config: WorldConfig,
    ) -> World {
        let mut world = World::new();

        world.register::<EntityFlag>();
        world.register::<IDComp>();
        world.register::<ETypeComp>();
        world.register::<InteractorComp>();
        world.register::<DoNotPersistComp>();
        world.register::<PositionComp>();
        world.register::<DirectionComp>();
        world.register::<RigidBodyComp>();
        world.register::<TargetComp>();
        world.register::<VoxelComp>();
        world.register::<MetadataComp>();

        world.insert(BackgroundEntitiesSaver::new(&config));
        world.insert(WorldTimingContext::new("test"));
        world.insert(Stats::new(false, "", 0.0));
        world.insert(MessageQueues::new());
        world.insert(ReplicatedStateBuffer::new());
        world.insert(Bookkeeping::new());
        world.insert(Physics::new());
        world.insert(EntityIDs::new());
        world.insert(config);

        let client_entity = world
            .create_entity()
            .with(PositionComp::new(0.0, 0.0, 0.0))
            .build();

        let (control, _control_rx) = tokio::sync::mpsc::unbounded_channel();
        let (bulk, _bulk_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut clients = Clients::new();
        clients.insert(
            CLIENT_ID.to_owned(),
            Client {
                id: CLIENT_ID.to_owned(),
                username: CLIENT_ID.to_owned(),
                entity: client_entity,
                sender: WsSender::new(control, bulk),
                motion_protocol,
            },
        );
        world.insert(clients);

        let mut kdtree = KdTree::new();
        for i in 0..entity_count {
            let position = Vec3(i as f32 + 1.0, 0.0, 0.0);
            let mut metadata = MetadataComp::new();
            metadata.set_value("position", json!([position.0, position.1, position.2]));

            let entity = world
                .create_entity()
                .with(EntityFlag)
                .with(IDComp::new(&format!("bot-{}", i)))
                .with(ETypeComp::new("bot", false))
                .with(PositionComp::new(position.0, position.1, position.2))
                .with(metadata)
                .build();
            kdtree.add_entity(entity, position);
        }
        world.insert(kdtree);
        world.maintain();

        world
    }

    fn make_world(entity_count: usize) -> World {
        make_world_with_protocol(entity_count, MotionProtocol::LegacyJson)
    }

    fn run_tick(world: &mut World, tick: u64) {
        world.write_resource::<Stats>().tick = tick;
        EntitiesSendingSystem::default().run_now(world);
    }

    fn drain_queued_entity_ops(world: &World) -> Vec<EntityProtocol> {
        let mut queues = world.write_resource::<MessageQueues>();
        queues
            .drain_prioritized()
            .into_iter()
            .flat_map(|(message, _)| message.entities)
            .map(|entity| EntityProtocol {
                operation: EntityOperation::try_from(entity.operation).unwrap(),
                id: entity.id,
                r#type: entity.r#type,
                metadata: if entity.metadata.is_empty() {
                    None
                } else {
                    Some(entity.metadata)
                },
                motion: entity.motion,
            })
            .collect()
    }

    fn drain_state(world: &World) -> Vec<EntityProtocol> {
        let mut buffer = world.write_resource::<ReplicatedStateBuffer>();
        buffer
            .drain_client(CLIENT_ID, u64::MAX / 2, usize::MAX)
            .map(|flush| flush.entities)
            .unwrap_or_default()
    }

    fn move_entity(world: &mut World, entity_id: &str, position: [f32; 3]) {
        let ids = world.read_storage::<IDComp>();
        let mut positions = world.write_storage::<PositionComp>();
        let mut metadatas = world.write_storage::<MetadataComp>();
        for (id, pos, metadata) in (&ids, &mut positions, &mut metadatas).join() {
            if id.0 == entity_id {
                pos.0 = Vec3(position[0], position[1], position[2]);
                metadata.set_value("position", json!(position));
            }
        }
    }

    #[test]
    fn unchanged_entities_do_not_resend_every_tick() {
        let mut world = make_world(150);

        // Tick 1: all 150 entities enter the client's interest set as
        // reliable CREATEs carrying their full snapshot — the client's
        // complete initial state.
        run_tick(&mut world, 1);
        let created = drain_queued_entity_ops(&world);
        assert_eq!(created.len(), 150);
        assert!(created
            .iter()
            .all(|op| op.operation == EntityOperation::Create && op.metadata.is_some()));
        assert_eq!(
            world
                .read_resource::<ReplicatedStateBuffer>()
                .total_pending(),
            0
        );

        // Ticks 2-10: no motion or metadata changed, so nothing is queued
        // and nothing is staged — unchanged entities are silent until their
        // keep-alive.
        for tick in 2..=10 {
            run_tick(&mut world, tick);
            assert!(drain_queued_entity_ops(&world).is_empty());
            assert_eq!(
                world
                    .read_resource::<ReplicatedStateBuffer>()
                    .total_pending(),
                0,
                "unchanged entities were re-staged on tick {}",
                tick
            );
        }
    }

    #[test]
    fn only_the_changed_entity_is_staged() {
        let mut world = make_world(150);
        run_tick(&mut world, 1);
        drain_queued_entity_ops(&world);

        move_entity(&mut world, "bot-7", [99.0, 0.0, 0.0]);

        run_tick(&mut world, 2);
        assert!(drain_queued_entity_ops(&world).is_empty());

        let staged = drain_state(&world);
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].id, "bot-7");
        assert_eq!(staged[0].operation, EntityOperation::Update);
    }

    #[test]
    fn sub_resolution_jitter_stages_nothing() {
        let mut world = make_world(10);
        run_tick(&mut world, 1);
        drain_queued_entity_ops(&world);

        // A jostle far below the wire's quantization resolution (1/512
        // block) — the incident shape where settled entities kept streaming.
        move_entity(&mut world, "bot-3", [4.0 + 0.0005, 0.0, 0.0]);

        run_tick(&mut world, 2);
        assert!(drain_state(&world).is_empty());
    }

    #[test]
    fn legacy_clients_receive_the_full_metadata_json() {
        let mut world = make_world(3);
        run_tick(&mut world, 1);
        drain_queued_entity_ops(&world);

        move_entity(&mut world, "bot-1", [50.0, 0.0, 0.0]);
        run_tick(&mut world, 2);

        let staged = drain_state(&world);
        assert_eq!(staged.len(), 1);
        assert!(staged[0].motion.is_none());
        let metadata = staged[0].metadata.as_deref().unwrap();
        assert!(metadata.contains("position"));
    }

    #[test]
    fn compact_clients_receive_motion_payloads_instead_of_json() {
        let mut world = make_world_with_protocol(3, MotionProtocol::CompactV1);
        run_tick(&mut world, 1);
        let created = drain_queued_entity_ops(&world);
        // Complete initial state still arrives as full JSON CREATEs.
        assert_eq!(created.len(), 3);
        assert!(created.iter().all(|op| op.metadata.is_some()));

        move_entity(&mut world, "bot-1", [50.0, 0.0, 0.0]);
        run_tick(&mut world, 2);

        let staged = drain_state(&world);
        assert_eq!(staged.len(), 1);
        assert!(staged[0].metadata.is_none(), "motion must not ship as JSON");
        let decoded = decode_motion(staged[0].motion.as_deref().unwrap()).unwrap();
        assert_eq!(decoded.position, [50.0, 0.0, 0.0]);
    }

    #[test]
    fn compact_clients_receive_non_motion_changes_as_stripped_json() {
        let mut world = make_world_with_protocol(3, MotionProtocol::CompactV1);
        run_tick(&mut world, 1);
        drain_queued_entity_ops(&world);

        {
            let ids = world.read_storage::<IDComp>();
            let mut metadatas = world.write_storage::<MetadataComp>();
            for (id, metadata) in (&ids, &mut metadatas).join() {
                if id.0 == "bot-2" {
                    metadata.set_value("text", json!("hello"));
                }
            }
        }

        run_tick(&mut world, 2);
        let staged = drain_state(&world);
        assert_eq!(staged.len(), 1);
        assert!(staged[0].motion.is_none());
        let metadata = staged[0].metadata.as_deref().unwrap();
        assert!(metadata.contains("text"));
        assert!(
            !metadata.contains("position"),
            "motion keys must not ride the compact metadata lane"
        );
    }

    #[test]
    fn a_changing_150_entity_scene_flushes_bounded_bytes_per_tick() {
        // The incident shape: ~150 tracked entities all moving every tick.
        // Under the deadline scheduler with the default budget every flush
        // stays bounded while every entity still meets its freshness SLA
        // (the wall-clock bound is exercised in replication::tests; here we
        // verify the system-level staging feeds it correctly).
        let mut world = make_world(150);

        fn mutate_all(world: &mut World, tick: u64) {
            let flags = world.read_storage::<EntityFlag>();
            let mut positions = world.write_storage::<PositionComp>();
            let mut metadatas = world.write_storage::<MetadataComp>();
            for (_, pos, metadata) in (&flags, &mut positions, &mut metadatas).join() {
                pos.0 .0 += 0.1 * tick as f32;
                metadata.set_value("position", json!([pos.0 .0, pos.0 .1, pos.0 .2]));
                metadata.set_value("blob", json!("p".repeat(760)));
            }
        }

        fn wire_bytes(updates: &[EntityProtocol]) -> usize {
            updates
                .iter()
                .map(|u| {
                    u.id.len()
                        + u.r#type.len()
                        + u.metadata.as_ref().map_or(0, String::len)
                        + u.motion.as_ref().map_or(0, Vec::len)
                        + 8
                })
                .sum()
        }

        run_tick(&mut world, 1);
        assert_eq!(drain_queued_entity_ops(&world).len(), 150);

        // All 150 changing at once: an unbudgeted drain carries >100 KB, the
        // budgeted drain stays within the configured bound.
        mutate_all(&mut world, 2);
        run_tick(&mut world, 2);
        let before = {
            let mut buffer = world.write_resource::<ReplicatedStateBuffer>();
            let flush = buffer.drain_client(CLIENT_ID, 0, usize::MAX).unwrap();
            wire_bytes(&flush.entities)
        };
        assert!(
            before > 100_000,
            "expected the unbudgeted scene to exceed 100 KB, got {} bytes",
            before
        );

        let budget = world
            .read_resource::<WorldConfig>()
            .entity_flush_base_bytes_per_tick;
        for tick in 3..=12 {
            mutate_all(&mut world, tick);
            run_tick(&mut world, tick);
            let now_ms = tick * 16;
            let mut buffer = world.write_resource::<ReplicatedStateBuffer>();
            let flush = buffer.drain_client(CLIENT_ID, now_ms, budget).unwrap();
            let bytes = wire_bytes(&flush.entities);
            // Within the SLA window nothing is forced, so the flush honors
            // the budget (plus at most one update of slack).
            assert!(
                bytes <= budget + 900,
                "budgeted flush ballooned to {} bytes on tick {}",
                bytes,
                tick
            );
        }
    }

    #[test]
    fn unchanged_entities_keep_alive_without_payload() {
        let mut world = make_world(3);
        let keep_alive_interval = world
            .read_resource::<WorldConfig>()
            .entity_keep_alive_interval;

        run_tick(&mut world, 1);
        drain_queued_entity_ops(&world);

        run_tick(&mut world, 1 + keep_alive_interval);
        let staged = drain_state(&world);
        assert_eq!(staged.len(), 3);
        assert!(staged
            .iter()
            .all(|op| op.metadata.is_none() && op.motion.is_none()));
    }
}
