mod app;
mod libs;

use log::{error, info};
use message_io::network::{NetEvent, Transport};
use message_io::node;

use std::net::ToSocketAddrs;

pub use app::network::server::Server;
pub use app::world::WorldConfig;

use crate::app::network::models::{decode_message, Message};

pub struct Voxelize;

impl Voxelize {
    pub fn run(mut server: Server) {
        let transport = Transport::Ws;
        let addr = ("0.0.0.0", server.port)
            .to_socket_addrs()
            .unwrap()
            .next()
            .unwrap();

        let (handler, listener) = node::split::<()>();

        match handler.network().listen(transport, addr) {
            Ok((_id, real_addr)) => info!("Server running at {} by {}", real_addr, transport),
            Err(_) => return error!("Can not listening at {} by {}", addr, transport),
        }

        server.set_handler(handler.clone());

        listener.for_each(move |event| {
            match event.network() {
                NetEvent::Connected(_, _) => (), // Only generated at connect() calls.
                NetEvent::Accepted(client, listener_id) => {
                    server.add_endpoint(client);
                }
                NetEvent::Message(client, input_data) => {
                    let data: Message = decode_message(input_data).unwrap();
                    server.on_request(client, data);
                    // handler.network().send(endpoint, &encode_message(&message));
                }
                NetEvent::Disconnected(client) => {
                    // Only connection oriented protocols will generate this event
                    server.on_leave(client);
                }
            }
        });
    }
}
