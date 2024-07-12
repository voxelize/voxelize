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
    options: Query<HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    if !secret.is_none() {
        info!("Secret: {:?}", secret);
        let error = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "wrong secret!");

        if let Some(client_secret) = options.get("secret") {
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

    let id = if let Some(id) = options.get("client_id") {
        id.to_owned()
    } else {
        "".to_owned()
    };

    let is_transport = options.contains_key("is_transport");

    if is_transport {
        info!("A new transport server has connected.");
    }

    ws::start(
        server::WsSession {
            id,
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

async fn info(server: web::Data<Addr<Server>>) -> Result<HttpResponse> {
    let info = server.send(Info).await.unwrap();
    Ok(HttpResponse::Ok().json(info))
}

pub struct Voxelize;

impl Voxelize {
    /// Run a voxelize server instance. This blocks the main thread, as the game loop is essentially a while loop
    /// running indefinitely. Keep in mind that the server instance passed in isn't a borrow, so `Voxelize::run`
    /// takes ownership of the server.
    pub async fn run(mut server: Server) -> std::io::Result<()> {
        server.prepare().await;
        server.started = true;

        let addr = server.addr.to_owned();
        let port = server.port.to_owned();
        let serve = server.serve.to_owned();
        let secret = server.secret.to_owned();

        let server_addr = server.start();

        if serve.is_empty() {
            info!("Attempting to serve static folder: {}", serve);
        }

        let srv = HttpServer::new(move || {
            let serve = serve.to_owned();
            let secret = secret.to_owned();
            let cors = Cors::permissive();

            let app = App::new()
                .wrap(cors)
                .app_data(web::Data::new(secret))
                .app_data(web::Data::new(server_addr.clone()))
                .app_data(web::Data::new(Config {
                    serve: serve.to_owned(),
                }))
                .route("/", web::get().to(index))
                .route("/ws/", web::get().to(ws_route))
                .route("/info", web::get().to(info));

            if serve.is_empty() {
                app
            } else {
                app.service(Files::new("/", serve).show_files_listing())
            }
        })
        .bind((addr.to_owned(), port.to_owned()))?;

        info!("🍄  Voxelize backend running on http://{}:{}", addr, port);

        srv.run().await
    }
}
