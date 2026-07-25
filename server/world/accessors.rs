use super::*;

impl World {
    /// Get a reference to the ECS world..
    pub fn ecs(&self) -> &ECSWorld {
        &self.ecs
    }

    /// Get a mutable reference to the ECS world.
    pub fn ecs_mut(&mut self) -> &mut ECSWorld {
        &mut self.ecs
    }

    /// Insert a component into an entity.
    pub fn add<T: Component>(&mut self, e: Entity, c: T) {
        let mut storage: WriteStorage<T> = SystemData::fetch(self.ecs());
        storage.insert(e, c).unwrap();
    }

    /// Remove a component type from an entity.
    pub fn remove<T: Component>(&mut self, e: Entity) {
        let mut storage: WriteStorage<T> = SystemData::fetch(self.ecs());
        storage.remove(e);
    }

    /// Read an ECS resource generically.
    pub fn read_resource<T: Resource>(&self) -> Fetch<'_, T> {
        self.ecs.read_resource::<T>()
    }

    /// Write an ECS resource generically.
    pub fn write_resource<T: Resource>(&mut self) -> FetchMut<'_, T> {
        self.ecs.write_resource::<T>()
    }

    /// Read an ECS component storage.
    pub fn read_component<T: Component>(&self) -> ReadStorage<'_, T> {
        self.ecs.read_component::<T>()
    }

    /// Write an ECS component storage.
    pub fn write_component<T: Component>(&mut self) -> WriteStorage<'_, T> {
        self.ecs.write_component::<T>()
    }

    /// Get an ID from IDComp from an entity
    pub fn get_id(&self, entity: Entity) -> String {
        if let Some(id) = self.read_component::<IDComp>().get(entity) {
            id.0.to_owned()
        } else {
            panic!("Something went wrong! An entity does not have an `IDComp` attached!");
        }
    }

    /// Broadcast a protobuf message to a subset or all of the clients in the world.
    pub fn broadcast(&mut self, data: Message, filter: ClientFilter) {
        self.write_resource::<MessageQueues>().push((data, filter));
    }

    /// Send a direct message to an endpoint
    pub fn send(&self, sender: &WsSender, data: &Message) {
        let _ = sender.send(encode_message(data));
    }

    /// Access to the world's config.
    pub fn config(&self) -> Fetch<'_, WorldConfig> {
        self.read_resource::<WorldConfig>()
    }

    /// Access all clients in the ECS world.
    pub fn clients(&self) -> Fetch<'_, Clients> {
        self.read_resource::<Clients>()
    }

    /// Access a mutable clients map in the ECS world.
    pub fn clients_mut(&mut self) -> FetchMut<'_, Clients> {
        self.write_resource::<Clients>()
    }

    /// Get world statistics for observability.
    pub fn get_stats(&self) -> WorldStatsResponse {
        let clients = self.read_resource::<Clients>();
        let entity_ids = self.read_resource::<EntityIDs>();
        let message_queues = self.read_resource::<MessageQueues>();
        let encoded_queue = self.read_resource::<EncodedMessageQueue>();

        let (critical, normal, bulk) = message_queues.queue_stats();
        let (pending, processed) = encoded_queue.queue_stats();

        WorldStatsResponse {
            name: self.name.clone(),
            client_count: clients.len(),
            entity_count: entity_ids.len(),
            message_queue_critical: critical,
            message_queue_normal: normal,
            message_queue_bulk: bulk,
            encoded_pending: pending,
            encoded_processed: processed,
        }
    }

    /// Access all entity IDs in the ECS world.
    pub fn entity_ids(&self) -> Fetch<'_, EntityIDs> {
        self.read_resource::<EntityIDs>()
    }

    /// Access a mutable entity IDs map in the ECS world.
    pub fn entity_ids_mut(&mut self) -> FetchMut<'_, EntityIDs> {
        self.write_resource::<EntityIDs>()
    }

    /// Access the registry in the ECS world.
    pub fn registry(&self) -> Fetch<'_, Registry> {
        self.read_resource::<Registry>()
    }

    /// Access chunks management in the ECS world.
    pub fn chunks(&self) -> Fetch<'_, Chunks> {
        self.read_resource::<Chunks>()
    }

    /// Access a mutable chunk manager in the ECS world.
    pub fn chunks_mut(&mut self) -> FetchMut<'_, Chunks> {
        self.write_resource::<Chunks>()
    }

    /// Access physics management in the ECS world.
    pub fn physics(&self) -> Fetch<'_, Physics> {
        self.read_resource::<Physics>()
    }

    /// Access a mutable physics manager in the ECS world.
    pub fn physics_mut(&mut self) -> FetchMut<'_, Physics> {
        self.write_resource::<Physics>()
    }

    /// Access the chunk interests manager in the ECS world.
    pub fn chunk_interest(&self) -> Fetch<'_, ChunkInterests> {
        self.read_resource::<ChunkInterests>()
    }

    /// Access the mutable chunk interest manager in the ECS world.
    pub fn chunk_interest_mut(&mut self) -> FetchMut<'_, ChunkInterests> {
        self.write_resource::<ChunkInterests>()
    }

    /// Access the bookkeeping in the ECS world.
    pub fn bookkeeping(&self) -> Fetch<'_, Bookkeeping> {
        self.read_resource::<Bookkeeping>()
    }

    /// Access the mutable bookkeeping in the ECS world.
    pub fn bookkeeping_mut(&mut self) -> FetchMut<'_, Bookkeeping> {
        self.write_resource::<Bookkeeping>()
    }

    /// Access the event queue in the ECS world.
    pub fn events(&self) -> Fetch<'_, Events> {
        self.read_resource::<Events>()
    }

    /// Access the mutable events queue in the ECS world.
    pub fn events_mut(&mut self) -> FetchMut<'_, Events> {
        self.write_resource::<Events>()
    }

    /// Access the stats manager in the ECS world.
    pub fn stats(&self) -> Fetch<'_, Stats> {
        self.read_resource::<Stats>()
    }

    /// Access the mutable stats manager in the ECS world.
    pub fn stats_mut(&mut self) -> FetchMut<'_, Stats> {
        self.write_resource::<Stats>()
    }

    /// Access pipeline management in the ECS world.
    pub fn pipeline(&self) -> Fetch<'_, Pipeline> {
        self.read_resource::<Pipeline>()
    }

    /// Access a mutable pipeline management in the ECS world.
    pub fn pipeline_mut(&mut self) -> FetchMut<'_, Pipeline> {
        self.write_resource::<Pipeline>()
    }

    /// Access the mesher in the ECS world.
    pub fn mesher(&self) -> Fetch<'_, Mesher> {
        self.read_resource::<Mesher>()
    }

    /// Access a mutable mesher in the ECS world.
    pub fn mesher_mut(&mut self) -> FetchMut<'_, Mesher> {
        self.write_resource::<Mesher>()
    }
}
