mod models;
mod session;

use std::time::Duration;

use actix::{
    Actor, AsyncContext, Context, Handler, Message as ActixMessage, MessageResult, Recipient,
};
use fern::colors::{Color, ColoredLevelConfig};
use hashbrown::HashMap;
use log::info;
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    errors::AddWorldError,
    world::{Registry, World, WorldConfig},
    SeededTerrain, Stats,
};

pub use models::*;
pub use session::*;

#[derive(Serialize, Deserialize)]
pub struct OnJoinRequest {
    world: String,
    username: String,
}

type ServerInfoHandle = fn(&Server) -> Value;

fn default_info_handle(server: &Server) -> Value {
    let mut info = HashMap::new();

    info.insert(
        "lost_sessions".to_owned(),
        json!(server.lost_sessions.len()),
    );

    let mut connections = HashMap::new();

    for (id, (_, world)) in server.connections.iter() {
        connections.insert(id.to_owned(), json!(world));
    }

    info.insert("connections".to_owned(), json!(connections));

    let mut transports = vec![];

    for (id, _) in server.transport_sessions.iter() {
        transports.push(id.to_owned());
    }

    info.insert("transports".to_owned(), json!(transports));

    let mut worlds = HashMap::new();

    for (name, world) in server.worlds.iter() {
        let mut world_info = HashMap::new();

        {
            let clients = world.clients();
            world_info.insert("clients".to_owned(), json!(clients.len()));
        }

        {
            let config = world.config();
            world_info.insert("config".to_owned(), json!(*config));
        }

        {
            let stats = world.read_resource::<Stats>();
            let mut stats_info = HashMap::new();

            stats_info.insert("tick".to_owned(), json!(stats.tick));
            stats_info.insert("delta".to_owned(), json!(stats.delta));

            world_info.insert("stats".to_owned(), json!(stats_info));
        }

        {
            let chunks = world.chunks();

            world_info.insert(
                "chunks".to_owned(),
                json!({
                    "count": chunks.map.len(),
                    "toUpdate": chunks.to_update.len(),
                    "toRemesh": chunks.to_remesh.len(),
                    "toSend": chunks.to_send.len(),
                    "toSave": chunks.to_save.len(),

                }),
            );
        }

        {
            let terrains = world.read_resource::<SeededTerrain>();
            let mut layers = vec![];

            terrains.layers.iter().for_each(|layer| {
                layers.push(json!(layer));
            });

            world_info.insert("terrains".to_owned(), json!(layers));
        }

        {
            let pipeline = world.pipeline();
            let stages = pipeline
                .stages
                .iter()
                .map(|stage| json!(stage.name()))
                .collect::<Vec<_>>();

            world_info.insert("pipeline".to_owned(), json!(stages));
        }

        worlds.insert(name.to_owned(), json!(world_info));
    }

    info.insert("worlds".to_owned(), json!(worlds));

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

    /// Interval to tick the server at.
    pub interval: u64,

    /// A secret to join the server.
    pub secret: Option<String>,

    /// A map of all the worlds.
    pub worlds: HashMap<String, World>,

    /// Registry of the server.
    pub registry: Registry,

    /// Session IDs and addresses who haven't connected to a world.
    pub lost_sessions: HashMap<String, Recipient<EncodedMessage>>,

    /// Transport sessions, not connect to any particular world.
    pub transport_sessions: HashMap<String, Recipient<EncodedMessage>>,

    /// What world each client ID is connected to, client ID <-> world ID.
    pub connections: HashMap<String, (Recipient<EncodedMessage>, String)>,

    /// The information sent to the client when requested.
    info_handle: ServerInfoHandle,
}

impl Server {
    /// Create a new Voxelize server instance used to host all the worlds.
    ///
    /// # Example
    ///
    /// ```
    /// // Create a server of port 4000 on "0.0.0.0"
    /// let server = Server::new().addr("0.0.0.0").port(4000).build();
    ///
    /// // Run the server on Voxelize
    /// Voxelize::run(server);
    /// ```
    pub fn new() -> ServerBuilder {
        Server::setup_logger();
        ServerBuilder::new()
    }

    /// Add a world instance to the server. Different worlds have different configurations, and can hold
    /// their own set of clients within. If the server has already started, the added world will be
    /// started right away.
    pub fn add_world(&mut self, mut world: World) -> Result<&mut World, AddWorldError> {
        let name = world.name.clone();
        world.ecs_mut().insert(self.registry.clone());

        if self.worlds.insert(name.to_owned(), world).is_some() {
            return Err(AddWorldError);
        };

        info!("🌎 World created: {}", name);

        Ok(self.worlds.get_mut(&name).unwrap())
    }

    /// Create a world in the server. Different worlds have different configurations, and can hold
    /// their own set of clients within. If the server has already started, the added world will be
    /// started right away.
    pub fn create_world(
        &mut self,
        name: &str,
        config: &WorldConfig,
    ) -> Result<&mut World, AddWorldError> {
        let mut world = World::new(name, config);
        world.ecs_mut().insert(self.registry.clone());
        self.add_world(world)
    }

    /// Get a world reference by name.
    pub fn get_world(&self, world_name: &str) -> Option<&World> {
        self.worlds.get(world_name)
    }

    /// Get a mutable world reference by name.
    pub fn get_world_mut(&mut self, world_name: &str) -> Option<&mut World> {
        self.worlds.get_mut(world_name)
    }

    /// Get the information of the server
    pub fn get_info(&mut self) -> Value {
        (self.info_handle)(self)
    }

