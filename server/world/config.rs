use serde::Serialize;

use super::generators::NoiseOptions;

/// World configuration, storing information of how a world is constructed.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldConfig {
    /// Max clients for each world. Default is 100 clients.
    pub max_clients: usize,

    /// The horizontal dimension of the chunks in this world. Default is 16 blocks wide.
    pub chunk_size: usize,

    /// The number of sub chunks a chunk is divided into to mesh more efficiently. Defaults to 8.
    pub sub_chunks: usize,

    /// The minimum inclusive chunk on this world. Default is [i32::MIN, i32::MIN].
    pub min_chunk: [i32; 2],

    /// The maximum inclusive chunk on this world. Default is [i32::MAX, i32::MAX].
    pub max_chunk: [i32; 2],

    /// Whether or not should the world preload.
    pub preload: bool,

    /// The radius at which the world should preload.
    pub preload_radius: usize,

    /// Max height of the world. Default is 256 blocks high.
    pub max_height: usize,

    /// Max light level that light can propagate. Default is 15 blocks.
    pub max_light_level: u32,

    /// Maximum chunks to be processed per tick. Default is 24 chunks.
    pub max_chunks_per_tick: usize,

    /// Maximum voxel updates to be processed per tick. Default is 1000 voxels.
    pub max_updates_per_tick: usize,

    /// Maximum responses to send to client per tick to prevent bottle-necking. Default is 4 chunks.
    pub max_response_per_tick: usize,

    /// Maximum chunks saved per tick.
    pub max_saves_per_tick: usize,

    /// The amount of ticks per day. Default is 24000 ticks.
    pub time_per_day: u64,

    /// Water level of the voxelize world.
    pub water_level: usize,

    /// Gravity of the voxelize world.
    pub gravity: [f32; 3],

    /// Minimum impulse to start bouncing.
    pub min_bounce_impulse: f32,

    /// Drag of the air in the voxelize world.
    pub air_drag: f32,

    pub does_tick_time: bool,

    pub default_time: f32,

    /// Drag of the fluid in the voxelize world.
    pub fluid_drag: f32,

    /// Fluid density of the voxelize world.
    /// TODO: move this to registry.
    pub fluid_density: f32,

    /// The repulsion factor when a collision is detected between entities.
    pub collision_repulsion: f32,

    /// The repulsion factor when a collision is detected between clients and clients.
    pub client_collision_repulsion: f32,

    /// Seed of the world. Default is "Voxelize".
    pub seed: u32,

    /// Terrain options
    pub terrain: NoiseOptions,

    /// Whether this world is saved.
    pub saving: bool,

    /// Path to save all the saved chunks. Needs `save` to be true to be used.
    pub save_dir: String,

    /// Saving interval.
    pub save_interval: usize,

    /// Prefix for all commands.
    pub command_symbol: String,

    /// Whether entities should be saved. Only applies if `saving` is true.
    pub save_entities: bool,

    /// Whether to use greedy meshing for chunk generation. Default is true.
    pub greedy_meshing: bool,

    /// Whether to use shader-based lighting instead of CPU light propagation. Default is false.
    pub shader_based_lighting: bool,
}

impl Default for WorldConfig {
    fn default() -> Self {
        Self::new().build()
    }
}

impl WorldConfig {
    /// Create a new world config using the Builder pattern.
    pub fn new() -> WorldConfigBuilder {
        WorldConfigBuilder::new()
    }

    pub fn make_copy(&self) -> WorldConfig {
        self.clone()
    }
}

