use serde::{Deserialize, Serialize};

use super::generators::NoiseParams;

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitConfig {
    /// The horizontal dimension of the chunks in this world. Default is 16 blocks wide.
    pub chunk_size: usize,

    /// The number of sub chunks a chunk is divided into to mesh more efficiently. Defaults to 16.
    pub sub_chunks: usize,

    /// Max height of the world. Default is 256 blocks high.
    pub max_height: usize,

    /// Max light level that light can propagate. Default is 15 blocks.
    pub max_light_level: u32,

    /// The minimum inclusive chunk on this world. Default is [i32::MIN, i32::MIN].
    pub min_chunk: [i32; 2],

    /// The maximum inclusive chunk on this world. Default is [i32::MAX, i32::MAX].
    pub max_chunk: [i32; 2],

    /// Gravity of the voxelize world.
    pub gravity: [f32; 3],

    /// Minimum impulse to start bouncing.
    pub min_bounce_impulse: f32,

    /// Drag of the air in the voxelize world.
    pub air_drag: f32,

    /// Drag of the fluid in the voxelize world.
    pub fluid_drag: f32,

    /// Fluid density of the voxelize world.
    /// TODO: move this to registry.
    pub fluid_density: f32,
}

/// World configuration, storing information of how a world is constructed.
#[derive(Clone, Default)]
pub struct WorldConfig {
    /// Max clients for each world. Default is 100 clients.
    pub max_clients: usize,

    /// The horizontal dimension of the chunks in this world. Default is 16 blocks wide.
    pub chunk_size: usize,

    /// The number of sub chunks a chunk is divided into to mesh more efficiently. Defaults to 4.
    pub sub_chunks: usize,

    /// The minimum inclusive chunk on this world. Default is [i32::MIN, i32::MIN].
    pub min_chunk: [i32; 2],

    /// The maximum inclusive chunk on this world. Default is [i32::MAX, i32::MAX].
    pub max_chunk: [i32; 2],

    /// Max height of the world. Default is 256 blocks high.
    pub max_height: usize,

    /// Max light level that light can propagate. Default is 15 blocks.
    pub max_light_level: u32,

    /// Maximum chunks to be processed per tick. Default is 24 chunks.
    pub max_chunks_per_tick: usize,

    /// Maximum voxel updates to be processed per tick. Default is 500 voxels.
    pub max_updates_per_tick: usize,

    /// Maximum responses to send to client per tick to prevent bottle-necking. Default is 4 chunks.
    pub max_response_per_tick: usize,

    /// Maximum chunks saved per tick.
    pub max_saves_per_tick: usize,

    /// Water level of the voxelize world.
    pub water_level: usize,

    /// Gravity of the voxelize world.
    pub gravity: [f32; 3],

    /// Minimum impulse to start bouncing.
    pub min_bounce_impulse: f32,

    /// Drag of the air in the voxelize world.
    pub air_drag: f32,

    /// Drag of the fluid in the voxelize world.
    pub fluid_drag: f32,

    /// Fluid density of the voxelize world.
    /// TODO: move this to registry.
    pub fluid_density: f32,

    /// The repulsion factor when a collision is detected between entities.
    pub collision_repulsion: f32,

    /// Seed of the world. Default is "Voxelize".
    pub seed: u32,

    /// Terrain parameters
    pub terrain: NoiseParams,

    /// Whether this world is saved.
    pub saving: bool,

    /// Path to save all the saved chunks. Needs `save` to be true to be used.
    pub save_dir: String,

    /// Saving interval.
    pub save_interval: usize,
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
        WorldConfigBuilder::new()
    }

    /// Get the INIT configurations
    pub fn get_init_config(&self) -> InitConfig {
        InitConfig {
            chunk_size: self.chunk_size,
            sub_chunks: self.sub_chunks,
            max_height: self.max_height,
            max_light_level: self.max_light_level,
            min_chunk: self.min_chunk,
            max_chunk: self.max_chunk,
            gravity: self.gravity.to_owned(),
            air_drag: self.air_drag,
            fluid_density: self.fluid_density,
            fluid_drag: self.fluid_drag,
            min_bounce_impulse: self.min_bounce_impulse,
        }
    }
}

