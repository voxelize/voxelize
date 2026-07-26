use super::*;

impl World {
    /// Handle to the inbound state buffer, cloned by the [`Server`] when this
    /// world is registered so peer position packets can bypass the world's
    /// actor mailbox and be applied at tick start instead.
    pub(crate) fn inbound_state_handle(&self) -> Arc<InboundStateBuffer> {
        self.inbound_state.clone()
    }

    /// Apply every staged inbound peer/state packet to the ECS. Runs at the
    /// start of each tick (before the system dispatch) and before any other
    /// client request, which preserves the per-client guarantee that a
    /// command sent after a position packet observes that position.
    pub(super) fn apply_inbound_state(&mut self) {
        if self.inbound_state.is_empty() {
            return;
        }
        for (client_id, messages) in self.inbound_state.drain() {
            for message in messages {
                self.on_peer(&client_id, message);
            }
        }
    }

    /// A snapshot of this world's deterministic clock for replication /
    /// observation: step count, sim time, and the render-interpolation `alpha`.
    /// `None` on a non-deterministic world. This is the surface a snapshot
    /// publisher samples (design §6); `alpha` is a render input only and is
    /// never read back into the sim.
    pub fn fixed_step_sample(&self) -> Option<FixedStepSample> {
        if self.config().fixed_timestep.is_none() {
            return None;
        }
        let state = self.read_resource::<FixedStepState>();
        Some(FixedStepSample {
            step_count: state.clock.step_count(),
            sim_time_secs: state.clock.sim_time_secs(),
            alpha: state.clock.alpha(),
            dt_secs: state.clock.dt_secs(),
        })
    }

    /// Whether this world has server-side lag-compensation enabled (an opt-in
    /// position-history ring + rewound queries).
    pub fn has_lag_comp(&self) -> bool {
        self.config().lag_comp.is_some()
    }

