mod models;

use std::time::{Duration, Instant};

use actix::{
    fut::wrap_future, Actor, Addr, AsyncContext, Context, Handler, Message as ActixMessage,
    MessageResult,
};
use fern::colors::{Color, ColoredLevelConfig};
use futures_util::future::join_all;
use hashbrown::HashMap;
use indicatif::{MultiProgress, ProgressBar, ProgressStyle};
use log::{info, warn};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::{
    errors::AddWorldError,
    world::{Registry, World},
    ClientJoinRequest, ClientLeaveRequest, ClientRequest, GetInfo, GetWorldStats, Preload,
    Prepare, RtcSenders, SyncWorld, Tick, TransportJoinRequest, TransportLeaveRequest,
    WorldStatsResponse,
};

pub use models::*;

pub type WsSender = mpsc::UnboundedSender<Vec<u8>>;

#[derive(Serialize, Deserialize)]
pub struct OnJoinRequest {
    world: String,
    username: String,
}

#[derive(Serialize, Deserialize)]
struct OnActionRequest {
    action: String,
    data: Value,
}

type ServerInfoHandle = fn(&Server) -> Value;

fn default_info_handle(server: &Server) -> Value {
    let mut info = HashMap::new();

    info.insert(
        "lost_sessions".to_owned(),
        json!(server.lost_sessions.len()),
    );

    let mut connections = HashMap::with_capacity(server.connections.len());

    for (id, (_, world, _)) in server.connections.iter() {
        connections.insert(id.to_owned(), json!(world));
    }

    info.insert("connections".to_owned(), json!(connections));

    let mut transports = Vec::with_capacity(server.transport_sessions.len());

    for (id, _) in server.transport_sessions.iter() {
        transports.push(id.to_owned());
    }

    info.insert("transports".to_owned(), json!(transports));

    serde_json::to_value(info).unwrap()
}

/// A websocket server for Voxelize, holds all worlds data, and runs as a background
/// system service.
pub struct Server {
    /// The port that this voxelize server is running on.
    pub port: u16,

    /// The address that this voxelize server is running on.
    pub addr: String,

    /// Whether or not if the socket server has started as a system service.
    pub started: bool,

    /// Static folder to serve from.
    pub serve: String,

    /// Whether the server should show debug information.
    pub debug: bool,

    /// Interval to tick the server at.
    pub interval: u64,

    /// A secret to join the server.
    pub secret: Option<String>,

    /// A map of all the worlds.
    pub worlds: HashMap<String, Addr<SyncWorld>>,

    /// Registry of the server.
    pub registry: Registry,

    /// Session IDs and senders who haven't connected to a world.
    /// Value: (sender, connection_token)
    pub lost_sessions: HashMap<String, (WsSender, String)>,

    /// Transport sessions, not connected to any particular world.
    pub transport_sessions: HashMap<String, WsSender>,

    /// What world each client ID is connected to, client ID <-> world ID.
    /// Value: (sender, world_name, connection_token)
    pub connections: HashMap<String, (WsSender, String, String)>,

    /// The information sent to the client when requested.
    info_handle: ServerInfoHandle,

    /// The handler for `Action`s.
    action_handles: HashMap<String, Arc<dyn Fn(Value, &mut Server)>>,

    /// WebRTC senders for hybrid networking.
    rtc_senders: Option<RtcSenders>,
}

impl Server {
    /// Create a new Voxelize server instance used to host all the worlds.
    pub fn new() -> ServerBuilder {
        ServerBuilder::new()
    }

    /// Set the RTC senders for hybrid WebSocket/WebRTC networking.
    pub fn set_rtc_senders(&mut self, rtc_senders: RtcSenders) {
        self.rtc_senders = Some(rtc_senders);
    }

    /// Get the RTC senders reference.
    pub fn rtc_senders(&self) -> Option<&RtcSenders> {
        self.rtc_senders.as_ref()
    }