const DEFAULT_MAX_CLIENT: usize = 100;
const DEFAULT_CHUNK_SIZE: usize = 16;
const DEFAULT_SUB_CHUNKS: usize = 16;
const DEFAULT_MIN_CHUNK: [i32; 2] = [i32::MIN + 1, i32::MIN + 1];
const DEFAULT_MAX_CHUNK: [i32; 2] = [i32::MAX - 1, i32::MAX - 1];
const DEFAULT_MAX_HEIGHT: usize = 256;
const DEFAULT_MAX_LIGHT_LEVEL: u32 = 15;
const DEFAULT_MAX_CHUNKS_PER_TICK: usize = 24;
const DEFAULT_MAX_UPDATES_PER_TICK: usize = 200;
const DEFAULT_MAX_RESPONSE_PER_TICK: usize = 4;
const DEFAULT_MAX_SAVES_PER_TICK: usize = 2;
const DEFAULT_WATER_LEVEL: usize = 60;
const DEFAULT_SEED: u32 = 123123123;
const DEFAULT_GRAVITY: [f32; 3] = [0.0, -24.8, 0.0];
const DEFAULT_MIN_BOUNCE_IMPULSE: f32 = 0.5;
const DEFAULT_AIR_DRAG: f32 = 0.1;
const DEFAULT_FLUID_DRAG: f32 = 1.4;
const DEFAULT_FLUID_DENSITY: f32 = 0.8;
const DEFAULT_COLLISION_REPULSION: f32 = 0.3;
const DEFAULT_SAVING: bool = false;
const DEFAULT_SAVE_DIR: &str = "";
const DEFAULT_SAVE_INTERVAL: usize = 300;

/// Builder for a world configuration.
pub struct WorldConfigBuilder {
    max_clients: usize,
    chunk_size: usize,
    sub_chunks: usize,
    min_chunk: [i32; 2],
    max_chunk: [i32; 2],
    max_height: usize,
    max_light_level: u32,
    max_chunks_per_tick: usize,
    max_updates_per_tick: usize,
    max_response_per_tick: usize,
    max_saves_per_tick: usize,
    water_level: usize,
    seed: u32,
    gravity: [f32; 3],
    min_bounce_impulse: f32,
    air_drag: f32,
    fluid_drag: f32,
    fluid_density: f32,
    collision_repulsion: f32,
    terrain: NoiseParams,
    saving: bool,
    save_dir: String,
    save_interval: usize,
}

impl WorldConfigBuilder {
    /// Create a new WorldConfigBuilder with default values.
    pub fn new() -> Self {
        Self {
            max_clients: DEFAULT_MAX_CLIENT,
            chunk_size: DEFAULT_CHUNK_SIZE,
            sub_chunks: DEFAULT_SUB_CHUNKS,
            min_chunk: DEFAULT_MIN_CHUNK,
            max_chunk: DEFAULT_MAX_CHUNK,
            max_height: DEFAULT_MAX_HEIGHT,
            max_light_level: DEFAULT_MAX_LIGHT_LEVEL,
            max_chunks_per_tick: DEFAULT_MAX_CHUNKS_PER_TICK,
            max_updates_per_tick: DEFAULT_MAX_UPDATES_PER_TICK,
            max_response_per_tick: DEFAULT_MAX_RESPONSE_PER_TICK,
            max_saves_per_tick: DEFAULT_MAX_SAVES_PER_TICK,
            water_level: DEFAULT_WATER_LEVEL,
            seed: DEFAULT_SEED,
            air_drag: DEFAULT_AIR_DRAG,
            fluid_drag: DEFAULT_FLUID_DRAG,
            fluid_density: DEFAULT_FLUID_DENSITY,
            gravity: DEFAULT_GRAVITY,
            min_bounce_impulse: DEFAULT_MIN_BOUNCE_IMPULSE,
            collision_repulsion: DEFAULT_COLLISION_REPULSION,
            saving: DEFAULT_SAVING,
            save_dir: DEFAULT_SAVE_DIR.to_owned(),
            save_interval: DEFAULT_SAVE_INTERVAL,
            terrain: NoiseParams::default(),
        }
    }

    /// Configure the maximum clients allowed for this world. Defaults is 100 clients.
    pub fn max_clients(mut self, max_clients: usize) -> Self {
        self.max_clients = max_clients;
        self
    }

    /// Configure the horizontal dimension of chunks in this world. Default is 16 blocks wide.
    pub fn chunk_size(mut self, chunk_size: usize) -> Self {
        self.chunk_size = chunk_size;
        self
    }

    /// Configure the number of sub chunks a chunk is divided into. Default is 16 sub-chunks.
    pub fn sub_chunks(mut self, sub_chunks: usize) -> Self {
        self.sub_chunks = sub_chunks;
        self
    }

    /// Configure the minimum inclusive chunk of the world. Default is [i32::MIN, i32::MIN].
    pub fn min_chunk(mut self, min_chunk: [i32; 2]) -> Self {
        self.min_chunk = min_chunk;
        self
    }

