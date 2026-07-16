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

/// Per-client output of one tick: lifecycle transitions (reliable events) and
/// state UPDATEs paired with the squared client-to-entity distance the
/// budgeted state flush orders by.
#[derive(Default)]
struct ClientUpdates {
    lifecycle: Vec<EntityProtocol>,
    state: Vec<(EntityProtocol, f32)>,
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
                        updates.lifecycle.push(EntityProtocol {
                            operation: EntityOperation::OutOfRange,
                            id: entity_id.clone(),
                            r#type: old_etype,
                            metadata: None,
                        });
                        return false;
                    };

                    // Block entities are chunk-bound: every client keeps them
                    // for as long as they exist, with change-driven updates.
                    // Distance zero gives their rare updates flush priority.
                    if etype.starts_with(BLOCK_ENTITY_PREFIX) {
                        if changed_metadata_ids.contains(entity_id) {
                            updates.state.push((
                                EntityProtocol {
                                    operation: EntityOperation::Update,
                                    id: entity_id.clone(),
                                    r#type: etype.clone(),
                                    metadata: Some(json_str.clone()),
                                },
                                0.0,
                            ));
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
                            });
                            false
                        }
                        _ => {
                            if changed_metadata_ids.contains(entity_id) {
                                updates.state.push((
                                    EntityProtocol {
                                        operation: EntityOperation::Update,
                                        id: entity_id.clone(),
                                        r#type: etype.clone(),
                                        metadata: Some(json_str.clone()),
                                    },
                                    distance_sq,
                                ));
                                *last_sent_tick = tick;
                            } else if tick.saturating_sub(*last_sent_tick) >= keep_alive_interval {
                                updates.state.push((
                                    EntityProtocol {
                                        operation: EntityOperation::Update,
                                        id: entity_id.clone(),
                                        r#type: etype.clone(),
                                        metadata: None,
                                    },
                                    distance_sq,
                                ));
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
        // a backed-up client can never receive a replay of stale positions,
        // and the broadcast system flushes them under a per-tick budget.
        for (client_id, updates) in client_updates {
            let ClientUpdates { lifecycle, state } = updates;

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
                        lifecycle.iter(),
                    );
                    message = message
                        .json(&serde_json::json!({ "townPerfTraceId": trace_id }).to_string());
                }
                queue.push((message.build(), ClientFilter::Direct(client_id.clone())));
            }

            if !state.is_empty() {
                if perf::is_enabled() {
                    let trace_id = log_entity_batch_queue(
                        &timing.world_name,
                        tick,
                        &client_id,
                        state.iter().map(|(update, _)| update),
                    );
                    replicated_state.note_trace_id(&client_id, trace_id);
                }
                for (update, distance_sq) in state {
                    replicated_state.stage_entity_update(&client_id, update, distance_sq, tick);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Client, WorldConfig, WsSender};
    use serde_json::json;
    use specs::{Builder, RunNow, World, WorldExt};

    const CLIENT_ID: &str = "client";

    fn make_world(entity_count: usize) -> World {
        let mut world = World::new();

        world.register::<EntityFlag>();
        world.register::<IDComp>();
        world.register::<ETypeComp>();
        world.register::<InteractorComp>();
        world.register::<DoNotPersistComp>();
        world.register::<PositionComp>();
        world.register::<VoxelComp>();
        world.register::<MetadataComp>();

        let config = WorldConfig::new().build();
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
            })
            .collect()
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

        // Ticks 2-10: no metadata changed, so nothing is queued and nothing
        // is staged — unchanged entities are silent until their keep-alive.
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

        {
            let ids = world.read_storage::<IDComp>();
            let mut metadatas = world.write_storage::<MetadataComp>();
            use specs::Join;
            for (id, metadata) in (&ids, &mut metadatas).join() {
                if id.0 == "bot-7" {
                    metadata.set_value("position", json!([99.0, 0.0, 0.0]));
                }
            }
        }

        run_tick(&mut world, 2);
        assert!(drain_queued_entity_ops(&world).is_empty());

        let mut buffer = world.write_resource::<ReplicatedStateBuffer>();
        let flush = buffer
            .drain_client(CLIENT_ID, crate::EntityFlushBudget::UNLIMITED)
            .unwrap();
        assert_eq!(flush.entities.len(), 1);
        assert_eq!(flush.entities[0].id, "bot-7");
        assert_eq!(flush.entities[0].operation, EntityOperation::Update);
    }

    #[test]
    fn a_changing_150_entity_scene_flushes_bounded_bytes_per_tick() {
        // Reproduces the observed incident shape: ~150 tracked entities whose
        // metadata (~800 bytes each) changes every tick. Draining without a
        // budget shows the old per-tick frame (~120 KB); draining with the
        // default budget bounds every flush.
        let mut world = make_world(150);

        fn mutate_all(world: &mut World, tick: u64) {
            use specs::Join;
            let mut metadatas = world.write_storage::<MetadataComp>();
            let flags = world.read_storage::<EntityFlag>();
            for (metadata, _) in (&mut metadatas, &flags).join() {
                metadata.set_value("position", json!([tick as f32, 0.0, 0.0]));
                metadata.set_value("blob", json!("p".repeat(760)));
            }
        }

        fn wire_bytes(updates: &[EntityProtocol]) -> usize {
            updates
                .iter()
                .map(|u| u.id.len() + u.r#type.len() + u.metadata.as_ref().map_or(0, String::len))
                .sum()
        }

        run_tick(&mut world, 1);
        assert_eq!(drain_queued_entity_ops(&world).len(), 150);

        // Before: one unbudgeted drain carries the whole changed scene.
        mutate_all(&mut world, 2);
        run_tick(&mut world, 2);
        let before = {
            let mut buffer = world.write_resource::<ReplicatedStateBuffer>();
            let flush = buffer
                .drain_client(CLIENT_ID, crate::EntityFlushBudget::UNLIMITED)
                .unwrap();
            wire_bytes(&flush.entities)
        };
        assert!(
            before > 100_000,
            "expected the unbudgeted scene to exceed 100 KB, got {} bytes",
            before
        );

        // After: the default budget bounds every tick's flush.
        let budget = {
            let config = world.read_resource::<WorldConfig>();
            crate::EntityFlushBudget {
                max_updates: config.max_entity_updates_per_tick,
                max_bytes: config.max_entity_update_bytes_per_tick,
            }
        };
        for tick in 3..=12 {
            mutate_all(&mut world, tick);
            run_tick(&mut world, tick);
            let mut buffer = world.write_resource::<ReplicatedStateBuffer>();
            let flush = buffer.drain_client(CLIENT_ID, budget).unwrap();
            assert!(flush.entities.len() <= budget.max_updates);
            assert!(
                wire_bytes(&flush.entities) <= budget.max_bytes,
                "budgeted flush exceeded the byte budget on tick {}",
                tick
            );
        }
    }

    #[test]
    fn unchanged_entities_keep_alive_without_metadata() {
        let mut world = make_world(3);
        let keep_alive_interval = world
            .read_resource::<WorldConfig>()
            .entity_keep_alive_interval;

        run_tick(&mut world, 1);
        drain_queued_entity_ops(&world);

        run_tick(&mut world, 1 + keep_alive_interval);
        let mut buffer = world.write_resource::<ReplicatedStateBuffer>();
        let flush = buffer
            .drain_client(CLIENT_ID, crate::EntityFlushBudget::UNLIMITED)
            .unwrap();
        assert_eq!(flush.entities.len(), 3);
        assert!(flush.entities.iter().all(|op| op.metadata.is_none()));
    }
}

fn log_entity_batch_queue<'a>(
    world_name: &str,
    tick: u64,
    client_id: &str,
    updates: impl Iterator<Item = &'a EntityProtocol>,
) -> String {
    let trace_id = perf::next_trace_id("entity");
    let mut item_count = 0;
    let mut metadata_bytes = 0;
    for update in updates {
        item_count += 1;
        metadata_bytes += update.metadata.as_ref().map_or(0, String::len);
    }
    perf::log(
        "entity_batch_queue",
        world_name,
        serde_json::json!({
            "traceId": trace_id,
            "tick": tick,
            "clientId": client_id,
            "itemCount": item_count,
            "metadataBytes": metadata_bytes,
        }),
    );
    trace_id
}
