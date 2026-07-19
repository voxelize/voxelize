use serde::Serialize;

use super::generators::NoiseOptions;

/// World configuration, storing information of how a world is constructed.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldConfig {
    /// Per-world hard cap on joined clients. Default is unbounded
    /// (`usize::MAX`), matching historical behavior where no join cap was
    /// enforced. Set a finite value (e.g. `6`) to reject joins past the cap
    /// through the clean rejection channel (see `Server` join resolution).
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

    /// Optional hard cap on [`Self::preload_radius`]. When set, larger radii are
    /// clamped at build time (with a warning). Use this so a mis-set radius on a
    /// small box cannot schedule hundreds of chunks before the process is ready.
    /// `None` (default) means no clamp — games that intentionally preload large
    /// radii on big hosts leave this unset.
    pub max_preload_radius: Option<usize>,

    /// Max height of the world. Default is 256 blocks high.
    pub max_height: usize,

    /// Max light level that light can propagate. Default is 15 blocks.
    pub max_light_level: u32,

    /// Maximum chunks to be processed per tick. Default is 24 chunks.
    pub max_chunks_per_tick: usize,

    /// Maximum voxel updates to be processed per tick. Default is 1000 voxels.
    pub max_updates_per_tick: usize,

    /// Minecraft-style random tick speed: each loaded/interested 16x16x(section)
    /// subchunk samples this many random positions per world tick and, if the
    /// block is `is_random_tickable`, schedules its `active_updater` at the
    /// current tick. Default is 3 (Minecraft's `randomTickSpeed` default).
    /// Set to 0 to disable the sampler entirely.
    pub random_tick_speed: usize,

    /// Hard cap on how many random-tick samples may be taken across all
    /// interested subchunks in a single world tick. Keeps the sampler from
    /// starving the neighbor/scheduled active queue (copper). Default 2048.
    /// Priority: scheduled `active_voxel_heap` work always runs first in
    /// `ChunkUpdatingSystem`; the sampler only *queues* work for later pops.
    pub max_random_ticks_per_tick: usize,

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

    /// Whether chunk geometry should only be built by clients. Default is true.
    pub client_only_meshing: bool,

    /// When false (default), inbound client `UPDATE` / bulk voxel writes are
    /// ignored in `World::on_update`. Games that need client-authored terrain
    /// can opt in; server-authoritative games keep this off and write voxels
    /// only from method/event handlers.
    pub allow_client_voxel_writes: bool,

    /// Radius in blocks within which an entity enters a client's interest set
    /// and starts streaming to that client. Default is 24 chunks worth of blocks.
    pub entity_visible_radius: f32,

    /// Radius in blocks beyond which a tracked entity leaves a client's interest
    /// set. Kept larger than `entity_visible_radius` so entities hovering at the
    /// boundary do not churn between entering and leaving.
    pub entity_release_radius: f32,

    /// Ticks between keep-alive updates for tracked entities whose metadata has
    /// not changed, letting clients treat prolonged silence as a lost entity.
    pub entity_keep_alive_interval: u64,

    /// Wall-clock bound (milliseconds) on how stale a pending MOTION update
    /// for a visible entity may get before it is flushed regardless of the
    /// byte budget. This is the perceptual freshness guarantee: every moving
    /// entity a client tracks refreshes within this window (nearer entities
    /// within half of it — see `replication::motion_max_age_for`), no matter
    /// how many entities changed and no matter how far the tick rate sags.
    pub entity_motion_max_age_ms: u64,

    /// Base per-tick entity-state payload budget per client, in approximate
    /// payload bytes (id + type + metadata + motion payload, not the encoded
    /// protobuf frame size). The live budget is derived from it dynamically:
    /// it expands (up to 4x) while the client's socket is drained, clamps
    /// proportionally as the socket backlog grows, and scales with the
    /// wall-clock tick duration — see `replication::state_flush_budget`.
    /// Overdue motion (past `entity_motion_max_age_ms`) always ships outside
    /// this budget. Measure actual frame sizes with the
    /// `entity_batch_send.byteSize` perf field.
    pub entity_flush_base_bytes_per_tick: usize,

    /// Radius in blocks within which another player's (peer's) state
    /// replicates to a client. `None` (default) replicates every peer to every
    /// client, matching historical behavior. Unlike entities, peers have no
    /// wire-level out-of-range signal — an out-of-range player simply stops
    /// receiving updates and freezes at the last known position client-side —
    /// so games opt into this knowingly.
    pub peer_visible_radius: Option<f32>,
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

