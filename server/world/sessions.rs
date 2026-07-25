use super::*;

impl World {
    /// Add a transport sender to this world.
    pub(crate) fn add_transport(&mut self, id: &str, sender: &WsSender) {
        let (init_message, _) = self.generate_init_message(id, None, None, None, None, None, true);
        self.send(sender, &init_message);
        self.write_resource::<Transports>()
            .insert(id.to_owned(), sender.clone());
    }

    /// Remove a transport address from this world.
    pub(crate) fn remove_transport(&mut self, id: &str) {
        self.write_resource::<Transports>().remove(id);
    }

    /// Add a client to the world by an ID and a WebSocket sender.
    ///
    /// IDEMPOTENT by design: JOIN is reliable control-plane (see
    /// `world::replication`) and its acknowledgement (the INIT message) can be
    /// delayed or lost, so clients retry. A join for an id that already has a
    /// live entity refreshes the session (sender, username, preferences) and
    /// replays the INIT ack against that entity — it never creates a
    /// duplicate entity or a second session.
    pub(crate) fn add_client(
        &mut self,
        id: &str,
        username: &str,
        sender: &WsSender,
        preferences: ClientPreferencesPatch,
        motion_protocol: MotionProtocol,
    ) {
        let existing_ent = self.clients().get(id).map(|client| client.entity);
        let is_rejoin = existing_ent.is_some();

        let ent = if let Some(ent) = existing_ent {
            {
                let mut names = self.write_component::<NameComp>();
                if let Some(name) = names.get_mut(ent) {
                    name.0 = username.to_owned();
                }
            }
            {
                let mut addrs = self.write_component::<AddrComp>();
                if let Some(addr) = addrs.get_mut(ent) {
                    *addr = AddrComp::new(sender);
                }
            }
            apply_client_preferences_patch(self, ent, &preferences);
            ent
        } else {
            let body =
                RigidBody::new(&AABB::new().scale_x(0.8).scale_y(1.8).scale_z(0.8).build())
                    .build();

            let interactor = self.physics_mut().register(&body);

            let ent = self
                .ecs
                .create_entity()
                .with(ClientFlag::default())
                .with(ClientPreferencesComp(
                    ClientPreferences::default().apply_patch(preferences),
                ))
                .with(IDComp::new(id))
                .with(NameComp::new(username))
                .with(AddrComp::new(sender))
                .with(ChunkRequestsComp::default())
                .with(CurrentChunkComp::default())
                .with(MetadataComp::default())
                .with(PositionComp::default())
                .with(DirectionComp::default())
                .with(RigidBodyComp::new(&body))
                .with(InteractorComp::new(&interactor))
                .with(CollisionsComp::new())
                .build();

            if let Some(modifier) = self.client_modifier.to_owned() {
                modifier(self, ent);
            }

            ent
        };

        let saved_position = self
            .read_component::<PositionComp>()
            .get(ent)
            .map(|p| [p.0 .0, p.0 .1, p.0 .2])
            .filter(|p| p[0] != 0.0 || p[1] != 0.0 || p[2] != 0.0);

        let saved_direction = self
            .read_component::<DirectionComp>()
            .get(ent)
            .map(|d| [d.0 .0, d.0 .1, d.0 .2])
            .filter(|d| d[0] != 0.0 || d[1] != 0.0 || d[2] != 0.0);

        let saved_is_flying = self
            .read_component::<RigidBodyComp>()
            .get(ent)
            .map(|body| body.0.gravity_multiplier == 0.0 && body.0.aabb.width() > 0.0);

        let saved_is_ghost = self
            .read_component::<RigidBodyComp>()
            .get(ent)
            .map(|body| body.0.aabb.width() <= 0.0);
        let saved_is_swimming = self
            .read_component::<RigidBodyComp>()
            .get(ent)
            .map(|body| body.0.is_swimming);

        // Deterministic peer re-sync on membership change: force every
        // client's peer metadata dirty so the next peers-sending run stages a
        // full snapshot of everyone to everyone. Bidirectional visibility
        // must NOT depend on the one-tick metadata dirty flag happening to
        // fire after this join — an idle existing player would otherwise
        // never be re-announced to the newcomer, and (worse) the newcomer's
        // single dirty tick is the only tick existing clients would ever hear
        // about it on.
        {
            let flags = self.ecs.read_storage::<ClientFlag>();
            let mut metadatas = self.ecs.write_storage::<MetadataComp>();
            for (metadata, _) in (&mut metadatas, &flags).join() {
                metadata.mark_dirty();
            }
        }

        // The INIT ack below makes the client release every entity it was
        // tracking (a join or rejoin starts a fresh interest session).
        // Mirror that server-side: drop the client's tracked entity
        // interests and its pending outbound state, so the next
        // entities-sending tick re-CREATEs everything in range with a full
        // reliable snapshot and no state staged for the previous session can
        // leak in after the INIT.
        self.bookkeeping_mut().remove_client(id);
        self.write_resource::<ReplicatedStateBuffer>()
            .remove_client(id);

        let (init_message, init_entity_ids) = self.generate_init_message(
            id,
            saved_position,
            saved_direction,
            saved_is_flying,
            saved_is_ghost,
            saved_is_swimming,
            false,
        );

        if is_rejoin {
            if let Some(client) = self.clients_mut().get_mut(id) {
                client.username = username.to_owned();
                client.sender = sender.clone();
                client.motion_protocol = motion_protocol;
            }
        } else {
            self.clients_mut().insert(
                id.to_owned(),
                Client {
                    id: id.to_owned(),
                    entity: ent,
                    username: username.to_owned(),
                    sender: sender.clone(),
                    motion_protocol,
                },
            );

            self.entity_ids_mut().insert(id.to_owned(), ent.id());
        }

        {
            let tick = self.read_resource::<Stats>().tick;
            let mut bookkeeping = self.write_resource::<Bookkeeping>();
            for entity_id in init_entity_ids {
                bookkeeping.interests.track(id, &entity_id, tick);
            }
        }

        // The INIT message is the JOIN acknowledgement: reliable control-plane
        // sent directly on the session's ordered channel, replayed on retries.
        self.send(sender, &init_message);

        if !is_rejoin {
            let join_message = Message::new(&MessageType::Join).text(id).build();
            self.broadcast(join_message, ClientFilter::All);
        }

        perf::log(
            "client_join",
            &self.name,
            json!({
                "clientId": id,
                "outcome": if is_rejoin { "replayed" } else { "created" },
                "connectedClients": self.clients().len(),
            }),
        );

        info!(
            "Client at {} {} world: {}",
            id,
            if is_rejoin {
                "replayed join for"
            } else {
                "joined the server to"
            },
            self.name
        );
    }