const DEFAULT_MAX_CLIENT: usize = 100;
const DEFAULT_CHUNK_SIZE: usize = 16;
const DEFAULT_SUB_CHUNKS: usize = 8;
const DEFAULT_MIN_CHUNK: [i32; 2] = [i32::MIN + 1, i32::MIN + 1];
const DEFAULT_MAX_CHUNK: [i32; 2] = [i32::MAX - 1, i32::MAX - 1];
const DEFAULT_PRELOAD: bool = false;
const DEFAULT_PRELOAD_RADIUS: usize = 8;
const DEFAULT_MAX_HEIGHT: usize = 256;
const DEFAULT_MAX_LIGHT_LEVEL: u32 = 15;
const DEFAULT_MAX_CHUNKS_PER_TICK: usize = 4;
const DEFAULT_MAX_UPDATES_PER_TICK: usize = 50000;
const DEFAULT_MAX_RESPONSE_PER_TICK: usize = 4;
const DEFAULT_MAX_SAVES_PER_TICK: usize = 2;
const DEFAULT_TICKS_PER_DAY: u64 = 24000;
const DEFAULT_WATER_LEVEL: usize = 86;
const DEFAULT_SEED: u32 = 123123123;
const DEFAULT_GRAVITY: [f32; 3] = [0.0, -24.8, 0.0];
const DEFAULT_MIN_BOUNCE_IMPULSE: f32 = 0.5;
const DEFAULT_AIR_DRAG: f32 = 0.1;
const DEFAULT_FLUID_DRAG: f32 = 1.4;
const DEFAULT_FLUID_DENSITY: f32 = 0.8;
const DEFAULT_COLLISION_REPULSION: f32 = 2.3;
const DEFAULT_CLIENT_COLLISION_REPULSION: f32 = 0.0;
const DEFAULT_DOES_TICK_TIME: bool = true;
const DEFAULT_TIME: f32 = 0.0;
const DEFAULT_SAVING: bool = false;
const DEFAULT_SAVE_DIR: &str = "";
const DEFAULT_SAVE_INTERVAL: usize = 300;
const DEFAULT_COMMAND_SYMBOL: &str = "/";
const DEFAULT_GREEDY_MESHING: bool = true;
const DEFAULT_SHADER_BASED_LIGHTING: bool = false;

/// Builder for a world configuration.
pub struct WorldConfigBuilder {
    max_clients: usize,
    chunk_size: usize,
    sub_chunks: usize,
    min_chunk: [i32; 2],
    max_chunk: [i32; 2],
    preload: bool,
    preload_radius: usize,
    max_height: usize,
    max_light_level: u32,
    max_chunks_per_tick: usize,
    max_updates_per_tick: usize,
    max_response_per_tick: usize,
    max_saves_per_tick: usize,
    time_per_day: u64,
    water_level: usize,
    seed: u32,
    gravity: [f32; 3],
    min_bounce_impulse: f32,
    does_tick_time: bool,
    default_time: f32,
    air_drag: f32,
    fluid_drag: f32,
    fluid_density: f32,
    collision_repulsion: f32,
    client_collision_repulsion: f32,
    terrain: NoiseOptions,
    saving: bool,
    save_dir: String,
    save_interval: usize,
    command_symbol: String,
    save_entities: bool,
    greedy_meshing: bool,
    shader_based_lighting: bool,
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
            does_tick_time: DEFAULT_DOES_TICK_TIME,
            default_time: DEFAULT_TIME,
            preload: DEFAULT_PRELOAD,
            preload_radius: DEFAULT_PRELOAD_RADIUS,
            max_height: DEFAULT_MAX_HEIGHT,
            max_light_level: DEFAULT_MAX_LIGHT_LEVEL,
            max_chunks_per_tick: DEFAULT_MAX_CHUNKS_PER_TICK,
            max_updates_per_tick: DEFAULT_MAX_UPDATES_PER_TICK,
            max_response_per_tick: DEFAULT_MAX_RESPONSE_PER_TICK,
            max_saves_per_tick: DEFAULT_MAX_SAVES_PER_TICK,
            time_per_day: DEFAULT_TICKS_PER_DAY,
            water_level: DEFAULT_WATER_LEVEL,
            seed: DEFAULT_SEED,
            air_drag: DEFAULT_AIR_DRAG,
            fluid_drag: DEFAULT_FLUID_DRAG,
            fluid_density: DEFAULT_FLUID_DENSITY,
            gravity: DEFAULT_GRAVITY,
            min_bounce_impulse: DEFAULT_MIN_BOUNCE_IMPULSE,
            collision_repulsion: DEFAULT_COLLISION_REPULSION,
            client_collision_repulsion: DEFAULT_CLIENT_COLLISION_REPULSION,
            saving: DEFAULT_SAVING,
            save_dir: DEFAULT_SAVE_DIR.to_owned(),
            save_interval: DEFAULT_SAVE_INTERVAL,
            terrain: NoiseOptions::default(),
            command_symbol: DEFAULT_COMMAND_SYMBOL.to_owned(),
            save_entities: true,
            greedy_meshing: DEFAULT_GREEDY_MESHING,
            shader_based_lighting: DEFAULT_SHADER_BASED_LIGHTING,
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

    /// Configure the number of sub chunks a chunk is divided into. Default is 8 sub-chunks.
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

    /// Configure whether or not should the world preload chunks. Default is false.
    pub fn preload(mut self, preload: bool) -> Self {
        if self.preload_radius == 0 && preload {
            self.preload_radius = DEFAULT_PRELOAD_RADIUS;
        }

        self.preload = preload;
        self
    }