    /// Add a world instance to the server. Different worlds have different configurations, and can hold
    /// their own set of clients within. If the server has already started, the added world will be
    /// started right away.
    pub fn add_world(&mut self, mut world: World) -> Result<&mut Addr<SyncWorld>, AddWorldError> {
        let name = world.name.clone();
        let saving = world.config().saving;
        let save_dir = world.config().save_dir.clone();
        world.ecs_mut().insert(self.registry.clone());

        if let Some(rtc_senders) = &self.rtc_senders {
            world.ecs_mut().insert(rtc_senders.clone());
        }

        let addr = world.start();

        if self.worlds.insert(name.clone(), addr).is_some() {
            return Err(AddWorldError);
        }

        info!(
            "World created: {} ({})",
            name,
            if saving {
                format!("on-disk @ {}", save_dir)
            } else {
                "in-memory".to_owned()
            }
        );

        Ok(self.worlds.get_mut(&name).unwrap())
    }

    // /// Create a world in the server. Different worlds have different configurations, and can hold
    // /// their own set of clients within. If the server has already started, the added world will be
    // /// started right away.
    // pub fn create_world(
    //     &mut self,
    //     name: &str,
    //     config: &WorldConfig,
    // ) -> Result<&mut Addr<SyncWorld>, AddWorldError> {
    //     let mut world = World::new(name, config);
    //     world.ecs_mut().insert(self.registry.clone());
    //     self.add_world(world)
    // }

    /// Get a world reference by name.
    pub fn get_world(&self, world_name: &str) -> Option<&Addr<SyncWorld>> {
        self.worlds.get(world_name)
    }

    /// Get a mutable world reference by name.
    pub fn get_world_mut(&mut self, world_name: &str) -> Option<&mut Addr<SyncWorld>> {
        self.worlds.get_mut(world_name)
    }

    /// Get the information of the server
    pub fn get_info(&mut self) -> Value {
        (self.info_handle)(self)
    }

    /// Handler for client's message.
    pub(crate) fn on_request(&mut self, id: &str, data: Message) -> Option<String> {
        if data.r#type == MessageType::Join as i32 {
            let json: OnJoinRequest = serde_json::from_str(&data.json)
                .expect("`on_join` error. Could not read JSON string.");

            if !self.lost_sessions.contains_key(id) {
                return Some(format!(
                    "Client at {} is already in world: {}",
                    id, json.world
                ));
            }

            if let Some(world) = self.worlds.get_mut(&json.world) {
                if let Some((sender, token)) = self.lost_sessions.remove(id) {
                    world.do_send(ClientJoinRequest {
                        id: id.to_owned(),
                        username: json.username,
                        sender: sender.clone(),
                    });
                    self.connections
                        .insert(id.to_owned(), (sender, json.world, token));
                    return None;
                }

                return Some("Something went wrong with joining. Maybe you called .join twice on the client?".to_owned());
            }

            return Some(format!(
                "ID {} is attempting to connect to a non-existent world!",
                id
            ));
        } else if data.r#type == MessageType::Leave as i32 {
            if let Some(world) = self.worlds.get_mut(&data.text) {
                if let Some((sender, _, token)) = self.connections.remove(id) {
                    self.lost_sessions
                        .insert(id.to_owned(), (sender, token));

                    world.do_send(ClientLeaveRequest { id: id.to_owned() });
                }
            }

