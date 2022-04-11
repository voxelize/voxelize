use fern::colors::{Color, ColoredLevelConfig};
use hashbrown::{HashMap, HashSet};
use log::{info, warn};
use message_io::{network::Endpoint, node::NodeHandler};

use crate::{
    app::{network::models::MessageType, world::World},
    WorldConfig,
};

use super::models::Message;

/// A websocket server for Voxelize, holds all worlds data, and runs as a background
/// system service.
#[derive(Default)]
pub struct Server {
    /// The port that this voxelize server is running on.
    pub port: u16,

    /// Whether or not if the socket server has started as a system service.
    pub started: bool,

    /// Network handler
    handler: Option<NodeHandler<()>>,

    /// A map of all the worlds.
    worlds: HashMap<String, World>,

    /// Endpoints who haven't connected to a world.
    lost_endpoints: HashSet<Endpoint>,

    /// What world each endpoint is connected to, endpoint <-> world ID.
    connections: HashMap<Endpoint, String>,
}

impl Server {
    pub fn new(port: u16) -> ServerBuilder {
        Server::setup_logger();

        ServerBuilder { port }
    }

    /// Assign a network handler to this server
    pub fn set_handler(&mut self, handler: NodeHandler<()>) {
        self.worlds.values_mut().for_each(|world| {
            world.handler = Some(handler.clone());
        });

        self.handler = Some(handler);
    }

    /// Add an endpoint, without assigning them to a world. Endpoint(client) needs to pass a `CONNECT` type
    /// protocol buffer with a world name to be assigned to a world.
    pub fn add_endpoint(&mut self, endpoint: Endpoint) {
        self.lost_endpoints.insert(endpoint);
    }

    /// Create a world in the server. Different worlds have different configurations, and can hold
    /// their own set of clients within. If the server has already started, the added world will be
    /// started right away.
    pub fn create_world(&mut self, name: &str, config: &WorldConfig) {
        let world = World::new(name, config.to_owned());

        if let Some(_) = self.worlds.insert(world.id.to_owned(), world) {
            panic!("Cannot create a world with the same name: {}", name);
        };

        info!("🌎 World created: {}", name);
    }

    pub fn broadcast(&self, data: Message) {
        todo!()
    }

    pub fn on_request(&mut self, endpoint: Endpoint, data: Message) {
        if data.r#type == MessageType::Connect as i32 {
            if !self.worlds.contains_key(&data.text) {
                warn!(
                    "Endpoint {} is attempting to connect to a non-existent world!",
                    endpoint
                );
                return;
            }

            self.lost_endpoints.remove(&endpoint);
            self.connections
                .insert(endpoint.to_owned(), data.text.to_owned());

            return;
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

    pub fn on_leave(&mut self, endpoint: Endpoint) {
        if let Some(world_name) = self.connections.remove(&endpoint) {
            if let Some(world) = self.get_world_mut(&world_name) {
                world.remove_client(&endpoint);
            }
        }

        self.lost_endpoints.remove(&endpoint);
    }

    pub fn handler(&self) -> &NodeHandler<()> {
        if self.handler.is_none() {
            panic!("Attempting to make network calls when handler isn't set.");
        }

        self.handler.as_ref().unwrap()
    }

    /// Get a world reference by name.
    fn get_world(&self, world_name: &str) -> Option<&World> {
        self.worlds.get(world_name)
    }

    /// Get a mutable world reference by name.
    fn get_world_mut(&mut self, world_name: &str) -> Option<&mut World> {
        self.worlds.get_mut(world_name)
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
            .chain(std::io::stdout())
            .apply()
            .expect("Fern did not run successfully");
    }
}

/// Builder for a voxelize server.
#[derive(Default)]
pub struct ServerBuilder {
    port: u16,
}

impl ServerBuilder {
    /// Configure the port to the voxelize server.
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    /// Instantiate a voxelize server instance.
    pub fn build(self) -> Server {
        Server {
            port: self.port,

            started: false,

            ..Default::default()
        }
    }
}
