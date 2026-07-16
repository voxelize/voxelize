//! End-to-end tests for the canonical HTTP/WS transport runtime:
//! bind-before-preload boot lifecycle, `/health` semantics, actor-failure
//! handling, WS slow-ack session policy, and Actix app composability.

use std::io::{Read, Write};
use std::net::SocketAddr;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use actix::{Actor, Arbiter};
use actix_web::{middleware, test, web, App, HttpResponse};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use voxelize::{
    decode_message, encode_message, Chunk, ChunkStage, Message, MessageType, Resources, Server,
    Space, Voxelize, VoxelizeHandle, World, WorldConfig, WsSessionPolicy,
};

/// A chunk stage that blocks until the test opens its gate, holding world
/// preload deliberately incomplete without faking any progress numbers.
///
/// Stages run on the global rayon pool, so the gated world is kept to a
/// single chunk: the gate then pins exactly one rayon thread, leaving the
/// rest of the pool free for the world's ECS dispatch (a clogged global pool
/// would wedge world ticks themselves).
struct GatedStage {
    gate: Arc<AtomicBool>,
}

impl ChunkStage for GatedStage {
    fn name(&self) -> String {
        "Gated".to_owned()
    }

    fn process(&self, chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        while !self.gate.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(5));
        }
        chunk
    }
}

async fn get_json(client: &awc::Client, url: &str) -> Option<(u16, Value)> {
    let mut response = client.get(url).send().await.ok()?;
    let body = response.json::<Value>().await.ok()?;
    Some((response.status().as_u16(), body))
}

