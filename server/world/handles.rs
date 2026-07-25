use super::*;

impl World {
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
