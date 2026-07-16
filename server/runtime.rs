//! Canonical HTTP/WebSocket transport runtime for a Voxelize server.
//!
//! This module owns the transport/server policy that every Voxelize-based
//! game shares, so downstream games compose it instead of copying it:
//!
//! - **Bind-before-preload boot lifecycle** ([`Voxelize::bind_with`]): the
//!   TCP socket is bound *first*, then world preload is driven concurrently
//!   with the accept loop while `GET /health` reports live progress, and the
//!   server is marked started only after preload completes.
//! - **Canonical route set** ([`VoxelizeHandle::configure`]): `/`, `/ws/`,
//!   `/info`, `/health`, and optional static file serving, mountable onto any
//!   Actix `App` alongside custom routes, middleware, and CORS.
//! - **Canonical WebSocket session policy** ([`WsSessionPolicy`],
//!   [`run_ws_session`]): one in-flight `ClientMessage` send per session, no
//!   further socket reads while an ack is pending, repeated slow-ack warnings,
//!   and a hard drop for a truly wedged server actor.

use std::{future::Future, net::SocketAddr, time::Duration};

use actix::{Actor, Addr};
use actix_cors::Cors;
use actix_files::{Files, NamedFile};
use actix_web::{
    body::MessageBody,
    dev::{ServiceFactory, ServiceRequest, ServiceResponse},
    web::{self, Query},
    App, Error, HttpRequest, HttpResponse, HttpServer, Result,
};
use actix_ws::AggregatedMessage;
use futures_util::{future::poll_immediate, StreamExt};
use hashbrown::HashMap;
use log::{info, warn};
use serde_json::json;
use tokio::sync::mpsc;

use crate::{
    decode_message, encode_message, ClientMessage, Connect, Disconnect, Health, Info, Message,
    MessageType, RunPreload, Server, SetStarted, WsSender,
};

/// How long to wait for the server actor to ack a client message before
/// logging that the ack is slow. A slow ack (e.g. the actor is busy ticking
/// or preloading) is not fatal: the session keeps waiting, which naturally
/// backpressures further reads from this socket.
const CLIENT_MESSAGE_SLOW_ACK_WARN_INTERVAL: Duration = Duration::from_secs(1);

/// Hard upper bound on waiting for a client message ack. Only a server actor
/// that is truly wedged should ever hit this; the session is then dropped so
/// its resources can be reclaimed.
const CLIENT_MESSAGE_ACK_HARD_TIMEOUT: Duration = Duration::from_secs(30);

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

/// Timing policy for a canonical WebSocket session.
///
/// The defaults are the production policy: 1s slow-ack warnings, 30s hard
/// drop, 10s heartbeats, 45s idle reap, 15s per-write bound (heartbeat and
/// idle timings honor `VOXELIZE_WS_HEARTBEAT_MS` / `VOXELIZE_WS_CLIENT_TIMEOUT_MS`).
/// Tests and adapters can shorten the durations without duplicating the
/// session loop itself.
#[derive(Clone, Copy, Debug)]
pub struct WsSessionPolicy {
    /// How long an in-flight `ClientMessage` ack may be pending before a
    /// warning is logged. Warnings repeat every interval while waiting.
    pub slow_ack_warn_interval: Duration,

    /// Hard upper bound on a pending `ClientMessage` ack. Reaching it means
    /// the server actor is wedged; the session is dropped.
    pub ack_hard_timeout: Duration,

    /// How often the session pings its peer.
    pub heartbeat_interval: Duration,

    /// How long the peer may stay completely silent before being reaped.
    pub client_timeout: Duration,

    /// Upper bound on a single socket write.
    pub write_timeout: Duration,
}

impl Default for WsSessionPolicy {
    fn default() -> Self {
        Self {
            slow_ack_warn_interval: CLIENT_MESSAGE_SLOW_ACK_WARN_INTERVAL,
            ack_hard_timeout: CLIENT_MESSAGE_ACK_HARD_TIMEOUT,
            heartbeat_interval: ws_heartbeat_interval(),
            client_timeout: ws_client_timeout(),
            write_timeout: WS_WRITE_TIMEOUT,
        }
    }
}

