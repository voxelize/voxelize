mod common;
mod errors;
mod libs;
mod server;
mod types;
pub mod webrtc;
mod world;

use std::sync::Arc;

use actix::{Actor, Addr};
use actix_cors::Cors;
use actix_files::{Files, NamedFile};
use actix_web::{
    web::{self, Query},
    App, Error, HttpRequest, HttpResponse, HttpServer, Result,
};
use actix_ws::AggregatedMessage;
use futures_util::StreamExt;
use hashbrown::HashMap;
use log::{info, warn};
use tokio::sync::{mpsc, Mutex};

pub use common::*;
pub use libs::*;
pub use server::*;
pub use types::*;
pub use webrtc::signaling::{rtc_candidate, rtc_offer, WebRTCPeers};
pub use webrtc::{create_webrtc_api, datachannel::fragment_message};
pub use world::system_profiler::{
    clear_timing_data_for_world, get_all_world_names, get_timing_summary_for_world, SystemTimer,
    WorldTimingContext,
};
pub use world::*;

pub type RtcSenders = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Vec<u8>>>>>;

pub fn create_rtc_senders() -> RtcSenders {
    Arc::new(Mutex::new(HashMap::new()))
}

struct Config {
    serve: String,
}

async fn ws_route(
    req: HttpRequest,
    body: web::Payload,
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

    info!("[WS] New connection with 16MB continuation limit");

    let (response, session, stream) = actix_ws::handle(&req, body)?;

    let stream = stream
        .max_frame_size(16 * 1024 * 1024)
        .aggregate_continuations()
        .max_continuation_size(16 * 1024 * 1024);

    actix_web::rt::spawn(handle_ws_connection(
        id,
        is_transport,
        session,
        stream,
        srv.get_ref().clone(),
    ));

    Ok(response)
}

async fn handle_ws_connection(
    initial_id: String,
    is_transport: bool,
    mut session: actix_ws::Session,
    mut stream: impl StreamExt<Item = Result<AggregatedMessage, actix_ws::ProtocolError>> + Unpin,
    server: Addr<Server>,
) {
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();

    let session_id = match server
        .send(Connect {
            id: if initial_id.is_empty() {
                None
            } else {
                Some(initial_id)
            },
            is_transport,
            sender: tx.clone(),
        })
        .await
    {
        Ok(id) => id,
        Err(e) => {
            warn!("[WS] Failed to register session: {:?}", e);
            let _ = session.close(None).await;
            return;
        }
    };

    loop {
        tokio::select! {
            Some(msg) = rx.recv() => {
                if session.binary(msg).await.is_err() {
                    break;
                }
            }
            msg = stream.next() => {
                match msg {
                    Some(Ok(AggregatedMessage::Binary(bytes))) => {
                        let size_kb = bytes.len() as f64 / 1024.0;
                        if size_kb > 50.0 {
                            info!("[WS] Received large binary message: {:.2}KB", size_kb);
                        }

                        let message = match decode_message(&bytes.to_vec()) {
                            Ok(m) => m,
                            Err(e) => {
                                warn!("[WS] Failed to decode message: {:?}", e);
                                continue;
                            }
                        };

                        match server.send(ClientMessage {
                            id: session_id.clone(),
                            data: message,
                        }).await {
                            Ok(Some(error_msg)) => {
                                warn!("[WS] ClientMessage error: {}", error_msg);
                                let error_response = encode_message(
                                    &Message::new(&MessageType::Error).text(&error_msg).build(),
                                );
                                let _ = session.binary(error_response).await;
                                break;
                            }
                            Ok(None) => {}
                            Err(e) => {
                                warn!("[WS] Actor mailbox error: {:?}", e);
                                break;
                            }
                        }
                    }
                    Some(Ok(AggregatedMessage::Close(_))) => {
                        break;
                    }
                    Some(Ok(AggregatedMessage::Ping(data))) => {
                        let _ = session.pong(&data).await;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        warn!("[WS] Protocol error: {:?}", e);
                        break;
                    }
                    None => break,
                }
            }
        }
    }

    server.do_send(Disconnect { id: session_id });
    let _ = session.close(None).await;
}

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
    pub async fn run(mut server: Server) -> std::io::Result<()> {
        server.prepare().await;
        server.preload().await;
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

        info!("Voxelize backend running on http://{}:{}", addr, port);

        srv.run().await
    }
}