    /// Configure the preload radius of the world. Default is 12 chunks.
    pub fn preload_radius(mut self, preload_radius: usize) -> Self {
        self.preload_radius = preload_radius;
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

    /// Configure the maximum amount of voxel updates to be processed per tick. Default is 1000 voxel updates.
    pub fn max_updates_per_tick(mut self, max_updates_per_tick: usize) -> Self {
        self.max_updates_per_tick = max_updates_per_tick;
        self
    }

    pub fn does_tick_time(mut self, does_tick_time: bool) -> Self {
        self.does_tick_time = does_tick_time;
        self
    }

    pub fn default_time(mut self, default_time: f32) -> Self {
        self.default_time = default_time;
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

    /// Configure the amount of ticks per day. Default is 24000 ticks.
    pub fn time_per_day(mut self, time_per_day: u64) -> Self {
        self.time_per_day = time_per_day;
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

    /// Configure the terrain of the world. Default, check out NoiseOptions.
    pub fn terrain(mut self, terrain: &NoiseOptions) -> Self {
        self.terrain = terrain.to_owned();
        self
    }

    /// Configure the collision repulsion between entities. Defaults to `0.3`.
    pub fn collision_repulsion(mut self, collision_repulsion: f32) -> Self {
        self.collision_repulsion = collision_repulsion;
        self
    }

    /// Configure the repulsion factor when a collision is detected between clients and entities.
    pub fn client_collision_repulsion(mut self, client_collision_repulsion: f32) -> Self {
        self.client_collision_repulsion = client_collision_repulsion;
        self
    }

    /// Configure whether or not this world should have the chunk data saved.
    pub fn saving(mut self, saving: bool) -> Self {
        self.saving = saving;
        self
    }

    /// Configure the directory to save the world.
    pub fn save_dir(mut self, save_dir: &str) -> Self {
        if cfg!(target_os = "windows") {
            self.save_dir = save_dir.replace("/", "\\");
        } else {
            self.save_dir = save_dir.to_owned();
        }
        self
    }

    /// Configure the saving interval of the world.
    pub fn save_interval(mut self, save_interval: usize) -> Self {
        self.save_interval = save_interval.to_owned();
        self
    }

    /// Configure the prefix of command messages.
    pub fn command_symbol(mut self, command_symbol: &str) -> Self {
        self.command_symbol = command_symbol.to_owned();
        self
    }

    /// Configure whether entities should be saved. Only applies if `saving` is true.
    pub fn save_entities(mut self, save_entities: bool) -> Self {
        self.save_entities = save_entities;
        self
    }

    /// Configure whether to use greedy meshing for chunk generation. Default is true.
    pub fn greedy_meshing(mut self, greedy_meshing: bool) -> Self {
        self.greedy_meshing = greedy_meshing;
        self
    }

    /// Configure whether to use shader-based lighting instead of CPU light propagation. Default is false.
    pub fn shader_based_lighting(mut self, shader_based_lighting: bool) -> Self {
        self.shader_based_lighting = shader_based_lighting;
        self
    }

    /// Create a world configuration.
    pub fn build(self) -> WorldConfig {
        // Make sure there are still chunks in the world.
        if self.max_chunk[0] < self.min_chunk[0] || self.max_chunk[1] < self.min_chunk[1] {
            panic!("Min/max chunk options do not make sense.");
        }

        if self.max_height % self.sub_chunks != 0 {
            panic!("Max height should be divisible by sub-chunks.");
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
            time_per_day: self.time_per_day,
            water_level: self.water_level,
            seed: self.seed,
            min_chunk: self.min_chunk,
            max_chunk: self.max_chunk,
            default_time: self.default_time.max(0.0).min(self.time_per_day as f32),
            preload: self.preload,
            preload_radius: self.preload_radius,
            air_drag: self.air_drag,
            fluid_drag: self.fluid_drag,
            fluid_density: self.fluid_density,
            gravity: self.gravity,
            min_bounce_impulse: self.min_bounce_impulse,
            collision_repulsion: self.collision_repulsion,
            does_tick_time: self.does_tick_time,
            client_collision_repulsion: self.client_collision_repulsion,
            terrain: self.terrain,
            saving: self.saving,
            save_dir: self.save_dir,
            save_interval: self.save_interval,
            command_symbol: self.command_symbol,
            save_entities: self.save_entities,
            greedy_meshing: self.greedy_meshing,
            shader_based_lighting: self.shader_based_lighting,
        }
    }
}
