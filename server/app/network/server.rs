use std::time::Duration;

use actix::prelude::*;
use actix_broker::BrokerSubscribe;
use hashbrown::HashMap;
use log::info;

use crate::app::world::World;

use super::messages::{ClientMessage, CreateWorld, HasWorld, JoinWorld, LeaveWorld};

/// A websocket server for Voxelize, holds all worlds data, and runs as a background
/// system service.
#[derive(Default)]
pub struct WsServer {
    /// Whether or not if the socket server has started as a system service.
    pub started: bool,

    /// A map of all the worlds.
    worlds: HashMap<String, World>,
}

impl WsServer {
    /// Get a world reference by name.
    fn get_world(&self, world_name: &str) -> Option<&World> {
        self.worlds.get(world_name)
    }

    /// Get a mutable world reference by name.
    fn get_world_mut(&mut self, world_name: &str) -> Option<&mut World> {
        self.worlds.get_mut(world_name)
    }
}

/// Subscribe to certain system events.
impl Actor for WsServer {
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.subscribe_system_async::<LeaveWorld>(ctx);
    }
}

/// Handler for world creation, creating from a name and a world config. Worlds that are added get immediately started
/// by running an Actix interval through `run_interval`.
impl Handler<CreateWorld> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: CreateWorld, ctx: &mut Self::Context) -> Self::Result {
        let CreateWorld { name, config } = msg;

        info!("🌎 World created: {}", name);

        let interval = config.interval.to_owned();
        let world = World::new(&name, config);

        self.worlds.insert(world.name.to_owned(), world);

        ctx.run_interval(Duration::from_millis(interval), move |act, ctx| {
            if let Some(world) = act.get_world_mut(&name) {
                world.tick();
            }
        });
    }
}

/// Handler for joining a world, adding a client into a specific world.
impl Handler<JoinWorld> for WsServer {
    type Result = MessageResult<JoinWorld>;

    fn handle(&mut self, msg: JoinWorld, _ctx: &mut Self::Context) -> Self::Result {
        let JoinWorld {
            world_name,
            recipient,
        } = msg;

        if let Some(world) = self.get_world_mut(&world_name) {
            let id = world.add_client(recipient);
            return MessageResult(id);
        }

        MessageResult("".to_owned())
    }
}

/// Handler for leaving the world, removing a client from a world.
impl Handler<LeaveWorld> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: LeaveWorld, _ctx: &mut Self::Context) {
        let LeaveWorld {
            world_name,
            client_id,
        } = msg;

        if let Some(world) = self.worlds.get_mut(&world_name) {
            world.remove_client(&client_id);
        }
    }
}

/// Handler for client protocol buffer messages, sent from client to the server.
impl Handler<ClientMessage> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: ClientMessage, _ctx: &mut Self::Context) {
        let ClientMessage {
            world_name,
            client_id,
            data,
        } = msg;

        let world = self.worlds.get_mut(&world_name).unwrap();

        world.on_request(&client_id, data);
    }
}

/// Handler to check if a world exists.
impl Handler<HasWorld> for WsServer {
    type Result = MessageResult<HasWorld>;

    fn handle(&mut self, msg: HasWorld, _ctx: &mut Self::Context) -> Self::Result {
        let HasWorld(name) = msg;

        MessageResult(self.worlds.contains_key(&name))
    }
}

/// Start the websocket server as a system service.
impl SystemService for WsServer {
    fn service_started(&mut self, _ctx: &mut Context<Self>) {
        self.started = true;
    }
}

impl Supervised for WsServer {}
