mod common;
mod network;
mod utils;
mod world;

use game_loop::game_loop;
use log::{error, info};
use message_io::network::{NetEvent, Transport};
use message_io::node;

use std::net::ToSocketAddrs;
use std::sync::{Arc, RwLock};

pub use network::server::Server;
pub use world::WorldConfig;

use crate::network::models::{decode_message, Message};

pub struct Voxelize;

impl Voxelize {
    /// Run a voxelize server instance. This blocks the main thread, as the game loop is essentially a while loop
    /// running indefinitely. Keep in mind that the server instance passed in isn't a borrow, so `Voxelize::run`
    /// takes ownership of the server.
    ///
    /// # Example
    ///
    /// ```
    /// // Run a server without any worlds.
    /// let server = Server::new().port(4000).build();
    /// Voxelize::run(server);
    /// ```
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
                    server.write().unwrap().on_request(endpoint, data);
                }
                NetEvent::Disconnected(endpoint) => {
                    server.write().unwrap().on_leave(endpoint);
                }
            }
        });

        game_loop(
            server_wrapped.clone(),
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
