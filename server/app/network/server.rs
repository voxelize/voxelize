use std::time::Duration;

use actix::prelude::*;
use actix_broker::BrokerSubscribe;
use hashbrown::HashMap;
use log::info;

use crate::app::world::World;

use super::messages::{ClientMessage, CreateWorld, JoinWorld, LeaveWorld};

#[derive(Default)]
pub struct WsServer {
    worlds: HashMap<String, World>,

    started: bool,
}

impl WsServer {
    fn get_world(&self, world_name: &str) -> Option<&World> {
        self.worlds.get(world_name)
    }

    fn get_room_mut(&mut self, world_name: &str) -> Option<&mut World> {
        self.worlds.get_mut(world_name)
    }
}

impl Actor for WsServer {
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.subscribe_system_async::<LeaveWorld>(ctx);
    }
}

impl Handler<CreateWorld> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: CreateWorld, ctx: &mut Self::Context) -> Self::Result {
        let CreateWorld { name, config } = msg;

        info!("🌎 World created: {}", name);

        let interval = config.interval.to_owned();
        let world = World::new(&name, config);

        self.worlds.insert(world.name.to_owned(), world);

        ctx.run_interval(Duration::from_millis(interval), move |act, ctx| {
            if let Some(world) = act.get_room_mut(&name) {
                world.tick();
            }
        });
    }
}

impl Handler<JoinWorld> for WsServer {
    type Result = MessageResult<JoinWorld>;

    fn handle(&mut self, msg: JoinWorld, _ctx: &mut Self::Context) -> Self::Result {
        let JoinWorld {
            world_name,
            recipient,
        } = msg;

        if let Some(room) = self.get_room_mut(&world_name) {
            let id = room.add_client(recipient);
            return MessageResult(id);
        }

        MessageResult("".to_owned())
    }
}

impl Handler<LeaveWorld> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: LeaveWorld, _ctx: &mut Self::Context) {
        let LeaveWorld {
            world_name,
            client_id,
        } = msg;

        if let Some(room) = self.worlds.get_mut(&world_name) {
            room.remove_client(&client_id);
        }
    }
}

impl Handler<ClientMessage> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: ClientMessage, _ctx: &mut Self::Context) {
        let ClientMessage {
            world_name,
            client_id,
            data,
        } = msg;

        let room = self.worlds.get_mut(&world_name).unwrap();

        room.on_request(&client_id, data);
    }
}

impl SystemService for WsServer {
    fn service_started(&mut self, _ctx: &mut Context<Self>) {
        self.started = true;
    }
}
impl Supervised for WsServer {}
