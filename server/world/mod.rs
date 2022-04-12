use hashbrown::HashMap;
use log::info;
use message_io::{network::Endpoint, node::NodeHandler};
use nanoid::nanoid;
use specs::{World as ECSWorld, WorldExt};

use super::{
    common::ClientFilter,
    network::models::{encode_message, Message, MessageType},
};

mod client;
mod config;

use self::client::Client;
pub use self::config::WorldConfig;

/// A voxelize world.
#[derive(Default)]
pub struct World {
    /// ID of the world, generated from `nanoid!()`.
    pub id: String,

    /// Name of the world, used for connection.
    pub name: String,

    /// World configurations, containing information of how the world operates, such as `chunk_size`.
    pub config: WorldConfig,

    /// Network handler passed down from the server.
    pub handler: Option<NodeHandler<()>>,

    /// Entity component system world.
    ecs: ECSWorld,

    /// A map of all clients within this world, endpoint <-> client.
    clients: HashMap<Endpoint, Client>,
}

impl World {
    /// Create a new voxelize world.
    pub fn new(name: &str, config: WorldConfig) -> Self {
        let id = nanoid!();

        let ecs = ECSWorld::new();

        Self {
            id,
            name: name.to_owned(),

            config,
            ecs,

            ..Default::default()
        }
    }

    /// Get a reference to the ECS world.
    pub fn ecs(&self) -> &ECSWorld {
        &self.ecs
    }

    /// Get a mutable reference to the ECS world
    pub fn ecs_mut(&mut self) -> &mut ECSWorld {
        &mut self.ecs
    }

    /// Check if the world has a specific client at endpoint
    pub fn has_client(&self, endpoint: &Endpoint) -> bool {
        self.clients.contains_key(endpoint)
    }

    /// Add a client to the world, with ID generated with `nanoid!()`.
    pub fn add_client(&mut self, endpoint: &Endpoint) -> String {
        let id = nanoid!();
        self.clients
            .insert(endpoint.clone(), Client { id: id.to_owned() });
        id
    }

    /// Remove a client from the world by endpoint.
    pub fn remove_client(&mut self, endpoint: &Endpoint) -> Option<Client> {
        self.clients.remove(endpoint)
    }

    /// Handler for protobuf requests from clients.
    pub fn on_request(&mut self, endpoint: &Endpoint, data: Message) {
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(endpoint, data),
            MessageType::Chunk => self.on_chunk(endpoint, data),
            MessageType::Signal => self.on_signal(endpoint, data),
            _ => {}
        }
    }

    /// Broadcast a protobuf message to a subset or all of the clients in the world.
    pub fn broadcast(&mut self, data: Message, filter: ClientFilter) {
        let encoded = encode_message(&data);

        self.clients.iter().for_each(|(endpoint, client)| {
            match &filter {
                ClientFilter::All => {}
                ClientFilter::Include(ids) => {
                    if !ids.iter().any(|i| *i == *client.id) {
                        return;
                    }
                }
                ClientFilter::Exclude(ids) => {
                    if ids.iter().any(|i| *i == *client.id) {
                        return;
                    }
                }
            };

            // TODO: check if is error
            self.handler().network().send(*endpoint, &encoded);
        });
    }

    /// Tick of the world, run every 16ms.
    pub fn tick(&mut self) {
        if self.clients.is_empty() {
            return;
        }
    }

    /// Access the network handler, panic if it DNE.
    pub fn handler(&self) -> &NodeHandler<()> {
        if self.handler.is_none() {
            panic!("Attempting to make network calls when handler isn't set.");
        }

        self.handler.as_ref().unwrap()
    }

    /// Handler for `Peer` type messages.
    fn on_peer(&mut self, endpoint: &Endpoint, data: Message) {}

    /// Handler for `Signal` type messages.
    fn on_signal(&mut self, endpoint: &Endpoint, data: Message) {}

    /// Handler for `Chunk` type messages.
    fn on_chunk(&mut self, endpoint: &Endpoint, data: Message) {}
}
