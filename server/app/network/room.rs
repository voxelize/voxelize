use hashbrown::HashMap;
use nanoid::nanoid;

use super::{
    models::{Message, MessageType},
    Client,
};

#[derive(Default)]
pub struct Room {
    clients: HashMap<String, Client>,
}

impl Room {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn has_client(&self, id: &str) -> bool {
        self.clients.contains_key(id)
    }

    pub fn add_client(&mut self, client: Client) -> String {
        let id = nanoid!();
        self.clients.insert(id.clone(), client);
        id
    }

    pub fn remove_client(&mut self, id: &str) {
        self.clients.remove(id);
    }

    pub fn on_request(&mut self, id: &str, data: Message) {
        let msg_type = MessageType::from_i32(data.r#type).unwrap();

        match msg_type {
            MessageType::Peer => self.on_peer(id, data),
            MessageType::Chunk => self.on_chunk(id, data),
            MessageType::Signal => self.on_peer(id, data),
            _ => {}
        }
    }

    pub fn broadcast() {}

    pub fn start() {}

    fn on_peer(&mut self, id: &str, data: Message) {}

    fn on_signal(&mut self, id: &str, data: Message) {}

    fn on_chunk(&mut self, id: &str, data: Message) {}
}