/// Unbounded by default: no join cap is enforced unless a world opts in.
const DEFAULT_MAX_CLIENT: usize = usize::MAX;
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
/// Minecraft default `gamerule randomTickSpeed` = 3 samples per 16^3 section.
const DEFAULT_RANDOM_TICK_SPEED: usize = 3;
const DEFAULT_MAX_RANDOM_TICKS_PER_TICK: usize = 2048;
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
const DEFAULT_CLIENT_ONLY_MESHING: bool = true;
const DEFAULT_ALLOW_CLIENT_VOXEL_WRITES: bool = false;
const DEFAULT_ENTITY_VISIBLE_RADIUS_CHUNKS: f32 = 24.0;
const DEFAULT_ENTITY_RELEASE_RADIUS_RATIO: f32 = 1.125;
const DEFAULT_ENTITY_KEEP_ALIVE_INTERVAL: u64 = 60;
const DEFAULT_ENTITY_MOTION_MAX_AGE_MS: u64 = 100;
const DEFAULT_ENTITY_FLUSH_BASE_BYTES_PER_TICK: usize = 24 * 1024;

/// Builder for a world configuration.
pub struct WorldConfigBuilder {
    max_clients: usize,
    chunk_size: usize,
    sub_chunks: usize,
    min_chunk: [i32; 2],
    max_chunk: [i32; 2],
    preload: bool,
    preload_radius: usize,
    max_preload_radius: Option<usize>,
    max_height: usize,
    max_light_level: u32,
    max_chunks_per_tick: usize,
    max_updates_per_tick: usize,
    random_tick_speed: usize,
    max_random_ticks_per_tick: usize,
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
    client_only_meshing: bool,
    allow_client_voxel_writes: bool,
    entity_visible_radius: f32,
    entity_release_radius: f32,
    entity_keep_alive_interval: u64,
    entity_motion_max_age_ms: u64,
    entity_flush_base_bytes_per_tick: usize,
    peer_visible_radius: Option<f32>,
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
            max_preload_radius: None,
            max_height: DEFAULT_MAX_HEIGHT,
            max_light_level: DEFAULT_MAX_LIGHT_LEVEL,
            max_chunks_per_tick: DEFAULT_MAX_CHUNKS_PER_TICK,
            max_updates_per_tick: DEFAULT_MAX_UPDATES_PER_TICK,
            random_tick_speed: DEFAULT_RANDOM_TICK_SPEED,
            max_random_ticks_per_tick: DEFAULT_MAX_RANDOM_TICKS_PER_TICK,
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
            client_only_meshing: DEFAULT_CLIENT_ONLY_MESHING,
            allow_client_voxel_writes: DEFAULT_ALLOW_CLIENT_VOXEL_WRITES,
            entity_visible_radius: 0.0,
            entity_release_radius: 0.0,
            entity_keep_alive_interval: DEFAULT_ENTITY_KEEP_ALIVE_INTERVAL,
            entity_motion_max_age_ms: DEFAULT_ENTITY_MOTION_MAX_AGE_MS,
            entity_flush_base_bytes_per_tick: DEFAULT_ENTITY_FLUSH_BASE_BYTES_PER_TICK,
            peer_visible_radius: None,
        }
    }

    /// Configure the per-world hard cap on joined clients. Default is
    /// unbounded. A finite value rejects joins past the cap.
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

    /// Configure the preload radius of the world. Default is 8 chunks.
    pub fn preload_radius(mut self, preload_radius: usize) -> Self {
        self.preload_radius = preload_radius;
        self
    }

    /// Optional hard cap on preload radius. Larger values are clamped at build
    /// time. Default is `None` (no clamp).
    pub fn max_preload_radius(mut self, max_preload_radius: Option<usize>) -> Self {
        self.max_preload_radius = max_preload_radius;
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

    /// Minecraft-style random tick speed (samples per loaded subchunk section
    /// per world tick). Default 3. Set 0 to disable.
    pub fn random_tick_speed(mut self, random_tick_speed: usize) -> Self {
        self.random_tick_speed = random_tick_speed;
        self
    }

    /// Cap on total random-tick samples across all interested subchunks per
    /// world tick. Default 2048. Scheduled active-queue work is not counted
    /// against this budget and always runs first.
    pub fn max_random_ticks_per_tick(mut self, max_random_ticks_per_tick: usize) -> Self {
        self.max_random_ticks_per_tick = max_random_ticks_per_tick;
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

    /// Configure whether chunk geometry should only be built by clients. Default is true.
    pub fn client_only_meshing(mut self, client_only_meshing: bool) -> Self {
        self.client_only_meshing = client_only_meshing;
        self
    }

    /// When false (default), inbound client voxel UPDATEs are ignored.
    pub fn allow_client_voxel_writes(mut self, allow_client_voxel_writes: bool) -> Self {
        self.allow_client_voxel_writes = allow_client_voxel_writes;
        self
    }

    pub fn entity_visible_radius(mut self, entity_visible_radius: f32) -> Self {
        self.entity_visible_radius = entity_visible_radius;
        self
    }

    pub fn entity_release_radius(mut self, entity_release_radius: f32) -> Self {
        self.entity_release_radius = entity_release_radius;
        self
    }

    pub fn entity_keep_alive_interval(mut self, entity_keep_alive_interval: u64) -> Self {
        self.entity_keep_alive_interval = entity_keep_alive_interval;
        self
    }

    /// Wall-clock freshness bound (ms) for pending entity motion. Must be
    /// positive.
    pub fn entity_motion_max_age_ms(mut self, entity_motion_max_age_ms: u64) -> Self {
        self.entity_motion_max_age_ms = entity_motion_max_age_ms;
        self
    }

    /// Base per-tick entity-state payload budget per client (approximate
    /// payload bytes, dynamically scaled at flush time). Must be positive.
    pub fn entity_flush_base_bytes_per_tick(
        mut self,
        entity_flush_base_bytes_per_tick: usize,
    ) -> Self {
        self.entity_flush_base_bytes_per_tick = entity_flush_base_bytes_per_tick;
        self
    }

    /// Optional radius (in blocks) limiting which peers replicate to a client.
    /// `None` (default) replicates all peers to all clients.
    pub fn peer_visible_radius(mut self, peer_visible_radius: Option<f32>) -> Self {
        self.peer_visible_radius = peer_visible_radius;
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

        let entity_visible_radius = if self.entity_visible_radius > 0.0 {
            self.entity_visible_radius
        } else {
            DEFAULT_ENTITY_VISIBLE_RADIUS_CHUNKS * self.chunk_size as f32
        };
        let entity_release_radius = if self.entity_release_radius > 0.0 {
            self.entity_release_radius
        } else {
            entity_visible_radius * DEFAULT_ENTITY_RELEASE_RADIUS_RATIO
        };

        if entity_release_radius <= entity_visible_radius {
            panic!("Entity release radius must exceed the entity visible radius.");
        }

        if let Some(peer_visible_radius) = self.peer_visible_radius {
            if peer_visible_radius <= 0.0 {
                panic!("Peer visible radius must be positive (or None for unlimited).");
            }
        }

        if self.entity_motion_max_age_ms == 0 {
            panic!("Entity motion max age must be positive.");
        }

        if self.entity_flush_base_bytes_per_tick == 0 {
            panic!("Entity flush base bytes per tick must be positive.");
        }

        WorldConfig {
            max_clients: self.max_clients,
            chunk_size: self.chunk_size,
            sub_chunks: self.sub_chunks,
            max_height: self.max_height,
            max_light_level: self.max_light_level,
            max_chunks_per_tick: self.max_chunks_per_tick,
            max_updates_per_tick: self.max_updates_per_tick,
            random_tick_speed: self.random_tick_speed,
            max_random_ticks_per_tick: self.max_random_ticks_per_tick,
            max_response_per_tick: self.max_response_per_tick,
            max_saves_per_tick: self.max_saves_per_tick,
            time_per_day: self.time_per_day,
            water_level: self.water_level,
            seed: self.seed,
            min_chunk: self.min_chunk,
            max_chunk: self.max_chunk,
            default_time: self.default_time.max(0.0).min(self.time_per_day as f32),
            preload: self.preload,
            preload_radius: {
                let mut radius = self.preload_radius;
                if let Some(max) = self.max_preload_radius {
                    if radius > max {
                        log::warn!(
                            "Clamping preload_radius {} → {} (max_preload_radius); \
                             large preloads before/while HTTP is accepting can wedge \
                             small hosts — prefer bind-before-preload + a bounded radius",
                            radius, max
                        );
                        radius = max;
                    }
                }
                radius
            },
            max_preload_radius: self.max_preload_radius,
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
            client_only_meshing: self.client_only_meshing,
            allow_client_voxel_writes: self.allow_client_voxel_writes,
            entity_visible_radius,
            entity_release_radius,
            entity_keep_alive_interval: self.entity_keep_alive_interval,
            entity_motion_max_age_ms: self.entity_motion_max_age_ms,
            entity_flush_base_bytes_per_tick: self.entity_flush_base_bytes_per_tick,
            peer_visible_radius: self.peer_visible_radius,
        }
    }
}

#[cfg(test)]
mod preload_budget_tests {
    use super::*;

    #[test]
    fn max_preload_radius_clamps_configured_radius() {
        let config = WorldConfig::new()
            .preload(true)
            .preload_radius(8)
            .max_preload_radius(Some(2))
            .build();
        assert_eq!(config.preload_radius, 2);
        assert_eq!(config.max_preload_radius, Some(2));
    }

    #[test]
    fn max_preload_radius_none_keeps_large_radius() {
        let config = WorldConfig::new()
            .preload(true)
            .preload_radius(8)
            .max_preload_radius(None)
            .build();
        assert_eq!(config.preload_radius, 8);
        assert_eq!(config.max_preload_radius, None);
    }
}