            return None;
        } else if data.r#type == MessageType::Action as i32 {
            self.on_action(id, &data);

            return None;
        } else if data.r#type == MessageType::Transport as i32
            || self.transport_sessions.contains_key(id)
        {
            if !self.transport_sessions.contains_key(id) {
                return Some(
                    "Someone who isn't a transport server is attempting to transport.".to_owned(),
                );
            }

            if data.text.is_empty() {
                return Some(format!(
                    "Transport message missing world name (text field empty). Message type: {:?}",
                    MessageType::try_from(data.r#type)
                        .map(|t| format!("{:?}", t))
                        .unwrap_or_else(|_| data.r#type.to_string())
                ));
            }

            if let Some(world) = self.get_world_mut(&data.text) {
                world.do_send(ClientRequest {
                    client_id: id.to_owned(),
                    data,
                });

                return None;
            } else {
                return Some(format!(
                    "Transport message for unknown world '{}'. Message type: {:?}",
                    data.text,
                    MessageType::try_from(data.r#type)
                        .map(|t| format!("{:?}", t))
                        .unwrap_or_else(|_| data.r#type.to_string())
                ));
            }
        }

        let Some((_, world_name, _)) = self.connections.get(id) else {
            return Some("You are not connected to a world!".to_owned());
        };

        let world_name = world_name.clone();
        if let Some(world) = self.get_world_mut(&world_name) {
            world.do_send(ClientRequest {
                client_id: id.to_owned(),
                data,
            });
        }

        None
    }

    /// Prepare all worlds on the server to start.
    pub async fn prepare(&mut self) {
        for world in self.worlds.values() {
            world.do_send(Prepare);
        }
    }

    /// Preload all the worlds.
    pub async fn preload(&mut self) {
        let m = MultiProgress::new();
        let sty = ProgressStyle::with_template(
            "[{elapsed_precise}] [{bar:40.cyan/blue}] {msg} {spinner:.green} {percent:>7}%",
        )
        .unwrap()
        .progress_chars("#>-");

        let info_results = join_all(self.worlds.values().map(|world| world.send(GetInfo))).await;
        let mut infos = Vec::with_capacity(info_results.len());
        for info_result in info_results {
            infos.push(info_result.unwrap());
        }

        let mut bars = Vec::with_capacity(self.worlds.len());
        for (world, info) in self.worlds.values().zip(infos.iter()) {
            if !info.config.preload {
                bars.push(None);
                continue;
            }

            world.do_send(Preload);

            let bar = m.insert_from_back(0, ProgressBar::new(100));
            bar.set_message(info.name.clone());
            bar.set_style(sty.clone());
            bar.set_position(0);
            bars.push(Some(bar));
        }

        let start = Instant::now();

        loop {
            let info_results =
                join_all(self.worlds.values().map(|world| world.send(GetInfo))).await;
            let mut infos = Vec::with_capacity(info_results.len());
            for info_result in info_results {
                infos.push(info_result.unwrap());
            }

            let mut done = true;

            for (i, (world, info)) in self.worlds.values().zip(infos.iter()).enumerate() {
                if bars[i].is_none() || !info.config.preload {
                    continue;
                }

                let bar = bars[i].as_mut().unwrap();

                if !info.preloading || info.preload_progress >= 1.0 {
                    bar.finish_and_clear();
                    continue;
                }

                world.do_send(Tick);

                let at = (info.preload_progress * 100.0) as u64;

                done = false;
                bar.set_position(at);
            }

            if done {
                m.clear().unwrap();
                break;
            }
        }

        let preload_len = infos.iter().filter(|info| info.config.preload).count();

        info!(
            "✅ Total of {} world{} preloaded in {}s",
            preload_len,
            if preload_len == 1 { "" } else { "s" },
            (Instant::now() - start).as_millis() as f64 / 1000.0
        );
    }

    /// Tick every world on this server.
    pub(crate) fn tick(&mut self) {
        for world in self.worlds.values() {
            world.do_send(Tick);
        }
    }

    /// Setup Fern for debug logging.
    fn setup_logger() {
        fern::Dispatch::new()
            .format(|out, message, record| {
                let colors = ColoredLevelConfig::new().info(Color::Green);

                out.finish(format_args!(
                    "{} [{}] [{}]: {}",
                    chrono::Local::now().format("[%H:%M:%S]"),
                    colors.color(record.level()),
                    record.target(),
                    message
                ))
            })
            .level(log::LevelFilter::Debug)
            .level_for("tungstenite", log::LevelFilter::Info)
            .level_for("webrtc", log::LevelFilter::Warn)
            .level_for("webrtc_ice", log::LevelFilter::Warn)
            .level_for("webrtc_sctp", log::LevelFilter::Warn)
            .level_for("webrtc_dtls", log::LevelFilter::Warn)
            .level_for("webrtc_srtp", log::LevelFilter::Warn)
            .level_for("webrtc_data", log::LevelFilter::Warn)
            .level_for("webrtc_mdns", log::LevelFilter::Warn)
            .level_for("webrtc_util", log::LevelFilter::Warn)
            .chain(std::io::stdout())
            .apply()
            .expect("Fern did not run successfully");
    }

    pub fn set_action_handle<F: Fn(Value, &mut Server) + 'static>(
        &mut self,
        action: &str,
        handle: F,
    ) {
        self.action_handles
            .insert(action.to_lowercase(), Arc::new(handle));
    }

    /// Handler for `Action` type messages.
    fn on_action(&mut self, _: &str, data: &Message) {
        let json: OnActionRequest = serde_json::from_str(&data.json)
            .expect("`on_action` error. Could not read JSON string.");
        let action = json.action.to_lowercase();

        info!("{:?}", &self.action_handles.keys());
        info!("{:?}", &action);

        if !self.action_handles.contains_key(&action) {
            warn!(
                "`Action` type messages received of type {}, but no action handler set.",
                action
            );
            return;
        }

        let handle = self.action_handles.get(&action).unwrap().to_owned();

        handle(json.data, self);
    }
}

/// New chat session is created. Returns (client_id, connection_token).
#[derive(ActixMessage)]
#[rtype(result = "(String, String)")]
pub struct Connect {
    pub id: Option<String>,
    pub is_transport: bool,
    pub sender: WsSender,
}

/// Session is disconnected
#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct Disconnect {
    pub id: String,
    /// The connection token assigned when this session was created.
    /// Used to distinguish stale disconnects from kicked sessions.
    pub token: String,
}

