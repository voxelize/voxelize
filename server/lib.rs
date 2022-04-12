mod app;
mod libs;

use app::network::models::encode_message;
use game_loop::game_loop;
use log::{error, info};
use message_io::network::{NetEvent, Transport};
use message_io::node;

use std::net::ToSocketAddrs;
use std::sync::{Arc, RwLock};

pub use app::network::server::Server;
pub use app::world::WorldConfig;

use crate::app::network::models::{decode_message, Message};

pub struct Voxelize;

impl Voxelize {
    pub fn run(mut server: Server) {
        let transport = Transport::Ws;
        let addr = (server.addr.to_owned(), server.port)
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
        server.started = true;

        let server_wrapped = Arc::new(RwLock::new(server));

        let server_inner = server_wrapped.clone();

        let task = listener.for_each_async(move |event| {
            let server = server_inner.clone();

            match event.network() {
                NetEvent::Connected(_, _) => (), // Only generated at connect() calls.
                NetEvent::Accepted(endpoint, _listener_id) => {
                    server.write().unwrap().add_endpoint(endpoint);
                }
                NetEvent::Message(endpoint, input_data) => {
                    let data: Message = decode_message(input_data).unwrap();
                    handler.network().send(endpoint, &encode_message(&data));
                    println!("{:?}", data);
                    server.write().unwrap().on_request(endpoint, data);
                }
                NetEvent::Disconnected(endpoint) => {
                    // Only connection oriented protocols will generate this event
                    server.write().unwrap().on_leave(endpoint);
                }
            }
        });

        game_loop(
            server_wrapped,
            60,
            0.1,
            |g| {
                g.game.write().unwrap().tick();
            },
            |_g| {},
        );

        drop(task);
    }
}