/// Outcome of waiting for a `ClientMessage` ack under a [`WsSessionPolicy`].
enum AckOutcome<T> {
    Acked(T),
    TimedOut,
}

/// Await a single in-flight ack under the canonical slow-ack policy.
///
/// The same future is polled throughout — the send is never cancelled or
/// retried, and the caller reads nothing else from its socket while waiting,
/// which preserves per-session ordering and backpressure. `on_slow` is
/// invoked once per elapsed warn interval until either the ack resolves or
/// the hard timeout is reached.
async fn await_client_message_ack<F, W>(
    ack: F,
    policy: &WsSessionPolicy,
    mut on_slow: W,
) -> AckOutcome<F::Output>
where
    F: Future,
    W: FnMut(Duration),
{
    tokio::pin!(ack);
    let started_waiting = tokio::time::Instant::now();
    loop {
        match tokio::time::timeout(policy.slow_ack_warn_interval, &mut ack).await {
            Ok(result) => return AckOutcome::Acked(result),
            Err(_) => {
                let waited = started_waiting.elapsed();
                if waited >= policy.ack_hard_timeout {
                    return AckOutcome::TimedOut;
                }
                on_slow(waited);
            }
        }
    }
}

/// A cloneable handle to a booted Voxelize engine.
///
/// Registered as Actix app data by [`VoxelizeHandle::configure`], it is what
/// the canonical HTTP/WS handlers read, and what game adapters use to mount
/// the engine's routes onto their own `App` (with custom middleware, CORS,
/// and extra routes) without copying transport policy.
#[derive(Clone)]
pub struct VoxelizeHandle {
    server: Addr<Server>,
    secret: Option<String>,
    serve: String,
    session_policy: WsSessionPolicy,
}

impl VoxelizeHandle {
    /// Create a handle around a running [`Server`] actor with no join secret,
    /// no static folder, and the default [`WsSessionPolicy`].
    pub fn new(server: Addr<Server>) -> Self {
        Self {
            server,
            secret: None,
            serve: String::new(),
            session_policy: WsSessionPolicy::default(),
        }
    }

    /// Require this secret on `/ws/` connections.
    pub fn with_secret(mut self, secret: Option<String>) -> Self {
        self.secret = secret;
        self
    }

    /// Serve a static client folder alongside the API routes.
    pub fn with_serve(mut self, serve: &str) -> Self {
        self.serve = serve.to_owned();
        self
    }

    /// Override the WebSocket session timing policy.
    pub fn with_session_policy(mut self, policy: WsSessionPolicy) -> Self {
        self.session_policy = policy;
        self
    }

    /// The server actor address, for custom routes (e.g. profiling endpoints
    /// sending [`crate::GetAllWorldStats`], or the WebRTC signaling handlers).
    pub fn server(&self) -> &Addr<Server> {
        &self.server
    }

    /// The session timing policy this handle registers for `/ws/`.
    pub fn session_policy(&self) -> WsSessionPolicy {
        self.session_policy
    }