#[derive(ActixMessage)]
#[rtype(result = "Value")]
pub struct Info;

#[derive(ActixMessage)]
#[rtype(result = "Vec<WorldStatsResponse>")]
pub struct GetAllWorldStats;

/// Send message to specific world
#[derive(ActixMessage)]
#[rtype(result = "Option<String>")]
pub struct ClientMessage {
    /// Id of the client session
    pub id: String,

    /// Protobuf message
    pub data: Message,
}

/// Make actor from `ChatServer`
impl Actor for Server {
    /// We are going to use simple Context, we just need ability to communicate
    /// with other actors.
    type Context = Context<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        // Set up a recurring task to tick all worlds
        ctx.run_interval(Duration::from_millis(self.interval), |act, _| {
            act.tick();
        });
    }
}

/// Handler for Connect message.
///
/// Register new session and assign unique id to this session.
/// Returns (client_id, connection_token).
impl Handler<Connect> for Server {
    type Result = MessageResult<Connect>;

    fn handle(&mut self, msg: Connect, _: &mut Context<Self>) -> Self::Result {
        let id = if msg.id.is_none() {
            nanoid!()
        } else {
            msg.id.unwrap()
        };

        let token = nanoid!();

        if msg.is_transport {
            self.worlds.values().for_each(|world| {
                world.do_send(TransportJoinRequest {
                    id: id.clone(),
                    sender: msg.sender.clone(),
                })
            });

            self.transport_sessions.insert(id.to_owned(), msg.sender);

            return MessageResult((id, token));
        }

        let kick_msg = encode_message(
            &Message::new(&MessageType::Error)
                .text("Another session connected with your account.")
                .build(),
        );

        if let Some((old_sender, _old_token)) = self.lost_sessions.remove(&id) {
            info!("Kicking duplicate pre-join session: {}", id);
            let _ = old_sender.send(kick_msg.clone());
        }

        if let Some((old_sender, world_name, _old_token)) = self.connections.remove(&id) {
            info!("Kicking duplicate in-world session: {}", id);
            let _ = old_sender.send(kick_msg);
            if let Some(world) = self.worlds.get_mut(&world_name) {
                world.do_send(ClientLeaveRequest { id: id.clone() });
            }
        }

        self.lost_sessions
            .insert(id.to_owned(), (msg.sender, token.clone()));

        MessageResult((id, token))
    }
}

/// Handler for Disconnect message.
/// Only cleans up session state if the connection token matches the currently
/// registered token, preventing stale disconnects from kicked sessions from
/// removing the new session's state.
impl Handler<Disconnect> for Server {
    type Result = ();

    fn handle(&mut self, msg: Disconnect, _: &mut Context<Self>) {
        // Check connections: only remove if the token matches the current session
        if let Some((_, _, current_token)) = self.connections.get(&msg.id) {
            if *current_token == msg.token {
                let (_, world_name, _) = self.connections.remove(&msg.id).unwrap();
                if let Some(world) = self.worlds.get_mut(&world_name) {
                    world.do_send(ClientLeaveRequest { id: msg.id.clone() });
                }
            } else {
                info!(
                    "Ignoring stale disconnect for {} (token mismatch)",
                    msg.id
                );
            }
        }

        if let Some(_) = self.transport_sessions.remove(&msg.id) {
            self.worlds.values().for_each(|world| {
                world.do_send(TransportLeaveRequest { id: msg.id.clone() });
            });

            info!("A transport server connection has ended.")
        }

        // Check lost_sessions: only remove if the token matches
        if let Some((_, current_token)) = self.lost_sessions.get(&msg.id) {
            if *current_token == msg.token {
                self.lost_sessions.remove(&msg.id);
            }
        }
    }
}

