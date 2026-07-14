mod common;
mod errors;
mod libs;
mod perf;
mod server;
mod types;
pub mod webrtc;
mod world;

use std::{sync::Arc, time::Duration};

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
    TimedDispatcherBuilder, TimedSystem, WorldTimingContext,
};
pub use world::*;

pub type RtcSenders = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<Vec<u8>>>>>;

const CLIENT_MESSAGE_RESPONSE_TIMEOUT: Duration = Duration::from_secs(1);

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
    let (critical_tx, mut critical_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (entity_tx, mut entity_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let tx = WsSender::new(critical_tx, entity_tx);

    let (session_id, connection_token) = match server
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
        Ok(result) => result,
        Err(e) => {
            warn!("[WS] Failed to register session: {:?}", e);
            let _ = session.close(None).await;
            return;
        }
    };

    loop {
        tokio::select! {
            biased;
            Some(msg) = critical_rx.recv() => {
                tx.mark_critical_received();
                if session.binary(msg).await.is_err() {
                    break;
                }
            }
            Some(msg) = entity_rx.recv() => {
                tx.mark_entity_received();
                if session.binary(msg).await.is_err() {
                    break;
                }
            }
            msg = stream.next() => {
                match msg {
                    Some(Ok(AggregatedMessage::Binary(bytes))) => {
                        let wire_bytes = bytes.len();
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

                        match tokio::time::timeout(
                            CLIENT_MESSAGE_RESPONSE_TIMEOUT,
                            server.send(ClientMessage::new(
                                session_id.clone(),
                                message,
                                wire_bytes,
                            )),
                        )
                        .await
                        {
                            Ok(Ok(Some(error_msg))) => {
                                warn!("[WS] ClientMessage error: {}", error_msg);
                                let error_response = encode_message(
                                    &Message::new(&MessageType::Error).text(&error_msg).build(),
                                );
                                let _ = session.binary(error_response).await;
                                break;
                            }
                            Ok(Ok(None)) => {}
                            Ok(Err(e)) => {
                                warn!("[WS] Actor mailbox error: {:?}", e);
                                break;
                            }
                            Err(_) => {
                                warn!("[WS] ClientMessage timed out");
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

    server.do_send(Disconnect {
        id: session_id,
        token: connection_token,
    });
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

async fn health(server: web::Data<Addr<Server>>) -> Result<HttpResponse> {
    let body = server.send(Health).await.unwrap();
    let ok = body
        .get("ok")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if ok {
        Ok(HttpResponse::Ok().json(body))
    } else {
        Ok(HttpResponse::ServiceUnavailable().json(body))
    }
}

pub struct Voxelize;

impl Voxelize {
    /// Boot the Voxelize HTTP/WebSocket server.
    ///
    /// **Bind-before-preload:** `HttpServer` binds and accepts *before* (and
    /// concurrently with) world preload. Previously `preload().await` ran to
    /// completion *before* `.bind()`, so a large `preload_radius` on a small
    /// box left the port unbound and starved health checks. During preload,
    /// `GET /health` reports `preloading` / `preloadProgress` with `ready=false`
    /// (503) until preload finishes and ticks flow.
    pub async fn run(mut server: Server) -> std::io::Result<()> {
        server.prepare().await;

        let addr = server.addr.to_owned();
        let port = server.port.to_owned();
        let serve = server.serve.to_owned();
        let secret = server.secret.to_owned();

        // Optional bind delay for probes that must observe "unbound" boot
        // (VOXELIZE_DELAY_BIND_MS). Production leaves this unset.
        if let Ok(ms) = std::env::var("VOXELIZE_DELAY_BIND_MS") {
            if let Ok(delay_ms) = ms.parse::<u64>() {
                if delay_ms > 0 {
                    warn!(
                        "Delaying HTTP bind by {}ms (VOXELIZE_DELAY_BIND_MS)",
                        delay_ms
                    );
                    actix_web::rt::time::sleep(Duration::from_millis(delay_ms)).await;
                }
            }
        }

        // Start the Server actor first so /info and /health can reach it.
        // Leave `started=false` until RunPreload completes (SetStarted).
        let server_addr = server.start();
        let server_addr_http = server_addr.clone();
        let server_addr_preload = server_addr;

        let http = HttpServer::new(move || {
            let serve = serve.to_owned();
            let secret = secret.to_owned();
            let cors = Cors::permissive();

            let app = App::new()
                .wrap(cors)
                .app_data(web::Data::new(secret))
                .app_data(web::Data::new(server_addr_http.clone()))
                .app_data(web::Data::new(Config {
                    serve: serve.to_owned(),
                }))
                .route("/", web::get().to(index))
                .route("/ws/", web::get().to(ws_route))
                .route("/info", web::get().to(info))
                .route("/health", web::get().to(health));

            if serve.is_empty() {
                info!("No static client folder configured (WS/API only)");
                app
            } else {
                info!("Serving static client from {}", serve);
                // Never let the SPA Files service shadow API routes — otherwise
                // GET /health is handled as a missing static file (404) in prod.
                app.service(
                    Files::new("/", serve)
                        .index_file("index.html")
                        .path_filter(|path, _| {
                            let name = path
                                .file_name()
                                .and_then(|s| s.to_str())
                                .unwrap_or("");
                            // Exclude API route leaf names; nested assets keep matching.
                            !matches!(name, "health" | "info" | "ws")
                                && !path.starts_with("ws/")
                        }),
                )
            }
        })
        .bind((addr.to_owned(), port.to_owned()))?;

        info!(
            "Voxelize backend listening on http://{}:{} (preload may still be running)",
            addr, port
        );

        // Preload concurrently with the accept loop so probes see a bound port
        // and live preloadProgress on /health while chunks generate.
        actix_web::rt::spawn(async move {
            if let Err(err) = server_addr_preload.send(RunPreload).await {
                warn!("RunPreload delivery failed: {:?}", err);
            }
            server_addr_preload.do_send(SetStarted(true));
            info!("Boot preload finished; server marked started");
        });

        http.run().await
    }
}
