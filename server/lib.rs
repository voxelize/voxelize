mod common;
mod errors;
mod libs;
mod server;
mod types;
mod world;

use actix::{Actor, Addr};
use actix_cors::Cors;
use actix_files::{Files, NamedFile};
use actix_web::{
    web::{self, Query},
    App, Error, HttpRequest, HttpResponse, HttpServer, Result,
};
use actix_web_actors::ws;
use hashbrown::HashMap;
use log::{info, warn};

use std::time::Instant;

pub use common::*;
pub use libs::*;
pub use server::*;
pub use types::*;
pub use world::*;

struct Config {
    serve: String,
}

/// Entry point for our websocket route
async fn ws_route(
    req: HttpRequest,
    stream: web::Payload,
    srv: web::Data<Addr<Server>>,
    secret: web::Data<Option<String>>,
    params: Query<HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    if !secret.is_none() {
        let error = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "wrong secret!");

        if let Some(client_secret) = params.get("secret") {
            if *client_secret != secret.as_deref().unwrap() {
                warn!(
                    "An attempt to join with a wrong secret was made: {}",
                    client_secret
                );
                return Err(error.into());
            }
        } else {
            warn!("An attempt to join with no secret key was made.");
            return Err(error.into());
        }
    }

    let id = if let Some(id) = params.get("client_id") {
        id.to_owned()
    } else {
        "".to_owned()
    };

    let is_transport = params.contains_key("is_transport");

    if is_transport {
        info!("A new transport server has connected.");
    }

    ws::start(
        server::WsSession {
            id,
            hb: Instant::now(),
            name: None,
            is_transport,
            addr: srv.get_ref().clone(),
        },
        &req,
        stream,
    )
}

/// Main website path, serving statically built index.html
async fn index(path: web::Data<Config>) -> Result<NamedFile> {
    let path = path.serve.to_owned();
    Ok(NamedFile::open(if path.ends_with("/") {
        path + "index.html"
    } else {
        path + "/index.html"
    })?)
}

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
    pub async fn run(mut server: Server) -> std::io::Result<()> {
        server.prepare();
        server.started = true;

        let addr = server.addr.to_owned();
        let port = server.port.to_owned();
        let serve = server.serve.to_owned();
        let secret = server.secret.to_owned();

        let server_addr = server.start();

        info!("Attempting to serve static index.html at: {}", serve);

        let srv = HttpServer::new(move || {
            let serve = serve.to_owned();
            let secret = secret.to_owned();
            let cors = Cors::permissive();

            App::new()
                .wrap(cors)
                .app_data(web::Data::new(secret))
                .app_data(web::Data::new(server_addr.clone()))
                .app_data(web::Data::new(Config {
                    serve: serve.to_owned(),
                }))
                .route("/", web::get().to(index))
                .route("/ws/", web::get().to(ws_route))
                .service(Files::new("/", serve).show_files_listing())
        })
        .workers(1)
        .bind((addr.to_owned(), port.to_owned()))?;

        info!("????  Voxelize running on http://{}:{}", addr, port);

        srv.run().await
    }
}
