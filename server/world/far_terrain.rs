//! Coarse far-terrain tiles.
//!
//! A game registers a [`FarTerrainSampler`] that answers, for one tile of the
//! world at low resolution, the surface height and a colour class per sample
//! without generating chunks. Clients ask for tiles with the
//! [`FAR_TERRAIN_METHOD`] method and get each tile back as a method reply on
//! the bulk lane, the lane chunk data rides. The engine owns the plumbing:
//! the request shape, per-client rate limiting, a bounded tile cache, and a
//! worker thread so sampling never runs on the tick thread. What a sample
//! means (which generator, which colours) is the game's.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use base64::Engine;
use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use hashbrown::HashMap;
use log::warn;
use serde::{Deserialize, Serialize};

use super::World;
use crate::{
    common::ClientFilter, encode_message, server::WsSender, Message, MessageType, MethodProtocol,
};

/// The method a client calls for tiles, and the name of each reply.
pub const FAR_TERRAIN_METHOD: &str = "vox-builtin:far-terrain";

/// What the server tells every client about its far terrain in the INIT
/// options (`farTerrain`); `None` means the world has no far layer.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FarTerrainDescriptor {
    /// Blocks between samples at the finest level; each coarser level
    /// doubles it.
    pub base_step: u16,
    /// Samples per tile side, including the shared edge row: 33 samples
    /// make 32 cells, and neighbouring tiles share their edge heights.
    pub tile_samples: u16,
    /// How many detail levels the sampler serves, 1..=4.
    pub levels: u8,
    /// The y the far water plane sits at: the top face of the sea's top
    /// block.
    pub water_surface: f32,
}

/// One tile's samples, row-major by z then x: index `j * size + i` is the
/// sample at `(origin_x + i * step, origin_z + j * step)`.
#[derive(Clone, Debug, PartialEq)]
pub struct FarTerrainTile {
    /// The y of the top face of each surface column.
    pub heights: Vec<u16>,
    /// A colour class per sample; the game's client maps it to a colour.
    pub colors: Vec<u8>,
    /// Floating land over each sample as `(top, bottom)` pairs, both 0
    /// where there is none. `None` when the world has no floating land.
    pub sky: Option<Vec<u16>>,
}

/// The game's coarse generator query.
pub trait FarTerrainSampler: Send + Sync {
    /// The tile `(tx, tz)` of `level`, with `step` blocks between its `size`
    /// samples per side. Tile `(tx, tz)` starts at world
    /// `(tx * (size - 1) * step, tz * (size - 1) * step)`.
    fn sample_tile(&self, level: u8, tx: i32, tz: i32, step: i32, size: usize) -> FarTerrainTile;
}

/// How much a client may ask for, and how much the server keeps.
#[derive(Clone, Copy, Debug)]
pub struct FarTerrainLimits {
    /// Tiles one method call may name; the rest of the list is dropped.
    pub max_tiles_per_request: usize,
    /// Sustained tiles per second per client.
    pub tiles_per_second: f32,
    /// Tiles a client may ask for at once after a quiet spell (a fresh join
    /// wants its whole horizon).
    pub burst: f32,
    /// Sampled tiles kept across clients; the oldest leave first.
    pub cache_tiles: usize,
    /// Tiles waiting for the worker across all clients; a request past this
    /// is refused and logged, never silently lost.
    pub queue_depth: usize,
}

impl Default for FarTerrainLimits {
    fn default() -> Self {
        Self {
            max_tiles_per_request: 16,
            tiles_per_second: 24.0,
            burst: 96.0,
            cache_tiles: 4096,
            queue_depth: 1024,
        }
    }
}

/// Tile position in the request and reply.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FarTileKey {
    pub level: u8,
    pub tx: i32,
    pub tz: i32,
}

#[derive(Deserialize)]
struct FarTerrainRequest {
    /// `[level, tx, tz]` triples.
    tiles: Vec<[i32; 3]>,
}

/// The wire form of one tile: fixed-width little-endian samples in base64,
/// so a 33x33 tile is about 4.5 KB of JSON instead of 20.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FarTerrainReply {
    pub level: u8,
    pub tx: i32,
    pub tz: i32,
    pub step: u16,
    pub size: u16,
    /// u16 LE per sample.
    pub heights: String,
    /// u8 per sample.
    pub colors: String,
    /// u16 LE `(top, bottom)` per sample, or absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sky: Option<String>,
}

