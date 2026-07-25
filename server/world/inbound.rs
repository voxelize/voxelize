use super::*;

#[derive(Serialize, Deserialize)]
struct OnLoadRequest {
    center: Vec2<i32>,
    direction: Vec2<f32>,
    chunks: Vec<Vec2<i32>>,
}

#[derive(Serialize, Deserialize)]
struct OnUnloadRequest {
    chunks: Vec<Vec2<i32>>,
}

#[derive(Serialize, Deserialize)]
struct OnEventRequest {
    name: String,
    payload: Value,
}

impl World {
    /// Handler for protobuf requests from clients.
    pub(crate) fn on_request(&mut self, client_id: &str, data: Message) {
        // State-before-command: any position packets staged ahead of this
        // request must be visible to its handler.
        self.apply_inbound_state();

        if perf::is_enabled() {
            self.write_resource::<WorldPerfMetrics>().record_message();
            if data.r#type == MessageType::Chat as i32 {
                if let Some(mut fields) = perf::chat_fields(&data) {
                    if let Value::Object(ref mut values) = fields {
                        values.insert("clientId".to_owned(), json!(client_id));
                        values.insert("tick".to_owned(), json!(self.stats().tick));
                    }
                    perf::log("chat_core_process", &self.name, fields);
                }
            }
        }
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(client_id, data),
            MessageType::Load => self.on_load(client_id, data),
            MessageType::Unload => self.on_unload(client_id, data),
            MessageType::Method => self.on_method(client_id, data),
            MessageType::Chat => self.on_chat(client_id, data),
            MessageType::Update => self.on_update(client_id, data),
            MessageType::Event => self.on_event(client_id, data),
            MessageType::Transport => {
                if self.transport_handle.is_none() {
                    warn!("Transport calls are being called, but no transport handlers set!");
                } else {
                    let handle = self.transport_handle.as_ref().unwrap().to_owned();

                    handle(
                        self,
                        serde_json::from_str(&data.json)
                            .expect("Something went wrong with the transport JSON value."),
                    );
                }
            }
            _ => {
                info!("Received message with unrecognized type: {:?}", msg_type);
            }
        }
    }

    /// Handler for `Peer` type messages.
    pub(super) fn on_peer(&mut self, client_id: &str, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(client_id) {
            client.entity.to_owned()
        } else {
            return;
        };

        data.peers.into_iter().for_each(|peer| {
            let Peer {
                metadata, username, ..
            } = peer;

            {
                let mut names = self.write_component::<NameComp>();
                if let Some(n) = names.get_mut(client_ent) {
                    n.0 = username.to_owned();
                }
            }

            self.client_parser.clone()(self, &metadata, client_ent);

            if let Some(client) = self.clients_mut().get_mut(client_id) {
                client.username = username;
            }
        })
    }

    /// Handler for `Load` type messages.
    pub(super) fn on_load(&mut self, client_id: &str, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(client_id) {
            client.entity.to_owned()
        } else {
            return;
        };

        let json: OnLoadRequest = match serde_json::from_str(&data.json) {
            Ok(json) => json,
            Err(e) => {
                warn!("`on_load` error. Could not read JSON string: {}", data.json);
                return;
            }
        };

        let chunks = json.chunks;
        if chunks.is_empty() {
            return;
        }

        {
            let mut storage = self.write_component::<ChunkRequestsComp>();

            // Check for component existence
            if let Some(requests) = storage.get_mut(client_ent) {
                chunks.iter().for_each(|coords| {
                    requests.add(coords);
                });

                requests.set_center(&json.center);
                requests.set_direction(&json.direction);
                requests.sort();
            } else {
                warn!(
                    "Client entity doesn't have ChunkRequestsComp component: {}",
                    client_id
                );
                //TODO: We could re-add the component here, server doesn't panic now though
            }
        }
    }

    /// Handler for `Unload` type messages.
    pub(super) fn on_unload(&mut self, client_id: &str, data: Message) {
        let client_ent = if let Some(client) = self.clients().get(client_id) {
            client.entity.to_owned()
        } else {
            return;
        };

        let json: OnUnloadRequest = match serde_json::from_str(&data.json) {
            Ok(json) => json,
            Err(e) => {
                warn!(
                    "`on_unload` error. Could not read JSON string: {}",
                    data.json
                );
                return;
            }
        };

        let chunks = json.chunks;
        if chunks.is_empty() {
            return;
        }

        {
            let mut storage = self.write_component::<ChunkRequestsComp>();

            if let Some(requests) = storage.get_mut(client_ent) {
                chunks.iter().for_each(|coords| {
                    requests.remove(coords);
                });
            }
        }

        {
            let mut interests = self.chunk_interest_mut();

            let mut to_remove = Vec::new();

            chunks.iter().for_each(|coords| {
                interests.remove(client_id, coords);

                if !interests.has_interests(coords) {
                    to_remove.push(coords);
                }
            });

            drop(interests);

            to_remove.into_iter().for_each(|coords| {
                self.pipeline_mut().remove_chunk(coords);
                self.mesher_mut().remove_chunk(coords);
            })
        }
    }

    /// Handler for `Update` type messages.
    pub(super) fn on_update(&mut self, _: &str, data: Message) {
        let chunk_size = self.config().chunk_size;
        let allow_client_writes = self.config().allow_client_voxel_writes;
        let mut chunks = self.chunks_mut();

        if let Some(bulk) = data.bulk_update {
            for i in 0..bulk.vx.len() {
                let vx = bulk.vx[i];
                let vy = bulk.vy[i];
                let vz = bulk.vz[i];
                let voxel = bulk.voxels[i];

                let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);

                if !chunks.is_within_world(&coords) {
                    continue;
                }

                if !allow_client_writes {
                    let n = CLIENT_VOXEL_UPDATE_REJECTED.fetch_add(1, Ordering::Relaxed) + 1;
                    debug!(
                        "rejected client bulk voxel write #{n} at ({vx},{vy},{vz}) -> {voxel} (allow_client_voxel_writes=false)"
                    );
                    continue;
                }

                chunks.update_voxel(&Vec3(vx, vy, vz), voxel);
            }
        } else {
            data.updates.into_iter().for_each(|update| {
                let coords =
                    ChunkUtils::map_voxel_to_chunk(update.vx, update.vy, update.vz, chunk_size);

                if !chunks.is_within_world(&coords) {
                    return;
                }

                if !allow_client_writes {
                    let n = CLIENT_VOXEL_UPDATE_REJECTED.fetch_add(1, Ordering::Relaxed) + 1;
                    debug!(
                        "rejected client voxel write #{n} at ({},{},{}) -> {} (allow_client_voxel_writes=false)",
                        update.vx, update.vy, update.vz, update.voxel
                    );
                    return;
                }

                chunks.update_voxel(&Vec3(update.vx, update.vy, update.vz), update.voxel);
            });
        }
    }

    /// Handler for `Method` type messages.
    pub(super) fn on_method(&mut self, client_id: &str, data: Message) {
        if let Some(method) = data.method {
            let key = method.name.to_lowercase();
            let Some(handle) = self.method_handles.get(&key).map(|h| h.to_owned()) else {
                warn!(
                    "`Method` type messages received of name {}, but no method handler set.",
                    method.name
                );
                return;
            };

            // Method payloads are client-supplied input. A panicking handler
            // (e.g. an unknown block name lookup) must not unwind through the
            // actor and take the whole world down with it.
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                handle(self, client_id, &method.payload);
            }));

            if let Err(panic) = result {
                let reason = panic
                    .downcast_ref::<String>()
                    .map(|s| s.as_str())
                    .or_else(|| panic.downcast_ref::<&str>().copied())
                    .unwrap_or("unknown panic");
                warn!(
                    "Method handler '{}' panicked in world '{}': {}. Continuing.",
                    method.name, self.name, reason
                );
            }
        }
    }

    /// Handler for `Event` type messages.
    pub(super) fn on_event(&mut self, client_id: &str, data: Message) {
        let client_ent = self.clients().get(client_id).map(|c| c.entity.to_owned());

        data.events.into_iter().for_each(|event| {
            if !self.event_handles.contains_key(&event.name.to_lowercase()) {
                let location = client_ent.and_then(|ent| {
                    self.read_component::<CurrentChunkComp>()
                        .get(ent)
                        .map(|c| c.coords.clone())
                });

                let mut event_builder = if event.name == VOXELIZE_BUILTIN_SOUND_EFFECT_EVENT {
                    let Ok(payload) = serde_json::from_str::<SoundEffectEvent>(&event.payload)
                    else {
                        return;
                    };
                    Event::sound_effect(payload.source_client_id(client_id))
                        .filter(ClientFilter::Exclude(vec![client_id.to_owned()]))
                } else {
                    Event::new(&event.name).payload(event.payload)
                };
                if let Some(loc) = location {
                    event_builder = event_builder.location(loc);
                }
                self.events_mut().dispatch(event_builder.build());
                return;
            }

            let handle = self.event_handles.get(&event.name).unwrap().to_owned();
            handle(self, client_id, &event.payload);
        });
    }

    /// Handler for `Chat` type messages.
    pub(super) fn on_chat(&mut self, id: &str, data: Message) {
        if let Some(chat) = data.chat.clone() {
            let sender = chat.sender.clone();
            let body = chat.body.clone();

            info!("{}: {}", sender, body);

            let command_symbol = self.config().command_symbol.to_owned();

            if body.starts_with(&command_symbol) {
                if let Some(handle) = self.command_handle.to_owned() {
                    handle(self, id, body.strip_prefix(&command_symbol).unwrap());
                } else {
                    warn!("Clients are sending commands, but no command handler set.");
                }
            } else {
                self.broadcast(data, ClientFilter::All);
            }
        }
    }

    pub(super) fn generate_init_message(
        &self,
        id: &str,
        saved_position: Option<[f32; 3]>,
        saved_direction: Option<[f32; 3]>,
        saved_is_flying: Option<bool>,
        saved_is_ghost: Option<bool>,
        saved_is_swimming: Option<bool>,
        is_for_transport: bool,
    ) -> (Message, Vec<String>) {
        let config = (*self.config()).to_owned();
        let mut json = HashMap::new();

        json.insert("id".to_owned(), json!(id));
        json.insert("blocks".to_owned(), json!(self.registry().blocks_by_name));
        json.insert("options".to_owned(), json!(config));
        json.insert(
            "stats".to_owned(),
            json!(self.read_resource::<Stats>().get_stats()),
        );

        if let Some(pos) = saved_position {
            json.insert("savedPosition".to_owned(), json!(pos));
        }
        if let Some(dir) = saved_direction {
            json.insert("savedDirection".to_owned(), json!(dir));
        }
        if let Some(is_flying) = saved_is_flying {
            json.insert("savedIsFlying".to_owned(), json!(is_flying));
        }
        if let Some(is_ghost) = saved_is_ghost {
            json.insert("savedIsGhost".to_owned(), json!(is_ghost));
        }
        if let Some(is_swimming) = saved_is_swimming {
            json.insert("savedIsSwimming".to_owned(), json!(is_swimming));
        }

        if let Some(items) = &self.items {
            json.insert("items".to_owned(), items.to_client_json());
        }

        for (key, value) in &self.extra_init_data {
            json.insert(key.clone(), value.clone());
        }

        /* ------------------------ Loading other the clients ----------------------- */
        let ids = self.read_component::<IDComp>();
        let flags = self.read_component::<ClientFlag>();
        let names = self.read_component::<NameComp>();
        let metadatas = self.read_component::<MetadataComp>();

        let mut peers = vec![];

        for (pid, name, metadata, _) in (&ids, &names, &metadatas, &flags).join() {
            peers.push(PeerProtocol {
                id: pid.0.to_owned(),
                username: name.0.to_owned(),
                metadata: metadata.to_string(),
            })
        }

        /* -------------------------- Loading entities -------------------------- */
        // Clients only receive block entities up front; positioned entities
        // stream in through the per-client interest sets in the entities-sending
        // system. Transports observe the whole world, so they get everything.
        let etypes = self.read_component::<ETypeComp>();
        let metadatas = self.read_component::<MetadataComp>();

        let mut entities = vec![];
        let mut entity_ids = vec![];

        for (id, etype, metadata) in (&ids, &etypes, &metadatas).join() {
            let is_block_entity = etype.0.starts_with("block::");

            if !is_block_entity && (!is_for_transport || metadata.is_empty()) {
                continue;
            }

            let j_str = metadata.to_string();

            entity_ids.push(id.0.to_owned());
            entities.push(EntityProtocol {
                operation: EntityOperation::Update,
                id: id.0.to_owned(),
                r#type: etype.0.to_owned(),
                metadata: Some(j_str),
                motion: None,
            });
        }

        drop(ids);
        drop(etypes);
        drop(metadatas);

        (
            Message::new(&MessageType::Init)
                .world_name(&self.name)
                .json(&serde_json::to_string(&json).unwrap())
                .peers(&peers)
                .entities(&entities)
                .build(),
            entity_ids,
        )
    }
}