    /// Remove a client from the world by endpoint.
    pub(crate) fn remove_client(&mut self, id: &str) {
        let removed = self.clients_mut().remove(id);
        self.entity_ids_mut().remove(id);
        self.chunk_interest_mut().remove_client(id);
        self.bookkeeping_mut().remove_client(id);
        self.inbound_state.remove_client(id);
        {
            // Drop the client's pending outbound state and purge its peer
            // snapshots everywhere: the reliable LEAVE event below is what
            // removes the peer client-side, and state staged before it must
            // not be delivered after it.
            let mut state = self.write_resource::<ReplicatedStateBuffer>();
            state.remove_client(id);
            state.remove_peer(id);
        }

        if let Some(client) = removed {
            if let Some(handler) = self.client_leave_modifier.to_owned() {
                handler(self, client.entity);
            }

            let mut should_delete_entity = true;

            {
                let interactors = self.ecs.read_storage::<InteractorComp>();

                // Safely get the interactor component, with error handling
                let interactor_result = interactors
                    .get(client.entity)
                    .map(|interactor| interactor.to_owned());

                if let Some(interactor) = interactor_result {
                    let body_handle = interactor.body_handle().to_owned();
                    let collider_handle = interactor.collider_handle().to_owned();

                    drop(interactors);

                    {
                        let mut physics = self.physics_mut();
                        physics.unregister(&body_handle, &collider_handle);
                    }

                    {
                        let mut interactors = self.ecs.write_storage::<InteractorComp>();
                        interactors.remove(client.entity);
                    }

                    {
                        let mut collisions = self.ecs.write_storage::<CollisionsComp>();
                        collisions.remove(client.entity);
                    }

                    {
                        let mut rigid_bodies = self.ecs.write_storage::<RigidBodyComp>();
                        rigid_bodies.remove(client.entity);
                    }

                    {
                        let mut clients = self.ecs.write_storage::<ClientFlag>();
                        clients.remove(client.entity);
                    }
                } else {
                    // If we can't find the interactor, the entity might already be deleted or invalid
                    should_delete_entity = false;
                    log::warn!(
                        "Client entity for {} not found or already removed",
                        client.id
                    );
                }
            }

            if should_delete_entity {
                let entities = self.ecs.entities();

                // Safe deletion with error handling
                if let Err(e) = entities.delete(client.entity) {
                    log::warn!("Error deleting client entity {}: {:?}", client.id, e);
                }
            }

            self.ecs.maintain();

            let leave_message = Message::new(&MessageType::Leave).text(&client.id).build();
            self.broadcast(leave_message, ClientFilter::All);
            perf::log(
                "client_leave",
                &self.name,
                json!({
                    "clientId": id,
                    "connectedClients": self.clients().len(),
                }),
            );
            info!("Client at {} left the world: {}", id, self.name);
        }
    }
}