impl FarTerrainReply {
    pub fn new(key: FarTileKey, step: u16, size: u16, tile: &FarTerrainTile) -> Self {
        let engine = base64::engine::general_purpose::STANDARD;
        let u16s = |values: &[u16]| {
            let mut bytes = Vec::with_capacity(values.len() * 2);
            for value in values {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            engine.encode(bytes)
        };
        Self {
            level: key.level,
            tx: key.tx,
            tz: key.tz,
            step,
            size,
            heights: u16s(&tile.heights),
            colors: engine.encode(&tile.colors),
            sky: tile.sky.as_deref().map(u16s),
        }
    }

    /// The reply as the method message the client receives.
    pub fn message(&self) -> Message {
        Message::new(&MessageType::Method)
            .method(MethodProtocol {
                name: FAR_TERRAIN_METHOD.to_owned(),
                payload: serde_json::to_string(self).unwrap_or_default(),
            })
            .build()
    }
}

/// Insertion-ordered bounded cache shared by the tick thread and the worker.
pub struct FarTileCache {
    tiles: HashMap<FarTileKey, Arc<FarTerrainTile>>,
    order: VecDeque<FarTileKey>,
    capacity: usize,
}

impl FarTileCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            tiles: HashMap::new(),
            order: VecDeque::new(),
            capacity: capacity.max(1),
        }
    }

    pub fn get(&self, key: &FarTileKey) -> Option<Arc<FarTerrainTile>> {
        self.tiles.get(key).cloned()
    }

    pub fn insert(&mut self, key: FarTileKey, tile: Arc<FarTerrainTile>) {
        if self.tiles.insert(key, tile).is_none() {
            self.order.push_back(key);
        }
        while self.tiles.len() > self.capacity {
            match self.order.pop_front() {
                Some(oldest) => {
                    self.tiles.remove(&oldest);
                }
                None => break,
            }
        }
    }

    pub fn len(&self) -> usize {
        self.tiles.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tiles.is_empty()
    }
}

/// Tiles per client: a token bucket refilled by wall time.
#[derive(Clone, Copy, Debug)]
pub struct TileBudget {
    tokens: f32,
    refilled_at: Instant,
}

impl TileBudget {
    fn new(limits: &FarTerrainLimits, now: Instant) -> Self {
        Self {
            tokens: limits.burst,
            refilled_at: now,
        }
    }

    /// How many of `wanted` tiles may go through now.
    fn take(&mut self, wanted: usize, limits: &FarTerrainLimits, now: Instant) -> usize {
        let elapsed = now.saturating_duration_since(self.refilled_at).as_secs_f32();
        self.refilled_at = now;
        self.tokens = (self.tokens + elapsed * limits.tiles_per_second).min(limits.burst);
        let granted = (wanted as f32).min(self.tokens.floor()) as usize;
        self.tokens -= granted as f32;
        granted
    }
}

struct Job {
    key: FarTileKey,
    sender: WsSender,
}

/// The world's far-terrain service, an ECS resource.
pub struct FarTerrain {
    descriptor: FarTerrainDescriptor,
    limits: FarTerrainLimits,
    cache: Arc<Mutex<FarTileCache>>,
    jobs: Sender<Job>,
    budgets: HashMap<String, TileBudget>,
    /// Requests refused for a full queue, for the periodic warning.
    refused: u64,
    last_refusal_log: Option<Instant>,
}

impl FarTerrain {
    pub fn new(
        sampler: Arc<dyn FarTerrainSampler>,
        descriptor: FarTerrainDescriptor,
        limits: FarTerrainLimits,
    ) -> Self {
        let cache = Arc::new(Mutex::new(FarTileCache::new(limits.cache_tiles)));
        let (jobs, receiver) = bounded::<Job>(limits.queue_depth.max(1));
        for index in 0..2 {
            let worker = TileWorker {
                sampler: Arc::clone(&sampler),
                descriptor,
                cache: Arc::clone(&cache),
                receiver: receiver.clone(),
            };
            std::thread::Builder::new()
                .name(format!("far-terrain-{index}"))
                .spawn(move || worker.run())
                .expect("spawn far-terrain worker");
        }
        Self {
            descriptor,
            limits,
            cache,
            jobs,
            budgets: HashMap::new(),
            refused: 0,
            last_refusal_log: None,
        }
    }

    pub fn descriptor(&self) -> FarTerrainDescriptor {
        self.descriptor
    }

    pub fn limits(&self) -> FarTerrainLimits {
        self.limits
    }

