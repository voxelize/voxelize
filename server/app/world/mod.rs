use hashbrown::HashMap;
use nanoid::nanoid;
use specs::{World as ECSWorld, WorldExt};

use super::network::{
    models::{Message, MessageType},
    Client,
};

mod config;

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

    /// Entity component system world.
    ecs: ECSWorld,

    /// A map of all clients within this world.
    clients: HashMap<String, Client>,
}

/// A filter for clients, used for specific broadcasting.
pub enum ClientFilter {
    All,
    Include(Vec<String>),
    Exclude(Vec<String>),
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

    /// Check if the world has a specific client with id of `id`.
    pub fn has_client(&self, id: &str) -> bool {
        self.clients.contains_key(id)
    }

    /// Add a client to the world, with ID generated with `nanoid!()`.
    pub fn add_client(&mut self, client: Client) -> String {
        let id = nanoid!();
        self.clients.insert(id.clone(), client);
        id
    }

    /// Remove a client from the world by id.
    pub fn remove_client(&mut self, id: &str) -> Option<Client> {
        self.clients.remove(id)
    }

    /// Handler for protobuf requests from clients.
    pub fn on_request(&mut self, id: &str, data: Message) {
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(id, data),
            MessageType::Chunk => self.on_chunk(id, data),
            MessageType::Signal => self.on_signal(id, data),
            _ => {}
        }
    }

    /// Broadcast a protobuf message to a subset or all of the clients in the world. Simultaneously,
    /// remove all the inactive clients that aren't receiving messages.
    pub fn broadcast(&mut self, data: Message, filter: ClientFilter) -> Vec<Client> {
        let mut resting_players = vec![];

        self.clients.iter().for_each(|(id, client)| {
            match &filter {
                ClientFilter::All => {}
                ClientFilter::Include(ids) => {
                    if !ids.iter().any(|i| *i == *id) {
                        return;
                    }
                }
                ClientFilter::Exclude(ids) => {
                    if ids.iter().any(|i| *i == *id) {
                        return;
                    }
                }
            };

            // TODO: check if is error
            if client.try_send(data.to_owned()).is_err() {
                resting_players.push(id.clone());
            }
        });

        let mut inactives = vec![];

        resting_players.iter().for_each(|id| {
            if let Some(player) = self.remove_client(id) {
                inactives.push(player);
            }
        });

        inactives
    }

    /// Tick of the world, run every 16ms.
    pub fn tick(&mut self) {}

    /// Handler for `Peer` type messages.
    fn on_peer(&mut self, id: &str, data: Message) {}

    /// Handler for `Signal` type messages.
    fn on_signal(&mut self, id: &str, data: Message) {}

    /// Handler for `Chunk` type messages.
    fn on_chunk(&mut self, id: &str, data: Message) {}
}
