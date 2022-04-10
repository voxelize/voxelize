use hashbrown::HashMap;
use nanoid::nanoid;
use specs::{World as ECSWorld, WorldExt};

use super::network::{
    models::{Message, MessageType},
    Client,
};

mod config;

pub use self::config::WorldConfig;

#[derive(Default)]
pub struct World {
    pub id: String,
    pub name: String,

    pub config: WorldConfig,

    ecs: ECSWorld,
    clients: HashMap<String, Client>,
}

pub enum ClientFilter {
    All,
    Include(Vec<String>),
    Exclude(Vec<String>),
}

impl World {
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

    pub fn has_client(&self, id: &str) -> bool {
        self.clients.contains_key(id)
    }

    pub fn add_client(&mut self, client: Client) -> String {
        let id = nanoid!();
        self.clients.insert(id.clone(), client);
        id
    }

    pub fn remove_client(&mut self, id: &str) -> Option<Client> {
        self.clients.remove(id)
    }

    pub fn on_request(&mut self, id: &str, data: Message) {
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(id, data),
            MessageType::Chunk => self.on_chunk(id, data),
            MessageType::Signal => self.on_signal(id, data),
            _ => {}
        }
    }

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

    pub fn tick(&mut self) {}

    fn on_peer(&mut self, id: &str, data: Message) {}

    fn on_signal(&mut self, id: &str, data: Message) {}

    fn on_chunk(&mut self, id: &str, data: Message) {}
}
