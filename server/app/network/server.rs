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

    fn handle(&mut self, msg: CreateRoom, _ctx: &mut Self::Context) -> Self::Result {
        let CreateRoom { room } = msg;
        info!("🚪 Room created: {}", room.name);
        self.rooms.insert(room.name.to_owned(), room);
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

impl SystemService for WsServer {}
impl Supervised for WsServer {}
