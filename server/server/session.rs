use actix::prelude::*;
use actix_web_actors::ws;
use log::warn;

use crate::{
    server::models, ClientMessage, Connect, Disconnect, EncodedMessage, Message, MessageType,
    Server,
};

#[derive(Debug)]
pub struct WsSession {
    /// unique session id
    pub id: String,

    /// peer name
    pub name: Option<String>,

    /// Is this WS session a TS transport?
    pub is_transport: bool,

    /// Chat server
    pub addr: Addr<Server>,
}

impl Actor for WsSession {
    type Context = ws::WebsocketContext<Self>;

    /// Method is called on actor start.
    /// We register ws session with ChatServer
    fn started(&mut self, ctx: &mut Self::Context) {
        // register self in chat server. `AsyncContext::wait` register
        // future within context, but context waits until this future resolves
        // before processing any other events.
        // HttpContext::state() is instance of WsChatSessionState, state is shared
        // across all routes within application
        let addr = ctx.address();
        self.addr
            .send(Connect {
                id: if self.id.is_empty() {
                    None
                } else {
                    Some(self.id.to_owned())
                },
                is_transport: self.is_transport,
                addr: addr.recipient(),
            })
            .into_actor(self)
            .then(|res, act, ctx| {
                match res {
                    Ok(res) => act.id = res,
                    // something is wrong with chat server
                    _ => ctx.stop(),
                }
                fut::ready(())
            })
            .wait(ctx);
    }

    fn stopping(&mut self, _: &mut Self::Context) -> Running {
        // notify chat server
        self.addr.do_send(Disconnect {
            id: self.id.to_owned(),
        });
        Running::Stop
    }
}

/// Handle messages from chat server, we simply send it to peer websocket
impl Handler<EncodedMessage> for WsSession {
    type Result = ();

    fn handle(&mut self, msg: EncodedMessage, ctx: &mut Self::Context) {
        ctx.binary(msg.0);
    }
}

impl Handler<Disconnect> for WsSession {
    type Result = ();

    fn handle(&mut self, _: Disconnect, ctx: &mut Self::Context) {
        ctx.terminate();
    }
}

/// WebSocket message handler
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
                let message = models::decode_message(&bytes.to_vec()).unwrap();
                self.addr
                    .send(ClientMessage {
                        id: self.id.to_owned(),
                        data: message,
                    })
                    .into_actor(self)
                    .then(|res, _, ctx| {
                        match res {
                            Ok(res) => {
                                if let Some(error_msg) = res {
                                    warn!("Error: {}", error_msg);
                                    ctx.binary(models::encode_message(
                                        &Message::new(&MessageType::Error).text(&error_msg).build(),
                                    ));
                                    ctx.stop();
                                }
                            }
                            _ => ctx.stop(),
                        }
                        fut::ready(())
                    })
                    .wait(ctx);
            }
            ws::Message::Close(reason) => {
                ctx.close(reason);
                ctx.stop();
            }
            ws::Message::Continuation(_) => {
                ctx.stop();
            }
            _ => (),
        }
    }
}
