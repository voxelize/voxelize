use actix::{fut, prelude::*};
use actix_web_actors::ws;
use libflate::zlib::Encoder;
use std::io::Write;

use super::{
    messages::{ClientMessage, JoinWorld},
    models::{decode_message, encode_message, Message},
    server::WsServer,
};

#[derive(Default)]
pub struct WsSession {
    id: String,
    room: String,
    name: Option<String>,
}

impl WsSession {
    pub fn join_room(&mut self, world_name: &str, ctx: &mut ws::WebsocketContext<Self>) {
        let world_name = world_name.to_owned();

        // Then send a join message for the new room
        let join_msg = JoinWorld {
            world_name: world_name.to_owned(),
            recipient: ctx.address().recipient(),
        };

        WsServer::from_registry()
            .send(join_msg)
            .into_actor(self)
            .then(|id, act, _ctx| {
                if let Ok(id) = id {
                    act.id = id;
                    act.room = world_name;
                }

                fut::ready(())
            })
            .wait(ctx);
    }

    fn on_request(&mut self, message: Message) {
        WsServer::from_registry().do_send(ClientMessage {
            world_name: self.room.to_owned(),
            client_id: self.id.to_owned(),
            data: message,
        });
    }
}

impl Actor for WsSession {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.join_room("Main", ctx);
    }

    fn stopped(&mut self, _ctx: &mut Self::Context) {
        log::info!(
            "WsChatSession closed for {}({}) in room {}",
            self.name.clone().unwrap_or_else(|| "anon".to_string()),
            self.id,
            self.room
        );
    }
}

impl Handler<Message> for WsSession {
    type Result = ();

    fn handle(&mut self, msg: Message, ctx: &mut Self::Context) {
        let encoded = encode_message(&msg);

        if encoded.len() > 1024 {
            let mut encoder = Encoder::new(Vec::<u8>::new()).unwrap();
            encoder.write_all(encoded.as_slice()).unwrap();
            let encoded = encoder.finish().into_result().unwrap();
            ctx.binary(encoded);
        } else {
            ctx.binary(encoded);
        }
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for WsSession {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        let msg = match msg {
            Err(_) => {
                ctx.stop();
                return;
            }
            Ok(msg) => msg,
        };

        match msg {
            ws::Message::Binary(bytes) => {
                let message = decode_message(&bytes.to_vec()).unwrap();
                self.on_request(message);
            }
            ws::Message::Close(reason) => {
                ctx.close(reason);
                ctx.stop();
            }
            _ => (),
        }
    }
}
