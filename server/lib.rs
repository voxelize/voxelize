mod common;
mod errors;
mod libs;
mod server;
mod types;
mod world;

use http::StatusCode;
use log::{error, info};
use message_io::network::{NetEvent, Transport};
use message_io::node;
use server::{Request, Response};

use std::net::ToSocketAddrs;
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant};

pub use common::*;
pub use libs::*;
pub use server::*;
pub use types::*;
pub use world::*;

const MS_PER_UPDATE: u128 = 16;

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

        let (handler2, listener2) = node::split::<()>();
        let listen_addr = "127.0.0.1:5000";
        handler2
            .network()
            .listen(Transport::Tcp, listen_addr)
            .unwrap();

        let task2 = listener2.for_each_async(move |event| {
            if let NetEvent::Message(endpoint, buf) = event.network() {
                let response = match Request::parse(buf) {
                    Ok(request) => Response::file_request(&request, "./examples/client/build"),
                    Err(()) => {
                        let mut response = Response::new();
                        response.status = StatusCode::BAD_REQUEST;

                        response
                    }
                };

                handler2.network().send(endpoint, &response.format());
                handler2.network().remove(endpoint.resource_id());
            }
        });

        server.set_handler(handler);
        server.prepare();
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

        let mut previous = Instant::now();
        loop {
            let current = Instant::now();

            // Run the tick.
            server_wrapped.write().unwrap().tick();

            let elapsed = current - previous;
            previous = current;

            if elapsed.as_millis() < MS_PER_UPDATE {
                thread::sleep(Duration::from_millis(
                    (MS_PER_UPDATE - elapsed.as_millis()) as u64,
                ));
            }
        }
    }
}
