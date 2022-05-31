mod content;
mod models;
mod request;
mod response;

use fern::colors::{Color, ColoredLevelConfig};
use hashbrown::{HashMap, HashSet};
use log::{info, warn};
use message_io::{network::Endpoint, node::NodeHandler};

use crate::{
    errors::AddWorldError,
    world::{Registry, World, WorldConfig},
};

pub use content::*;
pub use models::*;
pub use request::*;
pub use response::*;

/// A websocket server for Voxelize, holds all worlds data, and runs as a background
/// system service.
pub struct Server {
    /// The port that this voxelize server is running on.
    pub port: u16,

    /// The address that this voxelize server is running on.
    pub addr: String,

    /// Whether or not if the socket server has started as a system service.
    pub started: bool,

    /// Network handler
    handler: Option<NodeHandler<()>>,

    /// A map of all the worlds.
    worlds: HashMap<String, World>,

    /// Registry of the server.
    registry: Registry,

    /// Endpoints who haven't connected to a world.
    lost_endpoints: HashSet<Endpoint>,

    /// What world each endpoint is connected to, endpoint <-> world ID.
    connections: HashMap<Endpoint, String>,
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
        ServerBuilder::default()
    }

    /// Assign a network handler to this server
    pub fn set_handler(&mut self, handler: NodeHandler<()>) {
        self.worlds.values_mut().for_each(|world| {
            world.ecs_mut().insert(handler.clone());
        });

        self.handler = Some(handler);
    }

    /// Add an endpoint, without assigning them to a world. Endpoint(client) needs to pass a `CONNECT` type
    /// protocol buffer with a world name to be assigned to a world.
    pub fn add_endpoint(&mut self, endpoint: Endpoint) {
        self.lost_endpoints.insert(endpoint);
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

    /// Handler for client's message.
    pub fn on_request(&mut self, endpoint: Endpoint, data: Message) {
        if data.r#type == MessageType::Join as i32 {
            if !self.lost_endpoints.contains(&endpoint) {
                warn!("Client at {} is already in world: {}", endpoint, data.text);
                return;
            }

            if let Some(world) = self.worlds.get_mut(&data.text) {
                self.lost_endpoints.remove(&endpoint);
                self.connections
                    .insert(endpoint.to_owned(), data.text.to_owned());

                world.add_client(&endpoint);

                info!(
                    "Client at {} joined the server to world: {}",
                    endpoint, data.text
                );

                return;
            }

            warn!(
                "Endpoint {} is attempting to connect to a non-existent world!",
                endpoint
            );

            return;
        } else if data.r#type == MessageType::Leave as i32 {
            if let Some(world) = self.worlds.get_mut(&data.text) {
                self.connections.remove(&endpoint);
                self.lost_endpoints.insert(endpoint);

                world.remove_client(&endpoint);

                info!(
                    "Client at {} joined the server to world: {}",
                    endpoint, data.text
                );

                return;
            }
        }

        let world_name = self.connections.get(&endpoint);
        if world_name.is_none() {
            return;
        }

        let world_name = world_name.unwrap().to_owned();

        if let Some(world) = self.get_world_mut(&world_name) {
            world.on_request(&endpoint, data);
        }
    }

    /// Handler for client leaving.
    pub fn on_leave(&mut self, endpoint: Endpoint) {
        if let Some(world_name) = self.connections.remove(&endpoint) {
            if let Some(world) = self.get_world_mut(&world_name) {
                world.remove_client(&endpoint);
            }
        }

        info!("Client at {} left the server.", endpoint);

        self.lost_endpoints.remove(&endpoint);
    }

    /// Obtain the network handler.
    pub fn handler(&self) -> &NodeHandler<()> {
        if self.handler.is_none() {
            panic!("Attempting to make network calls when handler isn't set.");
        }

        self.handler.as_ref().unwrap()
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

const DEFAULT_PORT: u16 = 4000;
const DEFAULT_ADDR: &str = "0.0.0.0";

/// Builder for a voxelize server.
#[derive(Default)]
pub struct ServerBuilder {
    port: Option<u16>,
    addr: Option<String>,
    registry: Option<Registry>,
}

impl ServerBuilder {
    /// Configure the port to the voxelize server.
    pub fn port(mut self, port: u16) -> Self {
        self.port = Some(port);
        self
    }

    /// Configure the address of the voxelize server.
    pub fn addr(mut self, addr: &str) -> Self {
        self.addr = Some(addr.to_owned());
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
            port: self.port.unwrap_or(DEFAULT_PORT),
            addr: self.addr.unwrap_or_else(|| DEFAULT_ADDR.to_owned()),

            registry,

            started: false,
            handler: None,

            connections: HashMap::default(),
            lost_endpoints: HashSet::default(),
            worlds: HashMap::default(),
        }
    }
}
