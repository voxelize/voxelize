use game_loop::game_loop;
use hashbrown::HashMap;
use nanoid::nanoid;

use super::{
    models::{Message, MessageType},
    Client,
};

#[derive(Clone, Default)]
pub struct Room {
    pub id: String,
    pub name: String,
    pub max_clients: usize,
    pub interval: u32,
    pub chunk_size: u32,
    pub max_height: u32,
    pub max_light_level: u32,
    pub max_chunk_per_tick: u32,
    pub max_response_per_tick: u32,
    pub preload_radius: u32,

    clients: HashMap<String, Client>,
}

impl Room {
    pub fn new(name: &str) -> RoomBuilder {
        let id = nanoid!();
        RoomBuilder {
            id,
            name: name.to_owned(),
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

    pub fn remove_client(&mut self, id: &str) {
        self.clients.remove(id);
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

    pub fn broadcast() {}

    pub fn start(&mut self) {
        let k = game_loop(
            self,
            16,
            0.1,
            |g| {
                print!("hi");
            },
            |g| {},
        );
        print!("hii")
    }

    fn on_peer(&mut self, id: &str, data: Message) {}

    fn on_signal(&mut self, id: &str, data: Message) {}

    fn on_chunk(&mut self, id: &str, data: Message) {}
}

const DEFAULT_MAX_CLIENT: usize = 100;
const DEFAULT_INTERVAL: u32 = 16;
const DEFAULT_CHUNK_SIZE: u32 = 16;
const DEFAULT_MAX_HEIGHT: u32 = 256;
const DEFAULT_MAX_LIGHT_LEVEL: u32 = 15;
const DEFAULT_MAX_CHUNKS_PER_TICK: u32 = 16;
const DEFAULT_MAX_RESPONSE_PER_TICK: u32 = 4;
const DEFAULT_PRELOAD_RADIUS: u32 = 8;

#[derive(Default)]
pub struct RoomBuilder {
    pub id: String,
    pub name: String,

    pub max_clients: Option<usize>,
    pub interval: Option<u32>,
    pub chunk_size: Option<u32>,
    pub max_height: Option<u32>,
    pub max_light_level: Option<u32>,
    pub max_chunk_per_tick: Option<u32>,
    pub max_response_per_tick: Option<u32>,
    pub preload_radius: Option<u32>,
}

impl RoomBuilder {
    pub fn new(id: String, name: String) -> Self {
        RoomBuilder {
            id,
            name,
            ..Default::default()
        }
    }

    pub fn max_clients(mut self, max_clients: usize) -> Self {
        self.max_clients = Some(max_clients);
        self
    }

    pub fn interval(mut self, interval: u32) -> Self {
        self.interval = Some(interval);
        self
    }

    pub fn chunk_size(mut self, chunk_size: u32) -> Self {
        self.chunk_size = Some(chunk_size);
        self
    }

    pub fn max_height(mut self, max_height: u32) -> Self {
        self.max_height = Some(max_height);
        self
    }

    pub fn max_light_level(mut self, max_light_level: u32) -> Self {
        self.max_light_level = Some(max_light_level);
        self
    }

    pub fn max_chunk_per_tick(mut self, max_chunk_per_tick: u32) -> Self {
        self.max_chunk_per_tick = Some(max_chunk_per_tick);
        self
    }

    pub fn max_response_per_tick(mut self, max_response_per_tick: u32) -> Self {
        self.max_response_per_tick = Some(max_response_per_tick);
        self
    }

    pub fn preload_radius(mut self, preload_radius: u32) -> Self {
        self.preload_radius = Some(preload_radius);
        self
    }

    pub fn build(self) -> Room {
        Room {
            id: self.id,
            name: self.name,
            max_clients: self.max_clients.unwrap_or_else(|| DEFAULT_MAX_CLIENT),
            interval: self.interval.unwrap_or_else(|| DEFAULT_INTERVAL),
            chunk_size: self.chunk_size.unwrap_or_else(|| DEFAULT_CHUNK_SIZE),
            max_height: self.max_height.unwrap_or_else(|| DEFAULT_MAX_HEIGHT),
            max_light_level: self
                .max_light_level
                .unwrap_or_else(|| DEFAULT_MAX_LIGHT_LEVEL),
            max_chunk_per_tick: self
                .max_chunk_per_tick
                .unwrap_or_else(|| DEFAULT_MAX_CHUNKS_PER_TICK),
            max_response_per_tick: self
                .max_response_per_tick
                .unwrap_or_else(|| DEFAULT_MAX_RESPONSE_PER_TICK),
            preload_radius: self
                .preload_radius
                .unwrap_or_else(|| DEFAULT_PRELOAD_RADIUS),
            ..Default::default()
        }
    }
}
