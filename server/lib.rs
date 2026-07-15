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

/// How often the server pings each WebSocket connection.
const DEFAULT_WS_HEARTBEAT_INTERVAL_MS: u64 = 10_000;

/// How long a connection may stay silent (no frames of any kind, including
/// pongs) before it is treated as dead and reaped. Abrupt closures (killed
/// processes, dropped networks) never send a close frame — without this
/// timeout their sessions and world memberships would linger indefinitely.
const DEFAULT_WS_CLIENT_TIMEOUT_MS: u64 = 45_000;

/// Upper bound on a single socket write. A peer that stopped reading (dead
/// but not closed) eventually stalls writes; bounding them keeps the
/// forwarding loop responsive so the idle timeout above can fire.
const WS_WRITE_TIMEOUT: Duration = Duration::from_secs(15);

fn ws_heartbeat_interval() -> Duration {
    Duration::from_millis(
        std::env::var("VOXELIZE_WS_HEARTBEAT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_WS_HEARTBEAT_INTERVAL_MS),
    )
}

fn ws_client_timeout() -> Duration {
    Duration::from_millis(
        std::env::var("VOXELIZE_WS_CLIENT_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_WS_CLIENT_TIMEOUT_MS),
    )
}

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
    // Two outbound lanes per connection (see `WsSender`): control traffic
    // (session lifecycle, chat, entity/peer state) is written before bulk
    // world data (chunks, voxel updates), so a client streaming megabytes of
    // chunks still receives JOIN/LEAVE and live state promptly.
    let (control_tx, mut control_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (bulk_tx, mut bulk_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let tx = WsSender::new(control_tx, bulk_tx);

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

    let heartbeat_interval = ws_heartbeat_interval();
    let client_timeout = ws_client_timeout();
    let mut heartbeat = tokio::time::interval(heartbeat_interval);
    let mut last_seen = std::time::Instant::now();

    loop {
        // `biased` gives the control lane strict priority over the bulk lane:
        // whenever both have pending messages, session lifecycle / state
        // snapshots are written first and can never be starved behind queued
        // chunk data. Depths are decremented only after the socket write
        // completes: the state-flush gate uses control-lane depth as a
        // liveness signal, and a stalled write (peer stopped reading) must
        // keep counting as backlog.
        tokio::select! {
            biased;
            Some(msg) = control_rx.recv() => {
                match tokio::time::timeout(WS_WRITE_TIMEOUT, session.binary(msg)).await {
                    Ok(Ok(())) => tx.mark_control_written(),
                    Ok(Err(_)) => break,
                    Err(_) => {
                        warn!("[WS] Write stalled for {}; dropping connection", session_id);
                        break;
                    }
                }
            }
            _ = heartbeat.tick() => {
                if last_seen.elapsed() > client_timeout {
                    warn!(
                        "[WS] Connection {} silent for {:?}; reaping dead session",
                        session_id, client_timeout
                    );
                    break;
                }
                match tokio::time::timeout(WS_WRITE_TIMEOUT, session.ping(b"")).await {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) | Err(_) => break,
                }
            }
            msg = stream.next() => {
                last_seen = std::time::Instant::now();
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
                                Some(connection_token.clone()),
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
            Some(msg) = bulk_rx.recv() => {
                match tokio::time::timeout(WS_WRITE_TIMEOUT, session.binary(msg)).await {
                    Ok(Ok(())) => tx.mark_bulk_written(),
                    Ok(Err(_)) => break,
                    Err(_) => {
                        warn!("[WS] Bulk write stalled for {}; dropping connection", session_id);
                        break;
                    }
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
