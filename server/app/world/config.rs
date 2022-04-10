#[derive(Clone, Default)]
pub struct WorldConfig {
    pub max_clients: usize,
    pub interval: u64,
    pub chunk_size: u32,
    pub max_height: u32,
    pub max_light_level: u32,
    pub max_chunk_per_tick: u32,
    pub max_response_per_tick: u32,
    pub preload_radius: u32,
}

impl WorldConfig {
    pub fn new() -> WorldConfigBuilder {
        WorldConfigBuilder::default()
    }
}

const DEFAULT_MAX_CLIENT: usize = 100;
const DEFAULT_INTERVAL: u64 = 16;
const DEFAULT_CHUNK_SIZE: u32 = 16;
const DEFAULT_MAX_HEIGHT: u32 = 256;
const DEFAULT_MAX_LIGHT_LEVEL: u32 = 15;
const DEFAULT_MAX_CHUNKS_PER_TICK: u32 = 16;
const DEFAULT_MAX_RESPONSE_PER_TICK: u32 = 4;
const DEFAULT_PRELOAD_RADIUS: u32 = 8;

#[derive(Default)]
pub struct WorldConfigBuilder {
    pub max_clients: Option<usize>,
    pub interval: Option<u64>,
    pub chunk_size: Option<u32>,
    pub max_height: Option<u32>,
    pub max_light_level: Option<u32>,
    pub max_chunk_per_tick: Option<u32>,
    pub max_response_per_tick: Option<u32>,
    pub preload_radius: Option<u32>,
}

impl WorldConfigBuilder {
    pub fn new(id: String, name: String) -> Self {
        Self {
            ..Default::default()
        }
    }

    pub fn max_clients(mut self, max_clients: usize) -> Self {
        self.max_clients = Some(max_clients);
        self
    }

    pub fn interval(mut self, interval: u64) -> Self {
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

    pub fn build(self) -> WorldConfig {
        WorldConfig {
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
        }
    }
}