    /// Configure the maximum inclusive chunk of the world. Default is [i32::MAX, i32::MAX].
    pub fn max_chunk(mut self, max_chunk: [i32; 2]) -> Self {
        self.max_chunk = max_chunk;
        self
    }

    /// Configure the maximum height of the world. Default is 256 blocks high.
    pub fn max_height(mut self, max_height: usize) -> Self {
        self.max_height = max_height;
        self
    }

    /// Configure the maximum light level that propagates the world. Default is 15 blocks.
    pub fn max_light_level(mut self, max_light_level: u32) -> Self {
        assert!(max_light_level < 16, "Max light level cannot be >= 16.");
        self.max_light_level = max_light_level;
        self
    }

    /// Configure the maximum amount of chunks to be processed per tick. Default is 24 chunks.
    pub fn max_chunks_per_tick(mut self, max_chunks_per_tick: usize) -> Self {
        self.max_chunks_per_tick = max_chunks_per_tick;
        self
    }

    /// Configure the maximum amount of voxel updates to be processed per tick. Default is 500 voxel updates.
    pub fn max_updates_per_tick(mut self, max_updates_per_tick: usize) -> Self {
        self.max_updates_per_tick = max_updates_per_tick;
        self
    }

    /// Configure the maximum amount of chunks to be sent to the client per tick. Default is 3 chunks.
    pub fn max_response_per_tick(mut self, max_response_per_tick: usize) -> Self {
        self.max_response_per_tick = max_response_per_tick;
        self
    }

    /// Configure the maximum amount of chunks to be saved.
    pub fn max_saves_per_tick(mut self, max_saves_per_tick: usize) -> Self {
        self.max_saves_per_tick = max_saves_per_tick;
        self
    }

    /// Configure the water level of the voxelize world.
    pub fn water_level(mut self, water_level: usize) -> Self {
        self.water_level = water_level;
        self
    }

    /// Configure the seed of the world. Default is `123123123`.
    pub fn seed(mut self, seed: u32) -> Self {
        self.seed = seed;
        self
    }

    /// Configure the terrain of the world. Default, check out NoiseParams.
    pub fn terrain(mut self, terrain: &NoiseParams) -> Self {
        self.terrain = terrain.to_owned();
        self
    }

    /// Configure the collision repulsion between entities. Defaults to `0.3`.
    pub fn collision_repulsion(mut self, collision_repulsion: f32) -> Self {
        self.collision_repulsion = collision_repulsion;
        self
    }

    /// Configure whether or not this world should have the chunk data saved.
    pub fn saving(mut self, saving: bool) -> Self {
        self.saving = saving;
        self
    }

    /// Configure the directory to save the world.
    pub fn save_dir(mut self, save_dir: &str) -> Self {
        self.save_dir = save_dir.to_owned();
        self
    }

    /// Configure the saving interval of the world.
    pub fn save_interval(mut self, save_interval: usize) -> Self {
        self.save_interval = save_interval.to_owned();
        self
    }

    /// Create a world configuration.
    pub fn build(self) -> WorldConfig {
        // Make sure there are still chunks in the world.
        if self.max_chunk[0] < self.min_chunk[0] || self.max_chunk[1] < self.min_chunk[1] {
            panic!("Min/max chunk parameters do not make sense.");
        }

        if self.chunk_size % self.sub_chunks != 0 {
            panic!("Chunk size should be divisible by sub-chunks.");
        }

        if !self.saving && !self.save_dir.is_empty() {
            panic!("Save directory shouldn't be used unless `config.save` is set to true!");
        }

        WorldConfig {
            max_clients: self.max_clients,
            chunk_size: self.chunk_size,
            sub_chunks: self.sub_chunks,
            max_height: self.max_height,
            max_light_level: self.max_light_level,
            max_chunks_per_tick: self.max_chunks_per_tick,
            max_updates_per_tick: self.max_updates_per_tick,
            max_response_per_tick: self.max_response_per_tick,
            max_saves_per_tick: self.max_saves_per_tick,
            water_level: self.water_level,
            seed: self.seed,
            min_chunk: self.min_chunk,
            max_chunk: self.max_chunk,
            air_drag: self.air_drag,
            fluid_drag: self.fluid_drag,
            fluid_density: self.fluid_density,
            gravity: self.gravity,
            min_bounce_impulse: self.min_bounce_impulse,
            collision_repulsion: self.collision_repulsion,
            terrain: self.terrain,
            saving: self.saving,
            save_dir: self.save_dir,
            save_interval: self.save_interval,
        }
    }
}
