/// World configuration, storing information of how a world is constructed.
#[derive(Clone, Default)]
pub struct WorldConfig {
    /// Max clients for each world. Default is 100 clients.
    pub max_clients: usize,

    /// Interval that this world ticks on. Default is 16ms.
    pub interval: u64,

    /// The horizontal dimension of the chunks in this world. Default is 16 blocks wide.
    pub chunk_size: u32,

    /// Max height of the world. Default is 256 blocks high.
    pub max_height: u32,

    /// Max light level that light can propagate. Default is 15 blocks.
    pub max_light_level: u32,

    /// Maximum chunks to be processed per tick. Default is 16 chunks.
    pub max_chunk_per_tick: u32,

    /// Maximum responses to send to client per tick to prevent bottle-necking. Default is 4 chunks.
    pub max_response_per_tick: u32,

    /// Radius of chunks around `0,0` to be preloaded. Default is 8 chunks.
    pub preload_radius: u32,
}

impl WorldConfig {
    /// Create a new world config using the Builder pattern.
    ///
    /// # Example
    ///
    /// ```
    /// let config = WorldConfig::new().chunk_size(8).max_height(64).build();
    /// server.create_world("small-world", &config);
    /// ```
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

/// Builder for a world configuration.
#[derive(Default)]
pub struct WorldConfigBuilder {
    max_clients: Option<usize>,
    interval: Option<u64>,
    chunk_size: Option<u32>,
    max_height: Option<u32>,
    max_light_level: Option<u32>,
    max_chunk_per_tick: Option<u32>,
    max_response_per_tick: Option<u32>,
    preload_radius: Option<u32>,
}

impl WorldConfigBuilder {
    /// Configure the maximum clients allowed for this world. Defaults is 100 clients.
    pub fn max_clients(mut self, max_clients: usize) -> Self {
        self.max_clients = Some(max_clients);
        self
    }

    /// Configure the rate at which this world ticks. Default is 16ms.
    pub fn interval(mut self, interval: u64) -> Self {
        self.interval = Some(interval);
        self
    }

    /// Configure the horizontal dimension of chunks in this world. Default is 16 blocks wide.
    pub fn chunk_size(mut self, chunk_size: u32) -> Self {
        self.chunk_size = Some(chunk_size);
        self
    }

    /// Configure the maximum height of the world. Default is 256 blocks high.
    pub fn max_height(mut self, max_height: u32) -> Self {
        self.max_height = Some(max_height);
        self
    }

    /// Configure the maximum light level that propagates the world. Default is 15 blocks.
    pub fn max_light_level(mut self, max_light_level: u32) -> Self {
        self.max_light_level = Some(max_light_level);
        self
    }

    /// Configure the maximum amount of chunks to be processed per tick. Default is 16 chunks.
    pub fn max_chunk_per_tick(mut self, max_chunk_per_tick: u32) -> Self {
        self.max_chunk_per_tick = Some(max_chunk_per_tick);
        self
    }

    /// Configure the maximum amount of chunks to be sent to the client per tick. Default is 4 chunks.
    pub fn max_response_per_tick(mut self, max_response_per_tick: u32) -> Self {
        self.max_response_per_tick = Some(max_response_per_tick);
        self
    }

    /// Configure the radius around `0,0` for the world to preload chunks in. Default is 8 chunks.
    pub fn preload_radius(mut self, preload_radius: u32) -> Self {
        self.preload_radius = Some(preload_radius);
        self
    }

    /// Create a world configuration.
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