/// Handler for server info request.
impl Handler<Info> for Server {
    type Result = MessageResult<Info>;

    fn handle(&mut self, _: Info, _: &mut Context<Self>) -> Self::Result {
        MessageResult(self.get_info())
    }
}

/// Handler for getting all world stats.
impl Handler<GetAllWorldStats> for Server {
    type Result = actix::ResponseActFuture<Self, Vec<WorldStatsResponse>>;

    fn handle(&mut self, _: GetAllWorldStats, _: &mut Context<Self>) -> Self::Result {
        let mut world_addrs = Vec::with_capacity(self.worlds.len());
        world_addrs.extend(self.worlds.values().cloned());

        Box::pin(wrap_future(async move {
            let mut stats = Vec::with_capacity(world_addrs.len());
            for addr in world_addrs {
                if let Ok(world_stats) = addr.send(GetWorldStats).await {
                    stats.push(world_stats);
                }
            }
            stats
        }))
    }
}

/// Handler for Message message.
impl Handler<ClientMessage> for Server {
    type Result = Option<String>;

    fn handle(&mut self, msg: ClientMessage, _: &mut Context<Self>) -> Self::Result {
        self.on_request(&msg.id, msg.data)
    }
}

const DEFAULT_DEBUG: bool = true;
const DEFAULT_PORT: u16 = 4000;
const DEFAULT_ADDR: &str = "0.0.0.0";
const DEFAULT_SERVE: &str = "";
const DEFAULT_INTERVAL: u64 = 16;

/// Builder for a voxelize server.
pub struct ServerBuilder {
    port: u16,
    debug: bool,
    addr: String,
    serve: String,
    interval: u64,
    secret: Option<String>,
    registry: Option<Registry>,
}

impl ServerBuilder {
    /// Create a new server builder instance.
    pub fn new() -> Self {
        Self {
            debug: DEFAULT_DEBUG,
            port: DEFAULT_PORT,
            addr: DEFAULT_ADDR.to_owned(),
            serve: DEFAULT_SERVE.to_owned(),
            interval: DEFAULT_INTERVAL,
            secret: None,
            registry: None,
        }
    }

    /// Configure the port to the voxelize server.
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    /// Configure the address of the voxelize server.
    pub fn addr(mut self, addr: &str) -> Self {
        self.addr = addr.to_owned();
        self
    }

    /// Configure whether or not the voxelize server should be in debug mode.
    pub fn debug(mut self, debug: bool) -> Self {
        self.debug = debug;
        self
    }

    /// Configure the static folder to serve.
    pub fn serve(mut self, serve: &str) -> Self {
        self.serve = serve.to_owned();
        self
    }

    /// Configure the interval for the server to tick at.
    pub fn interval(mut self, interval: u64) -> Self {
        self.interval = interval;
        self
    }

    /// Configure the secret for the server to be able to join.
    pub fn secret(mut self, secret: &str) -> Self {
        self.secret = Some(secret.to_owned());
        self
    }

    /// Configure the block registry of the server. Once a registry is configured, mutating it wouldn't
    /// change the server's block list.
    pub fn registry(mut self, registry: &Registry) -> Self {
        self.registry = Some(registry.to_owned());
        self
    }

    /// Instantiate a voxelize server instance.
    pub fn build(self) -> Server {
        let mut registry = self.registry.unwrap_or(Registry::new());
        registry.generate();

        if self.debug {
            Server::setup_logger();
        }

        Server {
            port: self.port,
            addr: self.addr,
            serve: self.serve,
            debug: self.debug,
            interval: self.interval,
            secret: self.secret,

            registry,

            started: false,

            connections: HashMap::default(),
            lost_sessions: HashMap::default(),
            transport_sessions: HashMap::default(),
            worlds: HashMap::default(),
            info_handle: default_info_handle,
            action_handles: HashMap::default(),
            rtc_senders: None,
        }
    }
}
