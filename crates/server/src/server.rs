use actix::{Actor, AsyncContext, Context};
use hashbrown::HashMap;

use crate::World;

pub struct StartSession {
    pub id: String,
    pub world_id: String,
}

/// A Voxelize server is a websocket server that listens for connections from
/// clients and processes all in-game events.
///
/// The server will also be an Actix actor, which means it can receive messages
/// from other actors or send messages to other actors.
pub struct Server {
    /// The interval at which the server runs each update.
    pub update_interval: std::time::Duration,

    /// A list of worlds that the server manages.
    pub worlds: Vec<Box<dyn World>>,
}

impl Server {
    /// Creates a new server.
    pub fn new() -> Self {
        Self {
            update_interval: crate::constants::DEFAULT_SERVER_TICK_INTERVAL,
            worlds: vec![],
        }
    }

    pub fn add_world<T: World + 'static>(&mut self, world: T) {
        self.worlds.push(Box::new(world));
    }

    pub fn start(&mut self) {
        for world in &mut self.worlds {
            world.start();
        }
    }

    /// Updates the server state.
    pub fn update(&mut self) {
        for world in &mut self.worlds {
            world.update();
        }
    }

    /// Stops the server.
    pub fn stop(&mut self) {
        for world in &mut self.worlds {
            world.stop();
        }
    }
}

impl Actor for Server {
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        // Start the server.
        self.start();

        ctx.run_interval(self.update_interval, |act, _| {
            act.update();
        });
    }

    fn stopped(&mut self, _: &mut Self::Context) {
        // Stop the server.
        self.stop();
    }
}