    /// Mount the canonical engine routes and app data onto an Actix `App`:
    ///
    /// - `GET /` — static client index (when a serve folder is set)
    /// - `GET /ws/` — canonical WebSocket session ([`ws_route`])
    /// - `GET /info` — server info snapshot ([`info_route`])
    /// - `GET /health` — readiness/liveness probe ([`health_route`])
    /// - static files under `/` (when a serve folder is set), which never
    ///   shadow the API routes
    ///
    /// Also registers this handle and the raw `Addr<Server>` as app data, so
    /// custom routes and the WebRTC signaling handlers can extract them.
    ///
    /// Usage: `App::new().wrap(middleware).configure(handle.configure())`.
    pub fn configure(&self) -> impl FnOnce(&mut web::ServiceConfig) {
        let handle = self.clone();
        move |cfg| {
            cfg.app_data(web::Data::new(handle.server.clone()))
                .app_data(web::Data::new(handle.clone()))
                .route("/", web::get().to(serve_index))
                .route("/ws/", web::get().to(ws_route))
                .route("/info", web::get().to(info_route))
                .route("/health", web::get().to(health_route));

            if handle.serve.is_empty() {
                info!("No static client folder configured (WS/API only)");
            } else {
                info!("Serving static client from {}", handle.serve);
                // Never let the SPA Files service shadow API routes — otherwise
                // GET /health is handled as a missing static file (404) in prod.
                cfg.service(
                    Files::new("/", &handle.serve)
                        .index_file("index.html")
                        .path_filter(|path, _| {
                            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                            // Exclude API route leaf names; nested assets keep matching.
                            !matches!(name, "health" | "info" | "ws") && !path.starts_with("ws/")
                        }),
                );
            }
        }
    }
}

async fn serve_index(handle: web::Data<VoxelizeHandle>) -> Result<NamedFile> {
    let path = handle.serve.to_owned();
    Ok(NamedFile::open(if path.ends_with('/') {
        path + "index.html"
    } else {
        path + "/index.html"
    })?)
}

/// `GET /info` — server info snapshot. A failed server actor mailbox is a
/// structured 503, never a panic.
pub async fn info_route(handle: web::Data<VoxelizeHandle>) -> HttpResponse {
    match handle.server.send(Info).await {
        Ok(info) => HttpResponse::Ok().json(info),
        Err(error) => HttpResponse::ServiceUnavailable().json(json!({
            "ok": false,
            "error": format!("server actor unreachable: {}", error),
        })),
    }
}

/// `GET /health` — readiness/liveness probe.
///
/// - During preload (after the socket is bound): 503 with `ready: false`,
///   `preloading: true`, and real per-world preload progress.
/// - 200 only once preload has completed *and* world ticks flow.
/// - A failed server actor mailbox is a structured 503, never a panic.
pub async fn health_route(handle: web::Data<VoxelizeHandle>) -> HttpResponse {
    match handle.server.send(Health).await {
        Ok(body) => {
            let ok = body.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
            if ok {
                HttpResponse::Ok().json(body)
            } else {
                HttpResponse::ServiceUnavailable().json(body)
            }
        }
        Err(error) => HttpResponse::ServiceUnavailable().json(json!({
            "ok": false,
            "ready": false,
            "error": format!("server actor unreachable: {}", error),
        })),
    }
}