    /// Read-only access to this world's lag-compensation resource (history ring
    /// + RTT trackers), or `None` when lag-comp is disabled. Game code resolves
    /// rewound queries and reads rewind depths through this; write access (to
    /// fold RTT samples or record custom poses) is via
    /// [`Self::write_resource::<LagComp>`].
    pub fn lag_comp(&self) -> Option<Fetch<'_, LagComp>> {
        if self.has_lag_comp() {
            Some(self.read_resource::<LagComp>())
        } else {
            None
        }
    }

    /// The rewound pose of an entity at a historical tick, or `None` when
    /// lag-comp is disabled, the tick has been evicted, or the entity was not
    /// recorded there. This is the engine's "where was entity E at tick T?"
    /// answer.
    pub fn rewound_pose(&self, entity: u64, tick: u64) -> Option<Pose> {
        self.lag_comp()?.history().pose_at(entity, tick)
    }

    /// Record the poses of all rewind-eligible entities into the history ring
    /// for `tick`. Called at the start of each fixed sim step, before the
    /// dispatch mutates positions. A no-op when lag-comp is disabled.
    pub(super) fn record_rewind_poses(&mut self, tick: u64) {
        if !self.has_lag_comp() {
            return;
        }

        // Snapshot the marked entities' poses first (immutable storage borrows),
        // then commit them into the resource (mutable borrow) — the two borrows
        // never overlap.
        let poses: Vec<(u64, Pose)> = {
            let entities = self.ecs.entities();
            let positions = self.ecs.read_storage::<PositionComp>();
            let directions = self.ecs.read_storage::<DirectionComp>();
            let eligible = self.ecs.read_storage::<RewindEligibleComp>();

            (&entities, &positions, &eligible)
                .join()
                .map(|(entity, position, _)| {
                    let direction = directions
                        .get(entity)
                        .map_or([0.0, 0.0, 0.0], |dir| [dir.0 .0, dir.0 .1, dir.0 .2]);
                    (
                        entity.id() as u64,
                        Pose {
                            position: [position.0 .0, position.0 .1, position.0 .2],
                            direction,
                        },
                    )
                })
                .collect()
        };

        let mut lag = self.write_resource::<LagComp>();
        for (entity, pose) in poses {
            lag.history_mut().record(entity, tick, pose);
        }
    }

    /// Check if this world is empty.
    pub fn is_empty(&self) -> bool {
        self.read_resource::<Clients>().is_empty()
    }

    /// Free per-session and per-world state on teardown: eject every client
    /// (dropping its entity, physics body, and buffered state) and clear the
    /// inbound state channel. Runs on the world's own thread from the
    /// [`Teardown`] handler, so it never races a tick.
    pub(crate) fn teardown(&mut self) {
        let ids: Vec<String> = self.clients().keys().cloned().collect();
        for id in ids {
            self.remove_client(&id);
        }
        self.inbound_state.reset();
        self.ecs.maintain();
    }

    /// Return a warm world to a clean, empty state for pooled reuse: delete
    /// every entity and reset all per-session / per-tick / per-voxel resources
    /// to fresh instances, while preserving the registry, config, pipeline
    /// stages, and savers. After this, the ECS holds no entities and the
    /// inbound state channel is empty — the no-leak guarantee pooling relies
    /// on. `WorldConfig`-derived structure (chunk size, bounds) is preserved,
    /// so only same-shaped configs may reuse a slot.
    pub(crate) fn reset(&mut self) {
        let all: Vec<Entity> = {
            let entities = self.ecs.entities();
            (&entities).join().collect()
        };
        {
            let entities = self.ecs.entities();
            for entity in all {
                let _ = entities.delete(entity);
            }
        }
        self.ecs.maintain();

        let config = self.config().make_copy();
        *self.write_resource::<Chunks>() = Chunks::new(&config);
        *self.write_resource::<Clients>() = Clients::new();
        *self.write_resource::<Transports>() = Transports::new();
        *self.write_resource::<EntityIDs>() = EntityIDs::new();
        *self.write_resource::<Bookkeeping>() = Bookkeeping::new();
        *self.write_resource::<ChunkInterests>() = ChunkInterests::new();
        *self.write_resource::<ReplicatedStateBuffer>() = ReplicatedStateBuffer::new();
        *self.write_resource::<MessageQueues>() = MessageQueues::new();
        *self.write_resource::<EncodedMessageQueue>() = EncodedMessageQueue::new();
        *self.write_resource::<Events>() = Events::new();
        *self.write_resource::<KdTree>() = KdTree::new();
        *self.write_resource::<Physics>() = Physics::new();
        *self.write_resource::<Mesher>() = Mesher::new();

        self.inbound_state.reset();
        self.ecs.maintain();
    }

    /// Rename a (reset) world for pooled reuse. Updates the name everywhere it
    /// is observed — the struct field and the `String` / [`WorldMetadata`] /
    /// [`WorldTimingContext`] resources systems read each tick.
    pub(crate) fn rename(&mut self, new_name: &str) {
        self.name = new_name.to_owned();
        *self.write_resource::<String>() = new_name.to_owned();
        self.write_resource::<WorldMetadata>().world_name = new_name.to_owned();
        *self.write_resource::<WorldTimingContext>() = WorldTimingContext::new(new_name);
    }

    /// Prepare to start.
    pub(crate) fn prepare(&mut self) {
        // Merge consecutive chunk stages that don't require spaces together.
        self.pipeline_mut().merge_stages();
        self.load_entities();

        for (position, body) in (
            &self.ecs.read_storage::<PositionComp>(),
            &mut self.ecs.write_storage::<RigidBodyComp>(),
        )
            .join()
        {
            body.0
                .set_position(position.0 .0, position.0 .1, position.0 .2);
        }

        // Reset the stats timing to avoid an unusually large delta on the very first tick caused
        // by world setup and preloading delays. This ensures physics (e.g., rapier) receives a
        // sensible time step and prevents entities such as boids from being launched away at
        // server startup.
        {
            use std::time::SystemTime;
            let mut stats = self.stats_mut();
            stats.prev_time = SystemTime::now();
            stats.delta = 0.0;
        }
    }

    /// Preload the chunks in the world.
    pub(crate) fn preload(&mut self) {
        let radius = self.config().preload_radius as i32;

        {
            for x in -radius..=radius {
                for z in -radius..=radius {
                    let coords = Vec2(x, z);
                    let neighbors = self.chunks().light_traversed_chunks(&coords);

                    neighbors.into_iter().for_each(|coords| {
                        let is_within = {
                            let chunks = self.chunks();
                            chunks.is_within_world(&coords)
                        };

                        let mut pipeline = self.pipeline_mut();
                        if is_within {
                            pipeline.add_chunk(&coords, false);
                        }
                    });
                }
            }
        }

        self.preloading = true;
    }

    /// Tick of the world, run every 16ms.
    /// Run exactly one ECS dispatch (the sim step), summarize the profiler, and
    /// maintain the ECS. Returns `(dispatch_ms, maintain_ms)`. This is the unit
    /// of simulation advancement: called once per delivered tick for a
    /// wall-clock world, or once per fixed step for a deterministic world.
    pub(super) fn run_dispatch(&mut self) -> (f64, f64) {
        let dispatch_time = {
            let mut dispatcher_guard = self.built_dispatcher.lock().unwrap();
            if dispatcher_guard.is_none() {
                let build_timer = SystemTimer::new("dispatcher-build");
                let dispatcher = (self.dispatcher)()
                    .with_pool(super::shared_pools::dispatch_pool())
                    .build();
                *dispatcher_guard = Some(UnsafeSendSync::new(dispatcher));
                record_timing(&self.name, "dispatcher-build", build_timer.elapsed_ms());
            }

            let dispatch_timer = SystemTimer::new("dispatcher-dispatch");
            // Sequential on purpose. Stage-parallel dispatch injects every
            // system of every world tick into a rayon pool as its own task
            // (~60 systems x N worlds x 60Hz), and the workers spin-yield
            // between those micro-batches faster than they can park, which
            // burned several cores at idle. The systems themselves are
            // microseconds each; the ones with real work (physics, metadata,
            // chunk generation) parallelize internally on the global rayon
            // pool, and worlds already run concurrently on their own actor
            // threads.
            dispatcher_guard
                .as_mut()
                .unwrap()
                .get_mut()
                .dispatch_seq(&self.ecs);
            dispatch_timer.elapsed_ms()
        };

        self.write_resource::<Profiler>().summarize();

        let maintain_time = {
            let maintain_timer = SystemTimer::new("ecs-maintain");
            self.ecs.maintain();
            maintain_timer.elapsed_ms()
        };

        (dispatch_time, maintain_time)
    }

    /// Drive the deterministic fixed-step accumulator for one delivered tick.
    ///
    /// Measures real wall-clock elapsed since the previous delivery (the only
    /// place the wall clock is read — to decide *how many* fixed steps to run,
    /// never as a sim input), intakes it into the clock, then runs that many
    /// `DT`-sized dispatches. `max_catchup_steps` bounds the batch so a stall
    /// can never trigger the spiral of death. Returns the summed
    /// `(dispatch_ms, maintain_ms)` across the steps executed this tick.
    pub(super) fn tick_fixed_step(&mut self) -> (f64, f64) {
        let now = Instant::now();
        let elapsed = self
            .last_fixed_tick_at
            .map(|prev| now.saturating_duration_since(prev))
            .unwrap_or(Duration::ZERO);
        self.last_fixed_tick_at = Some(now);

        let plan = self
            .write_resource::<FixedStepState>()
            .clock
            .intake(elapsed.as_secs_f64());

        let mut dispatch_time = 0.0;
        let mut maintain_time = 0.0;
        for _ in 0..plan.steps {
            // Commit the step (advancing the sole time source) *before* the
            // dispatch, so systems read the correct per-step sim time.
            let tick = self.write_resource::<FixedStepState>().clock.commit_step();
            // Record rewind-eligible poses at the *start* of the step, before
            // the dispatch mutates positions — the newest ring frame is thus the
            // pose a client would most recently have rendered. Records at the
            // full sim rate, independent of the coarser snapshot cadence.
            self.record_rewind_poses(tick);
            let (dispatch, maintain) = self.run_dispatch();
            dispatch_time += dispatch;
            maintain_time += maintain;
        }

        (dispatch_time, maintain_time)
    }

    pub(crate) fn tick(&mut self) {
        if !self.started {
            self.started = true;
        }

        // Inbound state replication: apply every peer position packet that
        // arrived before this tick began, so every system in the dispatch
        // below (entity observe, pathfinding, walking) reads current-tick
        // player positions instead of positions from a packet still queued
        // in an actor mailbox.
        self.apply_inbound_state();

        if self.preloading {
            let light_padding = (self.config().max_light_level as f32
                / self.config().chunk_size as f32)
                .ceil() as usize;
            let check_radius = self.config().preload_radius.saturating_sub(light_padding) as i32;

            // Only in-bounds chunks are scheduled by `preload`, so only they
            // can ever become ready: counting out-of-bounds cells toward the
            // expected total would leave `preloading` true forever on bounded
            // worlds whose preload radius exceeds the world bounds.
            let mut total = 0;
            let mut supposed = 0;

            for x in -check_radius..=check_radius {
                for z in -check_radius..=check_radius {
                    let chunks = self.chunks();
                    let coords = Vec2(x, z);

                    if !chunks.is_within_world(&coords) {
                        continue;
                    }

                    supposed += 1;

                    if chunks.is_chunk_ready(&coords) {
                        total += 1;
                    } else {
                        if let Some(chunk) = chunks.raw(&coords) {
                            if chunk.status == ChunkStatus::Meshing
                                && !self.mesher().map.contains(&coords)
                            {
                                // Add the chunk back to meshing queue.
                                drop(chunks);
                                self.mesher_mut().add_chunk(&coords, false);
                            }
                        }
                    }
                }
            }

            self.preload_progress = if supposed == 0 {
                1.0
            } else {
                (total as f32 / supposed as f32).min(1.0)
            };

            if total >= supposed {
                self.preloading = false;
            }
        }

        self.stats_mut().preloading = self.preloading;

        let tick_timer = SystemTimer::new("tick-total");

        // A non-deterministic world (the default) runs exactly one dispatch per
        // delivered tick — identical to before this feature existed. An
        // opted-in deterministic world instead drives dispatches through the
        // fixed-step accumulator, batching them to match real elapsed time
        // while each step advances the sim by exactly `DT`.
        let (dispatch_time, maintain_time) = if self.config().fixed_timestep.is_some() {
            self.tick_fixed_step()
        } else {
            self.run_dispatch()
        };

        let total_time = tick_timer.elapsed_ms();

        record_timing(&self.name, "tick-total", total_time);
        record_timing(&self.name, "dispatcher-dispatch", dispatch_time);
        record_timing(&self.name, "ecs-maintain", maintain_time);

        if perf::is_enabled() {
            let (messages_this_tick, messages_since_sample) =
                self.write_resource::<WorldPerfMetrics>().finish_tick();
            if let Some(messages_since_sample) = messages_since_sample {
                let tick = self.stats().tick;
                let (connected_clients, client_queue_depth) = {
                    let clients = self.clients();
                    (
                        clients.len(),
                        clients
                            .values()
                            .map(|client| client.sender.len())
                            .sum::<usize>(),
                    )
                };
                let (critical, normal, bulk) = self.read_resource::<MessageQueues>().queue_stats();
                let (encoded_pending, encoded_processed) =
                    self.read_resource::<EncodedMessageQueue>().queue_stats();
                let outbound_queue_depth = client_queue_depth
                    + critical
                    + normal
                    + bulk
                    + encoded_pending
                    + encoded_processed;
                let (state_slot_depth, state_dropped, state_gated_clients) = {
                    let state = self.read_resource::<ReplicatedStateBuffer>();
                    (
                        state.total_pending(),
                        state.dropped_updates(),
                        state.gated_clients(),
                    )
                };
                perf::log(
                    "core_tick",
                    &self.name,
                    json!({
                        "tick": tick,
                        "tickDurationMs": total_time,
                        "inboundQueueDepth": perf::inbound_depth(&self.name),
                        "outboundQueueDepth": outbound_queue_depth,
                        // Latest-wins state channel: pending coalesced slots,
                        // cumulative cap drops, clients gated on socket backlog.
                        "stateSlotDepth": state_slot_depth,
                        "stateDroppedUpdates": state_dropped,
                        "stateGatedClients": state_gated_clients,
                        "inboundStateDropped": self.inbound_state.dropped_total(),
                        "messagesProcessedThisTick": messages_this_tick,
                        "messagesProcessedSinceSample": messages_since_sample,
                        "connectedClients": connected_clients,
                    }),
                );
            }
        }
    }
}