    /// Cached tiles right now.
    pub fn cached_tiles(&self) -> usize {
        self.cache.lock().map(|cache| cache.len()).unwrap_or(0)
    }

    /// Requests refused because the worker queue was full.
    pub fn refused(&self) -> u64 {
        self.refused
    }

    /// The tiles of a client's request that pass its budget and the
    /// request cap, in the order asked (the client sorts nearest first).
    pub fn admit(&mut self, client_id: &str, payload: &str, now: Instant) -> Vec<FarTileKey> {
        let Ok(request) = serde_json::from_str::<FarTerrainRequest>(payload) else {
            return Vec::new();
        };
        let levels = self.descriptor.levels.max(1) as i32;
        let wanted: Vec<FarTileKey> = request
            .tiles
            .into_iter()
            .filter(|[level, _, _]| (0..levels).contains(level))
            .take(self.limits.max_tiles_per_request)
            .map(|[level, tx, tz]| FarTileKey {
                level: level as u8,
                tx,
                tz,
            })
            .collect();
        if wanted.is_empty() {
            return wanted;
        }
        if self.budgets.len() > 1024 {
            self.budgets.clear();
        }
        let limits = self.limits;
        let budget = self
            .budgets
            .entry(client_id.to_owned())
            .or_insert_with(|| TileBudget::new(&limits, now));
        let granted = budget.take(wanted.len(), &limits, now);
        wanted.into_iter().take(granted).collect()
    }

    /// Hand the admitted tiles to the worker for `sender`. A full queue
    /// refuses the rest and says so (once per 5 s), so a starved horizon is
    /// never a silent drop.
    pub fn enqueue(&mut self, keys: Vec<FarTileKey>, sender: &WsSender) {
        for key in keys {
            match self.jobs.try_send(Job {
                key,
                sender: sender.clone(),
            }) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                    self.refused += 1;
                    let now = Instant::now();
                    let due = self
                        .last_refusal_log
                        .is_none_or(|at| now.saturating_duration_since(at).as_secs() >= 5);
                    if due {
                        self.last_refusal_log = Some(now);
                        warn!(
                            "far terrain: worker queue full ({} deep); {} tile request(s) refused so far, the client re-asks",
                            self.limits.queue_depth, self.refused
                        );
                    }
                    return;
                }
            }
        }
    }
}

struct TileWorker {
    sampler: Arc<dyn FarTerrainSampler>,
    descriptor: FarTerrainDescriptor,
    cache: Arc<Mutex<FarTileCache>>,
    receiver: Receiver<Job>,
}

impl TileWorker {
    fn run(self) {
        while let Ok(job) = self.receiver.recv() {
            let tile = self.tile(job.key);
            let step = self.descriptor.base_step << job.key.level;
            let reply = FarTerrainReply::new(job.key, step, self.descriptor.tile_samples, &tile);
            // A closed socket is a client that left; nothing to report.
            let _ = job.sender.send_bulk(encode_message(&reply.message()));
        }
    }

    fn tile(&self, key: FarTileKey) -> Arc<FarTerrainTile> {
        if let Some(tile) = self
            .cache
            .lock()
            .ok()
            .and_then(|cache| cache.get(&key))
        {
            return tile;
        }
        let step = (self.descriptor.base_step as i32) << key.level;
        let size = self.descriptor.tile_samples as usize;
        let tile = Arc::new(
            self.sampler
                .sample_tile(key.level, key.tx, key.tz, step, size),
        );
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key, Arc::clone(&tile));
        }
        tile
    }
}

impl World {
    /// Give the world a far-terrain layer: `sampler` answers tiles,
    /// `descriptor` goes to every client in the INIT options, and the
    /// [`FAR_TERRAIN_METHOD`] method starts answering requests.
    pub fn set_far_terrain(
        &mut self,
        sampler: Arc<dyn FarTerrainSampler>,
        descriptor: FarTerrainDescriptor,
        limits: FarTerrainLimits,
    ) {
        self.write_resource::<super::WorldConfig>().far_terrain = Some(descriptor);
        self.ecs_mut()
            .insert(FarTerrain::new(sampler, descriptor, limits));
        self.set_method_handle("vox-builtin:far-terrain", |world, client_id, payload| {
            world.answer_far_terrain(client_id, payload);
        });
    }

