use super::*;

// Create a new struct that will be the actual actor
pub struct SyncWorld(pub(super) Arc<std::sync::RwLock<World>>);

impl Actor for SyncWorld {
    type Context = SyncContext<Self>;
}

// Implement handler for Tick message
impl Handler<Tick> for SyncWorld {
    type Result = ();

    fn handle(&mut self, _: Tick, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().tick();
    }
}

impl Handler<Prepare> for SyncWorld {
    type Result = ();

    fn handle(&mut self, _: Prepare, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().prepare();
    }
}

impl Handler<GetConfig> for SyncWorld {
    type Result = MessageResult<GetConfig>;

    fn handle(&mut self, _: GetConfig, _: &mut SyncContext<Self>) -> Self::Result {
        MessageResult(self.0.read().unwrap().config().make_copy())
    }
}

impl Handler<GetInfo> for SyncWorld {
    type Result = MessageResult<GetInfo>;

    fn handle(&mut self, _: GetInfo, _: &mut SyncContext<Self>) -> Self::Result {
        let world = self.0.read().unwrap();
        let config = world.config().make_copy();
        MessageResult(WorldInfo {
            name: world.name.clone(),
            config,
            preloading: world.preloading,
            preload_progress: world.preload_progress,
        })
    }
}

impl Handler<GetWorldStats> for SyncWorld {
    type Result = MessageResult<GetWorldStats>;

    fn handle(&mut self, _: GetWorldStats, _: &mut SyncContext<Self>) -> Self::Result {
        let world = self.0.read().unwrap();
        MessageResult(world.get_stats())
    }
}

impl Handler<Preload> for SyncWorld {
    type Result = ();

    fn handle(&mut self, _: Preload, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().preload();
    }
}

// Implement handler for ClientRequest message
impl Handler<ClientRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: ClientRequest, _: &mut SyncContext<Self>) {
        let world_name = self.0.read().unwrap().name.clone();
        perf::decrement_inbound(&world_name);
        // Avoid poisoning the world RwLock if a handler panics.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.0.write().unwrap().on_request(&msg.client_id, msg.data)
        }));
        if let Err(err) = result {
            error!(
                "ClientRequest handler panicked (world lock recovered): {:?}",
                err
            );
        }
    }
}

impl Handler<ClientJoinRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: ClientJoinRequest, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().add_client(
            &msg.id,
            &msg.username,
            &msg.sender,
            msg.preferences,
            msg.motion_protocol,
        );
    }
}

impl Handler<ClientLeaveRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: ClientLeaveRequest, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().remove_client(&msg.id);
    }
}

impl Handler<TransportJoinRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: TransportJoinRequest, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().add_transport(&msg.id, &msg.sender);
    }
}

impl Handler<TransportLeaveRequest> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: TransportLeaveRequest, _: &mut SyncContext<Self>) {
        self.0.write().unwrap().remove_transport(&msg.id);
    }
}

impl Handler<Teardown> for SyncWorld {
    type Result = ();

    fn handle(&mut self, _: Teardown, ctx: &mut SyncContext<Self>) {
        // Same single thread as `Tick`; actix mailboxes are FIFO, so this runs
        // strictly after any in-flight tick returns. Freeing here can never
        // race a dispatch borrow (the #129 hazard).
        if let Ok(mut world) = self.0.write() {
            world.teardown();
        }
        ctx.stop();
    }
}

impl Handler<ResetWorld> for SyncWorld {
    type Result = ();

    fn handle(&mut self, msg: ResetWorld, _: &mut SyncContext<Self>) {
        if let Ok(mut world) = self.0.write() {
            world.reset();
            world.rename(&msg.name);
        }
    }
}