/// `GET /ws/` — upgrade to the canonical WebSocket session.
///
/// Validates the join secret, registers the connection with the server actor,
/// and spawns [`run_ws_session`] under the handle's [`WsSessionPolicy`].
/// Requires [`VoxelizeHandle`] app data (registered by
/// [`VoxelizeHandle::configure`]).
pub async fn ws_route(
    req: HttpRequest,
    body: web::Payload,
    handle: web::Data<VoxelizeHandle>,
    options: Query<HashMap<String, String>>,
) -> Result<HttpResponse, Error> {
    if let Some(secret) = &handle.secret {
        let error = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "wrong secret!");

        if let Some(client_secret) = options.get("secret") {
            if client_secret != secret {
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

    actix_web::rt::spawn(run_ws_session(
        id,
        is_transport,
        session,
        stream,
        handle.server.clone(),
        handle.session_policy,
    ));

    Ok(response)
}

/// Drive one canonical WebSocket session to completion.
///
/// This is the single transport policy every Voxelize game shares — adapters
/// reuse it (usually via [`ws_route`]) instead of copying it:
///
/// - Two outbound lanes (control before bulk) with bounded per-write time.
/// - Heartbeats and idle reaping.
/// - Slow `ClientMessage` acks: exactly one in-flight send is awaited, no
///   further frames are read from the socket while it is pending (preserving
///   ordering and backpressure), a warning is logged every
///   `slow_ack_warn_interval`, and only an ack pending past
///   `ack_hard_timeout` — a truly wedged server actor — drops the session.
pub async fn run_ws_session(
    initial_id: String,
    is_transport: bool,
    mut session: actix_ws::Session,
    mut stream: impl StreamExt<Item = Result<AggregatedMessage, actix_ws::ProtocolError>> + Unpin,
    server: Addr<Server>,
    policy: WsSessionPolicy,
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

    let mut heartbeat = tokio::time::interval(policy.heartbeat_interval);
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
                match tokio::time::timeout(policy.write_timeout, session.binary(msg)).await {
                    Ok(Ok(())) => tx.mark_control_written(),
                    Ok(Err(_)) => break,
                    Err(_) => {
                        warn!("[WS] Write stalled for {}; dropping connection", session_id);
                        break;
                    }
                }
            }
            _ = heartbeat.tick() => {
                if last_seen.elapsed() > policy.client_timeout {
                    warn!(
                        "[WS] Connection {} silent for {:?}; reaping dead session",
                        session_id, policy.client_timeout
                    );
                    break;
                }
                match tokio::time::timeout(policy.write_timeout, session.ping(b"")).await {
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

                        // Await the ack to the same in-flight send: a slow ack
                        // must not drop the session, and no further frames are
                        // read from this socket while waiting, which preserves
                        // ordering and backpressure without busy-looping.
                        let ack = await_client_message_ack(
                            server.send(ClientMessage::new(
                                session_id.clone(),
                                message,
                                wire_bytes,
                                Some(connection_token.clone()),
                            )),
                            &policy,
                            |waited| {
                                warn!(
                                    "[WS] ClientMessage ack slow ({:?}) for {}; still waiting",
                                    waited, session_id
                                );
                            },
                        )
                        .await;

                        match ack {
                            AckOutcome::Acked(Ok(Some(error_msg))) => {
                                warn!("[WS] ClientMessage error: {}", error_msg);
                                let error_response = encode_message(
                                    &Message::new(&MessageType::Error).text(&error_msg).build(),
                                );
                                let _ = session.binary(error_response).await;
                                break;
                            }
                            AckOutcome::Acked(Ok(None)) => {}
                            AckOutcome::Acked(Err(e)) => {
                                warn!("[WS] Actor mailbox error: {:?}", e);
                                break;
                            }
                            AckOutcome::TimedOut => {
                                warn!(
                                    "[WS] ClientMessage ack exceeded {:?} for {}; dropping connection",
                                    policy.ack_hard_timeout, session_id
                                );
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
                match tokio::time::timeout(policy.write_timeout, session.binary(msg)).await {
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

/// A Voxelize server whose TCP socket is bound and whose HTTP accept loop is
/// already running.
///
/// Returned by [`Voxelize::bind`] / [`Voxelize::bind_with`] *after* the bind
/// succeeded, the accept loop and workers started, and the preload driver was
/// spawned — in that order, so the canonical lifecycle (bind, then serve,
/// then preload) is guaranteed by construction. The server answers requests
/// (e.g. `GET /health`) from the moment this value exists; awaiting
/// [`BoundVoxelize::wait_until_stopped`] does not start anything, it only
/// waits for termination.
pub struct BoundVoxelize {
    handle: VoxelizeHandle,
    addrs: Vec<SocketAddr>,
    serving: actix_web::dev::Server,
}

impl BoundVoxelize {
    /// The engine handle registered with the HTTP app.
    pub fn handle(&self) -> &VoxelizeHandle {
        &self.handle
    }

    /// All addresses the server bound to.
    pub fn addrs(&self) -> &[SocketAddr] {
        &self.addrs
    }

    /// The first bound address (useful with port `0` to discover the
    /// ephemeral port).
    pub fn addr(&self) -> SocketAddr {
        self.addrs[0]
    }

    /// Await termination of the already-running server (graceful stop or
    /// fatal error). The accept loop was started by
    /// [`Voxelize::bind_with`]; this never starts a dormant server.
    pub async fn wait_until_stopped(self) -> std::io::Result<()> {
        self.serving.await
    }
}

pub struct Voxelize;

impl Voxelize {
    /// Boot the Voxelize HTTP/WebSocket server with the default app:
    /// permissive CORS and the canonical routes from
    /// [`VoxelizeHandle::configure`].
    ///
    /// **Bind-before-preload:** `HttpServer` binds and accepts *before* (and
    /// concurrently with) world preload. During preload, `GET /health`
    /// reports `preloading` / `preloadProgress` with `ready=false` (503)
    /// until preload finishes and ticks flow.
    pub async fn run(server: Server) -> std::io::Result<()> {
        Self::bind(server).await?.wait_until_stopped().await
    }

    /// Boot with a custom Actix app built around the engine. See
    /// [`Voxelize::bind_with`] for the guaranteed boot ordering.
    ///
    /// The factory receives the engine's [`VoxelizeHandle`] and returns the
    /// `App` for each worker, so games own CORS, middleware, and custom
    /// routes without copying transport policy:
    ///
    /// ```no_run
    /// use actix_cors::Cors;
    /// use actix_web::{web, App, HttpResponse};
    /// use voxelize::{Server, Voxelize};
    ///
    /// #[actix_web::main]
    /// async fn main() -> std::io::Result<()> {
    ///     let server = Server::new().port(4000).build();
    ///
    ///     Voxelize::run_with(server, |voxelize| {
    ///         App::new()
    ///             .wrap(Cors::default().allowed_origin("https://game.example"))
    ///             .configure(voxelize.configure())
    ///             .route(
    ///                 "/custom/status",
    ///                 web::get().to(|| async { HttpResponse::Ok().json("ok") }),
    ///             )
    ///     })
    ///     .await
    /// }
    /// ```
    pub async fn run_with<F, T, B>(server: Server, app_factory: F) -> std::io::Result<()>
    where
        F: Fn(&VoxelizeHandle) -> App<T> + Send + Clone + 'static,
        T: ServiceFactory<
                ServiceRequest,
                Config = (),
                Response = ServiceResponse<B>,
                Error = Error,
                InitError = (),
            > + 'static,
        B: MessageBody + 'static,
    {
        Self::bind_with(server, app_factory)
            .await?
            .wait_until_stopped()
            .await
    }

    /// Bind and start serving the default app. See [`Voxelize::bind_with`]
    /// for the guaranteed ordering; the returned server is already accepting.
    pub async fn bind(server: Server) -> std::io::Result<BoundVoxelize> {
        Self::bind_with(server, |voxelize| {
            App::new()
                .wrap(Cors::permissive())
                .configure(voxelize.configure())
        })
        .await
    }

    /// Bind the server socket with a custom Actix app, guaranteeing the
    /// canonical boot ordering:
    ///
    /// 1. Worlds are prepared.
    /// 2. The server actor starts (so `/info` and `/health` can reach it),
    ///    with `started=false`.
    /// 3. The TCP socket is bound. A bind failure returns before any preload
    ///    work is scheduled.
    /// 4. The HTTP accept loop and workers are started (the returned server
    ///    is live, not a dormant handle). A startup failure returns before
    ///    any preload work is scheduled.
    /// 5. Only after the accept loop is up, the preload driver is spawned;
    ///    it runs concurrently with request serving so `GET /health` serves
    ///    live per-world `preloadProgress` (503, `ready=false`) while chunks
    ///    generate.
    /// 6. When preload completes the server is marked started; `/health`
    ///    flips to 200 once world ticks flow.
    pub async fn bind_with<F, T, B>(
        mut server: Server,
        app_factory: F,
    ) -> std::io::Result<BoundVoxelize>
    where
        F: Fn(&VoxelizeHandle) -> App<T> + Send + Clone + 'static,
        T: ServiceFactory<
                ServiceRequest,
                Config = (),
                Response = ServiceResponse<B>,
                Error = Error,
                InitError = (),
            > + 'static,
        B: MessageBody + 'static,
    {
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

        let handle = VoxelizeHandle::new(server_addr.clone())
            .with_secret(secret)
            .with_serve(&serve);
        let factory_handle = handle.clone();

        let http =
            HttpServer::new(move || app_factory(&factory_handle)).bind((addr.to_owned(), port))?;
        let addrs = http.addrs();

        // Start the accept loop and workers NOW, before any preload work is
        // scheduled. `HttpServer::run` alone returns a lazy future whose
        // first poll is what actually spawns the accept thread and workers;
        // polling it once here makes "serving before preload" true by
        // construction instead of by scheduler timing. The single poll either
        // leaves the server running (pending) or surfaces a startup failure.
        let mut serving = http.run();
        if let Some(startup) = poll_immediate(&mut serving).await {
            return Err(startup
                .err()
                .unwrap_or_else(|| std::io::Error::other("HTTP server stopped during startup")));
        }

        info!(
            "Voxelize backend serving on http://{}:{} (preload may still be running)",
            addr, port
        );

        // Preload concurrently with request serving, so probes see live
        // preloadProgress on /health while chunks generate. Spawned strictly
        // after the accept loop is up: serve-before-preload by construction.
        actix_web::rt::spawn(async move {
            if let Err(err) = server_addr.send(RunPreload).await {
                warn!("RunPreload delivery failed: {:?}", err);
            }
            server_addr.do_send(SetStarted(true));
            info!("Boot preload finished; server marked started");
        });

        Ok(BoundVoxelize {
            handle,
            addrs,
            serving,
        })
    }
}

#[cfg(test)]
mod ack_policy_tests {
    use super::*;

    fn policy(warn_ms: u64, hard_ms: u64) -> WsSessionPolicy {
        WsSessionPolicy {
            slow_ack_warn_interval: Duration::from_millis(warn_ms),
            ack_hard_timeout: Duration::from_millis(hard_ms),
            ..WsSessionPolicy::default()
        }
    }

    /// A slow-but-alive ack spanning several warn intervals must survive:
    /// one warning per elapsed interval, and the original ack value is
    /// returned. Uses tokio's paused clock, so no wall time elapses.
    #[tokio::test(start_paused = true)]
    async fn slow_ack_warns_each_interval_and_survives() {
        let policy = policy(1_000, 30_000);
        let ack = async {
            tokio::time::sleep(Duration::from_millis(3_500)).await;
            "acked"
        };

        let mut warnings: Vec<Duration> = vec![];
        let outcome = await_client_message_ack(ack, &policy, |waited| warnings.push(waited)).await;

        match outcome {
            AckOutcome::Acked(value) => assert_eq!(value, "acked"),
            AckOutcome::TimedOut => panic!("a slow ack under the hard timeout must not time out"),
        }
        assert_eq!(warnings.len(), 3, "one warning per elapsed warn interval");
        assert!(
            warnings.windows(2).all(|pair| pair[0] < pair[1]),
            "warnings report monotonically increasing wait times"
        );
    }

    /// A wedged ack must hit the hard timeout after exhausting the warn
    /// intervals — with the production 30s policy, verified in virtual time.
    #[tokio::test(start_paused = true)]
    async fn wedged_ack_hits_hard_timeout_with_production_policy() {
        let policy = policy(1_000, 30_000);
        let started = tokio::time::Instant::now();

        let mut warnings = 0;
        let outcome =
            await_client_message_ack(std::future::pending::<()>(), &policy, |_| warnings += 1)
                .await;

        assert!(matches!(outcome, AckOutcome::TimedOut));
        assert_eq!(warnings, 29, "warnings repeat until the hard timeout");
        let elapsed = started.elapsed();
        assert!(
            elapsed >= Duration::from_secs(30) && elapsed < Duration::from_secs(31),
            "hard drop lands at the 30s bound, elapsed {:?}",
            elapsed
        );
    }
}