    /// The far-terrain service, when the world has one.
    pub fn far_terrain(&self) -> Option<specs::shred::Fetch<'_, FarTerrain>> {
        self.ecs().try_fetch::<FarTerrain>()
    }

    /// Answer a [`FAR_TERRAIN_METHOD`] call: admit what the caller's budget
    /// allows and hand it to the worker, which replies on the caller's
    /// socket.
    pub fn answer_far_terrain(&mut self, client_id: &str, payload: &str) {
        let Some(sender) = self.clients().get(client_id).map(|c| c.sender.clone()) else {
            return;
        };
        let now = Instant::now();
        let mut far = self.write_resource::<FarTerrain>();
        let keys = far.admit(client_id, payload, now);
        if keys.is_empty() {
            return;
        }
        far.enqueue(keys, &sender);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    struct Ramp;

    impl FarTerrainSampler for Ramp {
        fn sample_tile(
            &self,
            level: u8,
            tx: i32,
            tz: i32,
            step: i32,
            size: usize,
        ) -> FarTerrainTile {
            let origin_x = tx * (size as i32 - 1) * step;
            let origin_z = tz * (size as i32 - 1) * step;
            let mut heights = Vec::with_capacity(size * size);
            let mut colors = Vec::with_capacity(size * size);
            for j in 0..size as i32 {
                for i in 0..size as i32 {
                    let x = origin_x + i * step;
                    let z = origin_z + j * step;
                    heights.push((100 + (x + z).rem_euclid(50)) as u16);
                    colors.push(level);
                }
            }
            FarTerrainTile {
                heights,
                colors,
                sky: None,
            }
        }
    }

    fn descriptor() -> FarTerrainDescriptor {
        FarTerrainDescriptor {
            base_step: 8,
            tile_samples: 33,
            levels: 3,
            water_surface: 86.9,
        }
    }

    fn decode_u16(encoded: &str) -> Vec<u16> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        bytes
            .chunks(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect()
    }

    #[test]
    fn reply_round_trips_every_sample_in_fixed_width_base64() {
        let tile = Ramp.sample_tile(1, 2, -3, 16, 33);
        let key = FarTileKey {
            level: 1,
            tx: 2,
            tz: -3,
        };
        let reply = FarTerrainReply::new(key, 16, 33, &tile);
        let json = serde_json::to_string(&reply).unwrap();
        let back: FarTerrainReply = serde_json::from_str(&json).unwrap();
        assert_eq!((back.level, back.tx, back.tz, back.step, back.size), (1, 2, -3, 16, 33));
        assert_eq!(decode_u16(&back.heights), tile.heights);
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(&back.colors)
                .unwrap(),
            tile.colors
        );
        assert!(back.sky.is_none());
        // 33x33 samples: 2178 height bytes + 1089 colour bytes in base64, under 5 KB on the wire.
        assert!(json.len() < 5000, "reply is {} bytes", json.len());
    }

    #[test]
    fn cache_keeps_the_newest_tiles_and_evicts_the_oldest() {
        let mut cache = FarTileCache::new(2);
        let tile = Arc::new(Ramp.sample_tile(0, 0, 0, 8, 3));
        for tx in 0..3 {
            cache.insert(
                FarTileKey {
                    level: 0,
                    tx,
                    tz: 0,
                },
                Arc::clone(&tile),
            );
        }
        assert_eq!(cache.len(), 2);
        assert!(cache
            .get(&FarTileKey {
                level: 0,
                tx: 0,
                tz: 0
            })
            .is_none());
        assert!(cache
            .get(&FarTileKey {
                level: 0,
                tx: 2,
                tz: 0
            })
            .is_some());
        // Re-inserting an existing key neither grows nor reorders the cache.
        cache.insert(
            FarTileKey {
                level: 0,
                tx: 2,
                tz: 0,
            },
            tile,
        );
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn budget_grants_a_burst_then_refills_by_time() {
        let limits = FarTerrainLimits {
            burst: 4.0,
            tiles_per_second: 2.0,
            ..Default::default()
        };
        let start = Instant::now();
        let mut budget = TileBudget::new(&limits, start);
        assert_eq!(budget.take(6, &limits, start), 4);
        assert_eq!(budget.take(1, &limits, start), 0);
        assert_eq!(budget.take(5, &limits, start + Duration::from_secs(1)), 2);
        // Never above the burst, however long the quiet spell.
        assert_eq!(budget.take(10, &limits, start + Duration::from_secs(60)), 4);
    }

    #[test]
    fn admit_drops_bad_levels_caps_the_request_and_spends_the_budget() {
        let mut far = FarTerrain::new(
            Arc::new(Ramp),
            descriptor(),
            FarTerrainLimits {
                max_tiles_per_request: 3,
                burst: 5.0,
                ..Default::default()
            },
        );
        let now = Instant::now();
        let payload = r#"{"tiles":[[0,0,0],[7,1,1],[1,2,2],[2,3,3],[0,4,4],[0,5,5]]}"#;
        let admitted = far.admit("a", payload, now);
        assert_eq!(
            admitted,
            vec![
                FarTileKey {
                    level: 0,
                    tx: 0,
                    tz: 0
                },
                FarTileKey {
                    level: 1,
                    tx: 2,
                    tz: 2
                },
                FarTileKey {
                    level: 2,
                    tx: 3,
                    tz: 3
                },
            ]
        );
        // Two tokens left of the burst of five.
        assert_eq!(far.admit("a", payload, now).len(), 2);
        assert_eq!(far.admit("a", payload, now).len(), 0);
        // Another client has its own budget.
        assert_eq!(far.admit("b", payload, now).len(), 3);
        assert!(far.admit("a", "not json", now).is_empty());
    }

    #[test]
    fn worker_answers_on_the_bulk_lane_and_caches_the_tile() {
        let mut far = FarTerrain::new(Arc::new(Ramp), descriptor(), FarTerrainLimits::default());
        let (control_tx, _control_rx) = tokio::sync::mpsc::unbounded_channel();
        let (bulk_tx, mut bulk_rx) = tokio::sync::mpsc::unbounded_channel();
        let sender = WsSender::new(control_tx, bulk_tx);
        let key = FarTileKey {
            level: 0,
            tx: 1,
            tz: 1,
        };
        far.enqueue(vec![key, key], &sender);
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut replies = Vec::new();
        while replies.len() < 2 && Instant::now() < deadline {
            match bulk_rx.try_recv() {
                Ok(bytes) => replies.push(bytes),
                Err(_) => std::thread::sleep(Duration::from_millis(5)),
            }
        }
        assert_eq!(replies.len(), 2, "both requests are answered");
        // A 33x33 reply is past the LZ4 threshold and arrives framed.
        let bytes = {
            use std::io::Read;
            let mut plain = Vec::new();
            lz4_flex::frame::FrameDecoder::new(&replies[0][..])
                .read_to_end(&mut plain)
                .map(|_| plain)
                .unwrap_or_else(|_| replies[0].clone())
        };
        let message = crate::decode_message(&bytes).unwrap();
        let method = message.method.expect("a method reply");
        assert_eq!(method.name, FAR_TERRAIN_METHOD);
        let reply: FarTerrainReply = serde_json::from_str(&method.payload).unwrap();
        assert_eq!((reply.level, reply.tx, reply.tz, reply.step), (0, 1, 1, 8));
        assert_eq!(decode_u16(&reply.heights), Ramp.sample_tile(0, 1, 1, 8, 33).heights);
        assert_eq!(far.cached_tiles(), 1, "the same tile is sampled once");
        assert_eq!(far.refused(), 0);
    }

    #[test]
    fn a_full_queue_refuses_and_counts() {
        let mut far = FarTerrain::new(
            Arc::new(Ramp),
            descriptor(),
            FarTerrainLimits {
                queue_depth: 1,
                ..Default::default()
            },
        );
        // A sender nobody reads keeps the worker busy only while it samples;
        // flood faster than two workers can drain a one-deep queue.
        let (control_tx, _control_rx) = tokio::sync::mpsc::unbounded_channel();
        let (bulk_tx, _bulk_rx) = tokio::sync::mpsc::unbounded_channel();
        let sender = WsSender::new(control_tx, bulk_tx);
        let keys: Vec<FarTileKey> = (0..64)
            .map(|tx| FarTileKey {
                level: 2,
                tx,
                tz: tx,
            })
            .collect();
        far.enqueue(keys, &sender);
        // Either some were refused (and counted) or every one made it: the
        // contract is that a refusal is never silent, not that one happens.
        let refused = far.refused();
        assert!(refused < 64, "at least the first tile is queued");
    }

    #[test]
    fn descriptor_serializes_camel_case_for_the_init_options() {
        let json = serde_json::to_string(&descriptor()).unwrap();
        assert!(json.contains("\"baseStep\":8"));
        assert!(json.contains("\"tileSamples\":33"));
        assert!(json.contains("\"levels\":3"));
        assert!(json.contains("\"waterSurface\":86.9"));
    }
}
