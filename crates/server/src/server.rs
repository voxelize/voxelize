use std::sync::Arc;

use actix::{Actor, AsyncContext, Context};

use crate::world::EventReactor;

/// A Voxelize server is a websocket server that listens for connections from
/// clients and processes all in-game events.
///
/// The server will also be an Actix actor, which means it can receive messages
/// from other actors or send messages to other actors.
pub struct Server {
    /// The interval at which the server runs each update.
    pub update_interval: std::time::Duration,

    pub event_reactors: Vec<Arc<dyn EventReactor>>,
}

impl Server {
    /// Creates a new server.
    pub fn new() -> Self {
        Self {
            update_interval: crate::constants::DEFAULT_SERVER_TICK_INTERVAL,
            event_reactors: Vec::new(),
        }
    }

    pub fn react<T: EventReactor + 'static>(&mut self, event_reactor: T) {
        self.event_reactors.push(Arc::new(event_reactor));
    }

    /// Updates the server state.
    pub fn update(&mut self) {}
}

impl Actor for Server {
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        ctx.run_interval(self.update_interval, |act, _| {
            act.update();
        });
    }
}