    /// Handler for client's message.
    pub fn on_request(&mut self, id: &str, data: Message) -> Option<String> {
        if data.r#type == MessageType::Transport as i32 || self.transport_sessions.contains_key(id)
        {
            if !self.transport_sessions.contains_key(id) {
                return Some(
                    "Someone who isn't a transport server is attempting to transport.".to_owned(),
                );
            }

            if let Some(world) = self.get_world_mut(&data.text) {
                world.on_request(id, data);

                return None;
            } else {
                return Some(
                    "Transport message did not have a world. Use the 'text' field.".to_owned(),
                );
            }
        } else if data.r#type == MessageType::Join as i32 {
            let json: OnJoinRequest = serde_json::from_str(&data.json)
                .expect("`on_join` error. Could not read JSON string.");

            if !self.lost_sessions.contains_key(id) {
                return Some(format!(
                    "Client at {} is already in world: {}",
                    id, json.world
                ));
            }

            if let Some(world) = self.worlds.get_mut(&json.world) {
                if let Some(addr) = self.lost_sessions.remove(id) {
                    world.add_client(id, &json.username, &addr);
                    self.connections.insert(id.to_owned(), (addr, json.world));
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
                let (addr, _) = self.connections.remove(id).unwrap();
                self.lost_sessions.insert(id.to_owned(), addr);

                world.remove_client(id);
            }

            return None;
        }

        let connection = self.connections.get(id);
        if connection.is_none() {
            return Some("You are not connected to a world!".to_owned());
        }

        let (_, world_name) = connection.unwrap().to_owned();

        if let Some(world) = self.get_world_mut(&world_name) {
            world.on_request(id, data);
        }

        None
    }

    /// Prepare all worlds on the server to start.
    pub fn prepare(&mut self) {
        for world in self.worlds.values_mut() {
            world.prepare();
        }
    }

    /// Tick every world on this server.
    pub fn tick(&mut self) {
        for world in self.worlds.values_mut() {
            world.tick();
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
            .chain(std::io::stdout())
            .apply()
            .expect("Fern did not run successfully");
    }
}

/// New chat session is created
#[derive(ActixMessage)]
#[rtype(result = "String")]
pub struct Connect {
    pub id: Option<String>,
    pub is_transport: bool,
    pub addr: Recipient<EncodedMessage>,
}

#[derive(ActixMessage, Clone)]
#[rtype(result = "()")]
pub struct EncodedMessage(pub Vec<u8>);

/// Session is disconnected
#[derive(ActixMessage)]
#[rtype(result = "()")]
pub struct Disconnect {
    pub id: String,
}

#[derive(ActixMessage)]
#[rtype(result = "Value")]
pub struct Info;

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
        ctx.run_interval(Duration::from_millis(self.interval), |act, _| {
            act.tick();
        });
    }
}

/// Handler for Connect message.
///
/// Register new session and assign unique id to this session
impl Handler<Connect> for Server {
    type Result = MessageResult<Connect>;

    fn handle(&mut self, msg: Connect, _: &mut Context<Self>) -> Self::Result {
        // notify all users in same room
        // self.send_message("Main", "Someone joined", 0);

        // register session with random id
        let id = if msg.id.is_none() {
            nanoid!()
        } else {
            msg.id.unwrap()
        };

        if msg.is_transport {
            // Send init messages of the worlds to the transport.
            self.worlds
                .values_mut()
                .for_each(|world| world.add_transport(&id, &msg.addr));

            self.transport_sessions.insert(id.to_owned(), msg.addr);

            return MessageResult(id);
        }

        if self.lost_sessions.contains_key(&id) {
            return MessageResult(nanoid!());
        }

        self.lost_sessions.insert(id.to_owned(), msg.addr);

        // send id back
        MessageResult(id)
    }
}

/// Handler for Disconnect message.
impl Handler<Disconnect> for Server {
    type Result = ();

    fn handle(&mut self, msg: Disconnect, _: &mut Context<Self>) {
        if let Some((_, world_name)) = self.connections.remove(&msg.id) {
            if let Some(world) = self.worlds.get_mut(&world_name) {
                world.remove_client(&msg.id);
            }
        }

        if let Some(_) = self.transport_sessions.remove(&msg.id) {
            self.worlds.values_mut().for_each(|world| {
                world.remove_transport(&msg.id);
            });

            info!("A transport server connection has ended.")
        }

        self.lost_sessions.remove(&msg.id);
    }
}

/// Handler for server info request.
impl Handler<Info> for Server {
    type Result = MessageResult<Info>;

    fn handle(&mut self, _: Info, _: &mut Context<Self>) -> Self::Result {
        MessageResult(self.get_info())
    }
}

/// Handler for Message message.
impl Handler<ClientMessage> for Server {
    type Result = Option<String>;

    fn handle(&mut self, msg: ClientMessage, _: &mut Context<Self>) -> Self::Result {
        self.on_request(&msg.id, msg.data)
    }
}

const DEFAULT_PORT: u16 = 4000;
const DEFAULT_ADDR: &str = "0.0.0.0";
const DEFAULT_SERVE: &str = "./";
const DEFAULT_INTERVAL: u64 = 8;

/// Builder for a voxelize server.
pub struct ServerBuilder {
    port: u16,
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
        let mut registry = self.registry.unwrap_or_default();
        registry.generate();

        Server {
            port: self.port,
            addr: self.addr,
            serve: self.serve,
            interval: self.interval,
            secret: self.secret,

            registry,

            started: false,

            connections: HashMap::default(),
            lost_sessions: HashMap::default(),
            transport_sessions: HashMap::default(),
            worlds: HashMap::default(),
            info_handle: default_info_handle,
        }
    }
}
