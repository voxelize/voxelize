use std::time::Duration;

use actix::prelude::*;
use actix_broker::BrokerSubscribe;
use hashbrown::HashMap;
use log::info;

use super::{
    messages::{ClientMessage, CreateRoom, JoinRoom, LeaveRoom},
    room::Room,
};

#[derive(Default)]
pub struct WsServer {
    rooms: HashMap<String, Room>,

    started: bool,
}

impl WsServer {
    fn get_room(&self, room_name: &str) -> Option<&Room> {
        self.rooms.get(room_name)
    }

    fn get_room_mut(&mut self, room_name: &str) -> Option<&mut Room> {
        self.rooms.get_mut(room_name)
    }
}

impl Actor for WsServer {
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.subscribe_system_async::<LeaveRoom>(ctx);
    }
}

impl Handler<CreateRoom> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: CreateRoom, ctx: &mut Self::Context) -> Self::Result {
        let CreateRoom { room } = msg;

        info!("🚪 Room created: {}", room.name);

        let name = room.name.to_owned();
        let interval = room.interval.to_owned();

        self.rooms.insert(room.name.to_owned(), room);

        ctx.run_interval(Duration::from_millis(interval), move |act, ctx| {
            if let Some(room) = act.get_room_mut(&name) {
                room.tick();
            }
        });
    }
}

impl Handler<JoinRoom> for WsServer {
    type Result = MessageResult<JoinRoom>;

    fn handle(&mut self, msg: JoinRoom, _ctx: &mut Self::Context) -> Self::Result {
        let JoinRoom {
            room_name,
            recipient,
        } = msg;

        if let Some(room) = self.get_room_mut(&room_name) {
            let id = room.add_client(recipient);
            return MessageResult(id);
        }

        MessageResult("".to_owned())
    }
}

impl Handler<LeaveRoom> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: LeaveRoom, _ctx: &mut Self::Context) {
        let LeaveRoom {
            room_name,
            client_id,
        } = msg;

        if let Some(room) = self.rooms.get_mut(&room_name) {
            room.remove_client(&client_id);
        }
    }
}

impl Handler<ClientMessage> for WsServer {
    type Result = ();

    fn handle(&mut self, msg: ClientMessage, _ctx: &mut Self::Context) {
        let ClientMessage {
            room_name,
            client_id,
            data,
        } = msg;

        let room = self.rooms.get_mut(&room_name).unwrap();

        room.on_request(&client_id, data);
    }
}

impl SystemService for WsServer {
    fn service_started(&mut self, _ctx: &mut Context<Self>) {
        self.started = true;
    }
}
impl Supervised for WsServer {}