/// Poll `url` until `accept` returns true for a response, panicking with
/// `context` on timeout. Returns the accepted (status, body).
async fn poll_until(
    client: &awc::Client,
    url: &str,
    timeout: Duration,
    context: &str,
    accept: impl Fn(u16, &Value) -> bool,
) -> (u16, Value) {
    let deadline = Instant::now() + timeout;
    let mut last = None;
    while Instant::now() < deadline {
        if let Some((status, body)) = get_json(client, url).await {
            if accept(status, &body) {
                return (status, body);
            }
            last = Some((status, body));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!(
        "timed out waiting for {}; last response: {:?}",
        context, last
    );
}

/// The full boot lifecycle against a real deliberately-delayed preload:
/// the socket binds and `/health` answers structured 503s with real per-world
/// preload progress while preload cannot complete, then flips to 200/ready
/// only after preload finishes and world ticks flow.
#[actix_web::test]
async fn health_serves_during_delayed_preload_then_flips_ready() {
    let gate = Arc::new(AtomicBool::new(false));

    let mut server = Server::new().debug(false).port(0).build();
    let config = WorldConfig::new()
        .min_chunk([0, 0])
        .max_chunk([0, 0])
        .preload(true)
        .preload_radius(1)
        .build();
    let mut world = World::new("gated", &config);
    world
        .pipeline_mut()
        .add_stage(GatedStage { gate: gate.clone() });
    server.add_world(world).expect("world should register");

    let bound = Voxelize::bind(server).await.expect("bind should succeed");
    let addr = bound.addr();
    assert_ne!(addr.port(), 0, "ephemeral port resolved at bind time");
    actix_web::rt::spawn(bound.wait_until_stopped());

    // A short per-request timeout keeps retries cycling when the machine is
    // saturated (all suite binaries start their servers at once); the outer
    // poll budget is what bounds the test.
    let client = awc::Client::builder()
        .timeout(Duration::from_secs(3))
        .finish();
    let url = format!("http://127.0.0.1:{}/health", addr.port());

    // The socket is reachable while preload is gated shut: the very first
    // response must be a structured 503, never a connection refusal or panic.
    let (status, body) = poll_until(
        &client,
        &url,
        Duration::from_secs(60),
        "first /health response",
        |_, _| true,
    )
    .await;
    assert_eq!(status, 503, "not ready while preload is incomplete");
    assert_eq!(body["ok"], json!(false));
    assert_eq!(body["ready"], json!(false));

    // Preload is underway but gated: health reports preloading with real
    // (zero) per-world progress, still 503.
    let (status, body) = poll_until(
        &client,
        &url,
        Duration::from_secs(60),
        "preloading=true on /health",
        |_, body| body["preloading"] == json!(true),
    )
    .await;
    assert_eq!(status, 503);
    assert_eq!(body["ready"], json!(false));
    assert_eq!(body["worlds"][0]["name"], json!("gated"));
    assert_eq!(
        body["worlds"][0]["preloadProgress"],
        json!(0.0),
        "no chunk can complete while the stage is gated"
    );

    // Open the gate: preload completes, the server is marked started, ticks
    // flow, and health flips to 200/ready.
    gate.store(true, Ordering::Relaxed);
    let (status, body) = poll_until(
        &client,
        &url,
        Duration::from_secs(120),
        "/health to flip ready",
        |status, _| status == 200,
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["ok"], json!(true));
    assert_eq!(body["ready"], json!(true));
    assert_eq!(body["started"], json!(true));
    assert_eq!(body["preloading"], json!(false));
    let tick_age = body["lastTickAgeMs"]
        .as_u64()
        .expect("ready health reports tick liveness");
    let threshold = body["tickStallThresholdMs"].as_u64().unwrap();
    assert!(tick_age <= threshold, "ready implies ticks flow");
}

/// A chunk stage whose only job is to probe `/health` over a raw blocking
/// TCP connection the moment it first runs. Chunk stages are the first
/// preload work that executes game code, so a successful HTTP response
/// captured *from inside* that side effect proves the accept loop was
/// serving before preload ran — with no scheduler assumption in the test.
struct HealthProbeStage {
    target: Arc<Mutex<Option<SocketAddr>>>,
    response: Arc<Mutex<Option<String>>>,
}

impl HealthProbeStage {
    fn probe(&self, addr: SocketAddr) -> String {
        let probe = || -> std::io::Result<String> {
            let mut stream = std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(10))?;
            stream.set_read_timeout(Some(Duration::from_secs(10)))?;
            stream.write_all(
                b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            )?;
            let mut response = String::new();
            stream.read_to_string(&mut response)?;
            Ok(response)
        };
        probe().unwrap_or_else(|error| format!("probe error: {}", error))
    }
}

impl ChunkStage for HealthProbeStage {
    fn name(&self) -> String {
        "HealthProbe".to_owned()
    }

    fn process(&self, chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        if self.response.lock().unwrap().is_some() {
            return chunk;
        }
        // The bound address is only known after bind_with returns; block
        // (on this rayon thread) until the test publishes it rather than
        // assuming who got scheduled first.
        let addr = loop {
            if let Some(addr) = *self.target.lock().unwrap() {
                break addr;
            }
            std::thread::sleep(Duration::from_millis(2));
        };
        let response = self.probe(addr);
        *self.response.lock().unwrap() = Some(response);
        chunk
    }
}

/// Strict serve-before-preload by construction: the very first preload side
/// effect (the first chunk stage invocation) synchronously performs an HTTP
/// request against the bound address and must receive a well-formed
/// not-ready `/health` response — proving the accept loop was established
/// before preload work ran, not merely that `/health` answered eventually.
#[actix_web::test]
async fn first_preload_side_effect_observes_serving_health_endpoint() {
    let target: Arc<Mutex<Option<SocketAddr>>> = Arc::new(Mutex::new(None));
    let response: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let mut server = Server::new().debug(false).port(0).build();
    let config = WorldConfig::new()
        .min_chunk([0, 0])
        .max_chunk([0, 0])
        .preload(true)
        .preload_radius(1)
        .build();
    let mut world = World::new("probed", &config);
    world.pipeline_mut().add_stage(HealthProbeStage {
        target: target.clone(),
        response: response.clone(),
    });
    server.add_world(world).expect("world should register");

    let bound = Voxelize::bind(server).await.expect("bind should succeed");
    let port = bound.addr().port();
    *target.lock().unwrap() = Some(SocketAddr::from(([127, 0, 0, 1], port)));
    actix_web::rt::spawn(bound.wait_until_stopped());

    let deadline = Instant::now() + Duration::from_secs(60);
    let probed = loop {
        if let Some(probed) = response.lock().unwrap().take() {
            break probed;
        }
        assert!(
            Instant::now() < deadline,
            "preload never reached its first chunk stage"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    };

    assert!(
        probed.starts_with("HTTP/1.1 503"),
        "the first preload side effect must observe a serving, not-ready /health; got: {}",
        probed
    );
    assert!(
        probed.contains("\"ready\":false"),
        "structured not-ready body expected; got: {}",
        probed
    );
}

/// Start a `Server` actor on a dedicated arbiter (its own thread) so tests
/// can wedge or kill it without blocking the test thread, and return its
/// address.
async fn start_server_on_arbiter(
    arbiter: &Arbiter,
    build: impl FnOnce() -> Server + Send + 'static,
) -> actix::Addr<Server> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    arbiter.spawn_fn(move || {
        let _ = tx.send(build().start());
    });
    rx.await.expect("server actor should start")
}

/// A dead server actor mailbox must yield structured 503 JSON from `/health`
/// and `/info`, never an `unwrap()` panic in the HTTP worker.
#[actix_web::test]
async fn dead_server_actor_yields_structured_503_not_panic() {
    let arbiter = Arbiter::new();
    let addr = start_server_on_arbiter(&arbiter, || Server::new().debug(false).build()).await;

    arbiter.stop();
    let deadline = Instant::now() + Duration::from_secs(5);
    while addr.connected() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(!addr.connected(), "actor mailbox should be closed");

    let handle = VoxelizeHandle::new(addr);
    let app = test::init_service(App::new().configure(handle.configure())).await;

    let response =
        test::call_service(&app, test::TestRequest::get().uri("/health").to_request()).await;
    assert_eq!(response.status().as_u16(), 503);
    let body: Value = test::read_body_json(response).await;
    assert_eq!(body["ok"], json!(false));
    assert_eq!(body["ready"], json!(false));
    assert!(
        body["error"]
            .as_str()
            .expect("structured error message")
            .contains("server actor unreachable"),
        "error should describe the mailbox failure: {:?}",
        body
    );

    let response =
        test::call_service(&app, test::TestRequest::get().uri("/info").to_request()).await;
    assert_eq!(response.status().as_u16(), 503);
    let body: Value = test::read_body_json(response).await;
    assert_eq!(body["ok"], json!(false));
    assert!(body["error"].as_str().is_some());
}

/// The engine routes compose with game-owned middleware and custom routes on
/// the same `App`, without the game reimplementing any transport policy.
#[actix_web::test]
async fn engine_routes_compose_with_custom_middleware_and_routes() {
    let server = Server::new().debug(false).build();
    let handle = VoxelizeHandle::new(server.start());

    // An unusable session policy is rejected at the public API, not at
    // session time.
    let invalid = WsSessionPolicy {
        slow_ack_warn_interval: Duration::ZERO,
        ..WsSessionPolicy::default()
    };
    assert!(
        handle.clone().with_session_policy(invalid).is_err(),
        "zero warn interval must be rejected"
    );

    let app = test::init_service(
        App::new()
            .wrap(middleware::DefaultHeaders::new().add(("x-town-middleware", "on")))
            .configure(handle.configure())
            .route(
                "/town/profile",
                web::get().to(|| async { HttpResponse::Ok().json(json!({ "profiling": true })) }),
            ),
    )
    .await;

    // The custom route works and passes through the custom middleware.
    let response = test::call_service(
        &app,
        test::TestRequest::get().uri("/town/profile").to_request(),
    )
    .await;
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(
        response.headers().get("x-town-middleware").unwrap(),
        "on",
        "custom middleware wraps custom routes"
    );
    let body: Value = test::read_body_json(response).await;
    assert_eq!(body["profiling"], json!(true));

    // The canonical engine route works on the same app, through the same
    // middleware (503: the runner has not marked the server started).
    let response =
        test::call_service(&app, test::TestRequest::get().uri("/health").to_request()).await;
    assert_eq!(response.status().as_u16(), 503);
    assert_eq!(
        response.headers().get("x-town-middleware").unwrap(),
        "on",
        "custom middleware wraps engine routes"
    );
    let body: Value = test::read_body_json(response).await;
    assert_eq!(body["ready"], json!(false));
    assert_eq!(body["started"], json!(false));
}

fn action_message(action: &str, data: Value) -> Vec<u8> {
    encode_message(
        &Message::new(&MessageType::Action)
            .json(&json!({ "action": action, "data": data }).to_string())
            .build(),
    )
}

fn join_message(world: &str) -> Vec<u8> {
    encode_message(
        &Message::new(&MessageType::Join)
            .json(&json!({ "world": world, "username": "tester" }).to_string())
            .build(),
    )
}

/// The canonical WS slow-ack policy end-to-end, with test-scaled durations
/// and a genuinely wedged server actor (a blocking action handler on the
/// actor's own thread):
///
/// - an ack pending for several warn intervals keeps the session alive, and
///   the next frame is not processed while the ack is in flight (ordering /
///   backpressure);
/// - an ack pending past the hard timeout drops the session promptly, long
///   before the wedge clears.
#[actix_web::test]
async fn ws_slow_ack_preserves_ordering_and_hard_timeout_drops_wedged_session() {
    let arbiter = Arbiter::new();
    let addr = start_server_on_arbiter(&arbiter, || {
        let mut server = Server::new().debug(false).build();
        // Blocks the Server actor's arbiter thread, so every subsequent
        // ClientMessage ack is genuinely delayed — no mocked slowness.
        server.set_action_handle("wedge", |value, _| {
            let ms = value.as_u64().unwrap_or(0);
            std::thread::sleep(Duration::from_millis(ms));
        });
        server
    })
    .await;

    let warn_interval = Duration::from_millis(100);
    let hard_timeout = Duration::from_millis(600);
    let handle = VoxelizeHandle::new(addr)
        .with_session_policy(WsSessionPolicy {
            slow_ack_warn_interval: warn_interval,
            ack_hard_timeout: hard_timeout,
            ..WsSessionPolicy::default()
        })
        .expect("test policy is valid");

    let app_handle = handle.clone();
    let http = actix_web::HttpServer::new(move || App::new().configure(app_handle.configure()))
        .workers(1)
        .bind(("127.0.0.1", 0))
        .expect("ws test server should bind");
    let ws_url = format!("http://127.0.0.1:{}/ws/", http.addrs()[0].port());
    actix_web::rt::spawn(http.run());

    // Session 1: a 350ms wedge spans three warn intervals but stays under the
    // hard timeout. The JOIN for a nonexistent world queued right behind it
    // must only be processed after the wedge ack resolves, and its ERROR
    // response proves the session survived the slow ack.
    let wedge_ms = 350u64;
    let (_, mut connection) = awc::Client::new()
        .ws(&ws_url)
        .connect()
        .await
        .expect("ws connect");
    let started = Instant::now();
    connection
        .send(awc::ws::Message::Binary(
            action_message("wedge", json!(wedge_ms)).into(),
        ))
        .await
        .unwrap();
    connection
        .send(awc::ws::Message::Binary(join_message("nowhere").into()))
        .await
        .unwrap();

    let error = loop {
        match connection.next().await {
            Some(Ok(awc::ws::Frame::Binary(bytes))) => {
                break decode_message(&bytes).expect("server frames decode");
            }
            Some(Ok(_)) => continue,
            other => panic!(
                "session dropped before answering the queued frame: {:?}",
                other
            ),
        }
    };
    let elapsed = started.elapsed();
    assert_eq!(error.r#type, MessageType::Error as i32);
    assert!(
        error.text.contains("non-existent world"),
        "unexpected error payload: {}",
        error.text
    );
    assert!(
        elapsed >= Duration::from_millis(wedge_ms - 50),
        "the queued frame must not be read/processed while the wedge ack is in flight \
         (answered after {:?})",
        elapsed
    );
    assert!(
        elapsed >= warn_interval * 3,
        "the slow ack spanned repeated warn intervals without dropping the session"
    );

    // Session 2: a 3s wedge exceeds the hard timeout. The session must be
    // dropped at ~hard_timeout, well before the wedge clears — a wedged actor
    // cannot pin socket resources for the full 30s production bound.
    let (_, mut connection) = awc::Client::new()
        .ws(&ws_url)
        .connect()
        .await
        .expect("ws connect");
    let started = Instant::now();
    connection
        .send(awc::ws::Message::Binary(
            action_message("wedge", json!(3_000)).into(),
        ))
        .await
        .unwrap();

    loop {
        match connection.next().await {
            Some(Ok(awc::ws::Frame::Close(_))) | None => break,
            Some(Ok(_)) => continue,
            Some(Err(_)) => break,
        }
    }
    let elapsed = started.elapsed();
    assert!(
        elapsed >= hard_timeout - Duration::from_millis(50),
        "session must survive up to the hard timeout, dropped after {:?}",
        elapsed
    );
    assert!(
        elapsed < Duration::from_millis(2_500),
        "session must be dropped at the hard timeout, not after the wedge clears \
         (dropped after {:?})",
        elapsed
    );
}
