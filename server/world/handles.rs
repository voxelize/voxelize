use super::*;

/// A game's check on raw client voxel writes (`Update` messages), set with
/// [`World::set_raw_update_guard`]. It is handed the writes that landed
/// inside the world and returns the ones that may be applied.
pub(crate) struct RawUpdateGuard(
    pub(crate) Arc<
        dyn Fn(&mut World, &str, Vec<(Vec3<i32>, u32)>) -> Vec<(Vec3<i32>, u32)> + Send + Sync,
    >,
);

impl World {
    /// Puts a check in front of raw client voxel writes. The engine applies
    /// an `Update` message from any client as it stands; a game whose blocks
    /// own state (a container's contents live in its block entity, which a
    /// replacing write deletes) uses this to refuse such a write, or to act
    /// before it lands. The guard runs on the world thread, once per message,
    /// with the client id and the in-world writes in order.
    pub fn set_raw_update_guard<
        F: Fn(&mut World, &str, Vec<(Vec3<i32>, u32)>) -> Vec<(Vec3<i32>, u32)>
            + Send
            + Sync
            + 'static,
    >(
        &mut self,
        guard: F,
    ) {
        self.ecs_mut().insert(RawUpdateGuard(Arc::new(guard)));
    }

    pub fn set_dispatcher<
        F: Fn() -> TimedDispatcherBuilder<'static, 'static> + Send + Sync + 'static,
    >(
        &mut self,
        dispatch: F,
    ) {
        self.dispatcher = Arc::new(move || dispatch().into_inner());
    }

    pub fn set_client_modifier<F: Fn(&mut World, Entity) + Send + Sync + 'static>(
        &mut self,
        modifier: F,
    ) {
        self.client_modifier = Some(Arc::new(modifier));
    }

    pub fn set_client_leave_modifier<F: Fn(&mut World, Entity) + Send + Sync + 'static>(
        &mut self,
        modifier: F,
    ) {
        self.client_leave_modifier = Some(Arc::new(modifier));
    }

    pub fn set_client_parser<F: Fn(&mut World, &str, Entity) + Send + Sync + 'static>(
        &mut self,
        parser: F,
    ) {
        self.client_parser = Arc::new(parser);
    }

    pub fn set_method_handle<F: Fn(&mut World, &str, &str) + Send + Sync + 'static>(
        &mut self,
        method: &str,
        handle: F,
    ) {
        self.method_handles
            .insert(method.to_lowercase(), Arc::new(handle));
    }

    /// The handler currently registered for `method`, if any. A game uses it
    /// to put its own checks in front of a builtin (read the old handler,
    /// then `set_method_handle` a wrapper that calls it) instead of copying
    /// the builtin's body.
    pub fn method_handle(
        &self,
        method: &str,
    ) -> Option<Arc<dyn Fn(&mut World, &str, &str) + Send + Sync>> {
        self.method_handles.get(&method.to_lowercase()).cloned()
    }

    pub fn set_event_handle<F: Fn(&mut World, &str, &str) + Send + Sync + 'static>(
        &mut self,
        event: &str,
        handle: F,
    ) {
        self.event_handles
            .insert(event.to_lowercase(), Arc::new(handle));
    }

    pub fn set_transport_handle<F: Fn(&mut World, Value) + Send + Sync + 'static>(
        &mut self,
        handle: F,
    ) {
        self.transport_handle = Some(Arc::new(handle));
    }

    pub fn set_command_handle<F: Fn(&mut World, &str, &str) + Send + Sync + 'static>(
        &mut self,
        handle: F,
    ) {
        self.command_handle = Some(Arc::new(handle));
    }

    pub fn set_extra_init_data(&mut self, key: &str, value: serde_json::Value) {
        self.extra_init_data.insert(key.to_owned(), value);
    }

    pub fn set_item_registry(&mut self, registry: ItemRegistry) {
        self.items = Some(registry);
    }

    pub fn item_registry(&self) -> Option<&ItemRegistry> {
        self.items.as_ref()
    }

    pub fn set_entity_loader<
        F: Fn(&mut World, MetadataComp) -> EntityBuilder + Send + Sync + 'static,
    >(
        &mut self,
        etype: &str,
        loader: F,
    ) {
        self.entity_loaders
            .insert(etype.to_lowercase(), Arc::new(loader));
    }

    pub fn has_entity_loader(&self, etype: &str) -> bool {
        self.entity_loaders.contains_key(&etype.to_lowercase())
    }

    /// Every registered entity loader type, sorted. Spawn methods that must
    /// reject an unknown type read this to name what a caller could have
    /// asked for instead of dropping the request in silence.
    pub fn entity_loader_types(&self) -> Vec<String> {
        let mut types: Vec<String> = self.entity_loaders.keys().cloned().collect();
        types.sort();
        types
    }
}

#[cfg(test)]
mod raw_update_guard_tests {
    use super::*;
    use crate::UpdateProtocol;

    fn update(vx: i32, voxel: u32) -> UpdateProtocol {
        UpdateProtocol {
            vx,
            vy: 2,
            vz: 3,
            voxel,
            light: 0,
        }
    }

    /// A raw client `Update` reaches the chunks only through the game's
    /// guard, which sees who sent it and every in-world write, in order.
    #[test]
    fn the_raw_update_guard_decides_which_client_writes_land() {
        let config = WorldConfig::new().saving(false).build();
        let mut world = World::new("raw-update-guard", &config);
        world.ecs_mut().insert(Registry::new());
        let seen: Arc<Mutex<Vec<(String, Vec<(Vec3<i32>, u32)>)>>> = Arc::default();
        let seen_by_guard = seen.clone();
        world.set_raw_update_guard(move |_, client_id, writes| {
            seen_by_guard
                .lock()
                .unwrap()
                .push((client_id.to_owned(), writes.clone()));
            writes.into_iter().filter(|(voxel, _)| voxel.0 != 1).collect()
        });

        let message = Message::new(&MessageType::Update)
            .updates(&[update(1, 5), update(4, 6)])
            .build();
        world.on_update("client-a", message);

        assert_eq!(
            seen.lock().unwrap().as_slice(),
            &[(
                "client-a".to_owned(),
                vec![(Vec3(1, 2, 3), 5), (Vec3(4, 2, 3), 6)]
            )]
        );
        let mut chunks = world.chunks_mut();
        chunks.flush_staged_updates();
        let refused = Vec3(1, 2, 3);
        let landed = Vec3(4, 2, 3);
        assert!(chunks.pending_updates_in_bounds(&refused, &refused).is_empty());
        assert_eq!(
            chunks.pending_updates_in_bounds(&landed, &landed).get(&landed),
            Some(&6)
        );
    }
}
