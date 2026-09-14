use base64::{engine::general_purpose::STANDARD, Engine};
use byteorder::{ByteOrder, LittleEndian};
use hashbrown::{HashMap, HashSet};
use libflate::zlib::{Decoder, Encoder};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use specs::Entity;
use std::sync::Arc;
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, VecDeque},
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::PathBuf,
};

use crate::{
    BlockUtils, ChunkOptions, ChunkStatus, ChunkUtils, LightUtils, MessageType, Registry, Vec2,
    Vec3, VoxelUpdate, WaterloggingRules, WorldConfig,
};

use super::{
    access::VoxelAccess,
    background_chunk_saver::{ChunkSaveData, CHUNK_FILE_VERSION},
    chunk::{Chunk, ChunkRenewal},
    space::{SpaceBuilder, SpaceOptions},
};

#[derive(Eq, PartialEq, Clone)]
pub struct ActiveVoxel {
    pub tick: u64,
    pub voxel: Vec3<i32>,
}

impl Ord for ActiveVoxel {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.tick.cmp(&other.tick)
    }
}

impl PartialOrd for ActiveVoxel {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// A chunk waiting to be handed to the background saver, and how many ticks it
/// has spent unreadable so far. Entries only ever leave this queue by being
/// saved or by exhausting `max_save_retries`, which is reported as an error.
pub(crate) struct PendingChunkSave {
    coords: Vec2<i32>,
    attempts: usize,
}

/// Prototype for chunk's internal data used to send to client
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkFileData {
    id: String,
    voxels: String,
    height_map: String,
    #[serde(default)]
    version: u32,
}

/// Backfill the waterlogged bit on a chunk saved before waterlogging existed.
///
/// Those files recorded submerged plants as plain blocks that had displaced
/// their water, which now reads as a block-shaped air pocket in every ocean.
/// A waterloggable voxel touching the fluid inside this chunk was underwater
/// when it was written, so it is restored as waterlogged. Cross-chunk
/// neighbours are deliberately not consulted — the neighbouring chunk may not
/// be loaded — and the fluid simulation covers the seams it misses.
///
/// Returns whether anything changed, so an untouched chunk is not rewritten.
fn backfill_waterlogged_voxels(chunk: &mut Chunk, registry: &Registry) -> bool {
    const ORTHOGONAL_NEIGHBORS: [[i32; 3]; 6] = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
    ];

    let Some(fluid_id) = registry.waterlogging_fluid_id() else {
        return false;
    };

    let Vec3(min_x, min_y, min_z) = chunk.min;
    let Vec3(max_x, max_y, max_z) = chunk.max;

    let mut submerged = Vec::new();
    for vx in min_x..max_x {
        for vz in min_z..max_z {
            for vy in min_y..max_y {
                let raw = chunk.get_raw_voxel(vx, vy, vz);
                if BlockUtils::extract_waterlogged(raw) {
                    continue;
                }
                if !registry.is_waterloggable(BlockUtils::extract_id(raw)) {
                    continue;
                }
                let touches_fluid = ORTHOGONAL_NEIGHBORS.iter().any(|[ox, oy, oz]| {
                    let (nx, ny, nz) = (vx + ox, vy + oy, vz + oz);
                    chunk.contains(nx, ny, nz) && chunk.get_voxel(nx, ny, nz) == fluid_id
                });
                if touches_fluid {
                    submerged.push(Vec3(vx, vy, vz));
                }
            }
        }
    }

    for Vec3(vx, vy, vz) in &submerged {
        chunk.set_voxel_waterlogged(*vx, *vy, *vz, true);
    }

    !submerged.is_empty()
}

/// One chunk's share of pending writes, see
/// `Chunks::pending_update_head_report`.
#[derive(Clone, Debug)]
pub struct PendingUpdateHeadEntry {
    pub lane: UpdateLane,
    /// Waiting in `Chunks::parked_updates` for the chunk's light footprint,
    /// rather than queued on the lane itself.
    pub is_parked: bool,
    pub coords: Vec2<i32>,
    pub count: usize,
    /// `Debug` form of the chunk status, or `unloaded` when the chunk is not
    /// in the map at all.
    pub status: String,
    /// Chunks in the light footprint that are not `Ready`; the updating pass
    /// waits on all of them, not only the target.
    pub unready_neighbors: usize,
}

/// A write popped off its lane whose chunk was not ready, waiting in
/// `Chunks::parked_updates` with the lane it goes back to.
pub type ParkedUpdate = (Vec3<i32>, u32, UpdateLane);

/// Which queue a pending voxel update drains from. See `Chunks::active_updates`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum UpdateLane {
    /// Writes from outside the simulation: player edits, methods, commands.
    External,
    /// Writes the simulation produced: fluid steps, growth, active tickers.
    Active,
}

/// A manager for all chunks in the Voxelize world.
#[derive(Default)]
pub struct Chunks {
    /// A map of all the chunks, coords -> Chunk.
    pub map: HashMap<Vec2<i32>, Chunk>,

    /// Voxel updates waiting to be processed.
    pub(crate) updates: VecDeque<VoxelUpdate>,

    /// Staging area for new voxel updates (deduplicates before flushing to queue).
    pub(crate) updates_staging: HashMap<Vec3<i32>, u32>,

    /// Voxel updates the world's own simulation produced — fluid steps,
    /// growth, active-block tickers — waiting to be processed. A separate
    /// lane from `updates` so a spreading lake and a bulk player build each
    /// drain under their own per-tick budget (`max_updates_per_tick` vs
    /// `max_active_updates_per_tick`) instead of queueing behind one another:
    /// on a world budgeted at 100 external writes a tick, one large fill used
    /// to freeze every fluid in the world for seconds.
    pub(crate) active_updates: VecDeque<VoxelUpdate>,

    /// Staging area for `active_updates`, deduplicated before flushing.
    pub(crate) active_updates_staging: HashMap<Vec3<i32>, u32>,

    /// Writes popped for a chunk whose light footprint was not ready, keyed
    /// by that chunk. They wait here instead of back at the head of their
    /// lane: handed back to the head, a stuck set larger than the per-tick
    /// budget is all a tick ever pops, and every write behind it starves for
    /// as long as the chunk stays unloaded (a 13k-voxel fill straddling one
    /// unloaded neighbor froze a 4000-a-tick lane outright). Re-admitted to
    /// the front of their lane, in order, the tick the footprint is ready.
    /// Counted by `pending_updates_count` and named by
    /// `pending_update_head_report`, so a park that never empties is visible.
    pub(crate) parked_updates: HashMap<Vec2<i32>, Vec<ParkedUpdate>>,

    /// A list of chunks that are done meshing and ready to be sent.
    pub(crate) to_send: VecDeque<(Vec2<i32>, MessageType)>,

    /// A list of chunks that are done meshing and ready to be saved, if `config.save` is true.
    pub(crate) to_save: VecDeque<PendingChunkSave>,

    pub(crate) active_voxel_heap: BinaryHeap<Reverse<ActiveVoxel>>,
    pub(crate) active_voxel_set: HashMap<Vec3<i32>, u64>,

    /// A listener for when a chunk is done generating or meshing.
    pub(crate) listeners: HashMap<Vec2<i32>, Vec<Vec2<i32>>>,

    /// A cache of what chunks has been borrowed mutable.
    pub(crate) cache: HashSet<Vec2<i32>>,

    pub block_entities: HashMap<Vec3<i32>, Entity>,

    pub(crate) freshly_created: HashSet<Vec2<i32>>,

    pub newly_generated: Vec<Vec2<i32>>,

    config: WorldConfig,

    /// The folder to store the chunks.
    folder: Option<PathBuf>,

    waterlogging_rules: Option<Arc<WaterloggingRules>>,
}

impl Chunks {
    pub fn folder(&self) -> Option<&PathBuf> {
        self.folder.as_ref()
    }

    pub fn waterlogging_rules(&self) -> Option<&WaterloggingRules> {
        self.waterlogging_rules.as_deref()
    }

    pub fn set_waterlogging_rules(&mut self, rules: Option<Arc<WaterloggingRules>>) {
        self.waterlogging_rules = rules;
        for chunk in self.map.values_mut() {
            chunk.waterlogging_rules = self.waterlogging_rules.clone();
        }
    }

    /// Create a new instance of a chunk manager.
    pub fn new(config: &WorldConfig) -> Self {
        let folder = if config.saving {
            let mut folder = PathBuf::from(&config.save_dir);
            if folder.is_relative() {
                if let Ok(cwd) = std::env::current_dir() {
                    folder = cwd.join(folder);
                }
            }
            folder.push("chunks");

            fs::create_dir_all(&folder).expect("Unable to create chunks directory...");

            Some(folder)
        } else {
            None
        };

        Self {
            folder,
            config: config.to_owned(),
            ..Default::default()
        }
    }

    /// Drops every chunk this world holds, in memory and on disk, and returns
    /// the coords that were resident. Nothing is regenerated here: the terrain
    /// comes back through the ordinary cold path the next time a client asks
    /// for a chunk that neither the map nor the save folder has.
    pub fn wipe(&mut self) -> Vec<Vec2<i32>> {
        let resident: Vec<Vec2<i32>> = self.map.keys().cloned().collect();

        self.map.clear();
        self.updates.clear();
        self.updates_staging.clear();
        self.to_send.clear();
        self.to_save.clear();
        self.active_voxel_heap.clear();
        self.active_voxel_set.clear();
        self.listeners.clear();
        self.cache.clear();
        self.freshly_created.clear();
        self.newly_generated.clear();
        self.block_entities.clear();

        if let Some(folder) = &self.folder {
            match fs::read_dir(folder) {
                Ok(entries) => {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file() {
                            let _ = fs::remove_file(path);
                        }
                    }
                }
                Err(err) => warn!("Could not read chunk folder to wipe it: {err}"),
            }
        }

        resident
    }

    pub fn test_load(&self, coords: &Vec2<i32>) -> bool {
        let path = self.get_chunk_file_path(&ChunkUtils::get_chunk_name(coords.0, coords.1));
        let meta = match fs::metadata(&path) {
            Ok(meta) => meta,
            Err(_) => return false,
        };
        // Empty/truncated saves must not count as loadable — otherwise generation
        // loops forever (test_load true -> try_load None -> re-queue) and never
        // regenerates terrain.
        meta.is_file() && meta.len() > 0
    }

    fn remove_corrupt_chunk_file(&self, path: &PathBuf, reason: &str) {
        warn!(
            "Removing corrupt chunk save at {}: {}",
            path.display(),
            reason
        );
        if let Err(err) = fs::remove_file(path) {
            warn!(
                "Failed to remove corrupt chunk save at {}: {}",
                path.display(),
                err
            );
        }
    }

    // Try to load the data of a chunk, returns whether successful or not.
    // On corrupt/empty/invalid saves, removes the file so the chunk can regenerate.
    pub fn try_load(&self, coords: &Vec2<i32>, registry: &Registry) -> Option<Chunk> {
        if !self.config.saving {
            return None;
        }

        let path = self.get_chunk_file_path(&ChunkUtils::get_chunk_name(coords.0, coords.1));
        let meta = match fs::metadata(&path) {
            Ok(meta) if meta.is_file() && meta.len() > 0 => meta,
            Ok(_) => {
                self.remove_corrupt_chunk_file(&path, "empty or non-file");
                return None;
            }
            Err(_) => return None,
        };
        let _ = meta;

        let file = match File::open(&path) {
            Ok(file) => file,
            Err(_) => return None,
        };
        let chunk_data = BufReader::new(file);

        let data: ChunkFileData = match serde_json::from_reader(chunk_data) {
            Ok(data) => data,
            Err(err) => {
                self.remove_corrupt_chunk_file(&path, &format!("invalid JSON ({err})"));
                return None;
            }
        };

        let decode_base64 = |base: &str| -> Result<Vec<u32>, String> {
            if base.is_empty() {
                return Ok(vec![]);
            }

            let decoded = STANDARD
                .decode(base)
                .map_err(|err| format!("base64 decode failed: {err}"))?;
            let mut decoder =
                Decoder::new(&decoded[..]).map_err(|err| format!("zlib decoder failed: {err}"))?;
            let mut buf = Vec::new();
            decoder
                .read_to_end(&mut buf)
                .map_err(|err| format!("zlib decompress failed: {err}"))?;
            if buf.len() % 4 != 0 {
                return Err(format!(
                    "decoded byte length {} is not a multiple of 4",
                    buf.len()
                ));
            }
            let mut data = vec![0; buf.len() / 4];
            LittleEndian::read_u32_into(&buf, &mut data);
            Ok(data)
        };

        let (voxels_result, height_map_result) = rayon::join(
            || decode_base64(&data.voxels),
            || decode_base64(&data.height_map),
        );

        let voxels = match voxels_result {
            Ok(voxels) => voxels,
            Err(err) => {
                self.remove_corrupt_chunk_file(&path, &format!("voxels: {err}"));
                return None;
            }
        };
        let height_map = match height_map_result {
            Ok(height_map) => height_map,
            Err(err) => {
                self.remove_corrupt_chunk_file(&path, &format!("height_map: {err}"));
                return None;
            }
        };

        let size = self.config.chunk_size;
        let max_height = self.config.max_height;
        let expected_voxels = size * max_height * size;
        let expected_height_map = size * size;

        if voxels.is_empty() || voxels.len() != expected_voxels {
            self.remove_corrupt_chunk_file(
                &path,
                &format!(
                    "voxels length {} does not match chunk_size={} max_height={} (expected {})",
                    voxels.len(),
                    size,
                    max_height,
                    expected_voxels
                ),
            );
            return None;
        }

        let mut chunk = Chunk::new(
            &data.id,
            coords.0,
            coords.1,
            &ChunkOptions {
                max_height,
                sub_chunks: self.config.sub_chunks,
                size,
            },
        );

        Arc::make_mut(&mut chunk.voxels).data = voxels;
        chunk.top_filled_y = None;

        let mut is_save_dirty = false;
        if height_map.len() == expected_height_map {
            Arc::make_mut(&mut chunk.height_map).data = height_map;
        } else {
            if !height_map.is_empty() {
                warn!(
                    "Chunk save at {} has height_map length {} (expected {}); recalculating from voxels",
                    path.display(),
                    height_map.len(),
                    expected_height_map
                );
                is_save_dirty = true;
            }
            chunk.calculate_max_height(registry);
        }

        chunk.waterlogging_rules = self.waterlogging_rules.clone();
        chunk.status = ChunkStatus::Meshing;
        chunk.is_save_dirty = is_save_dirty;

        if data.version < CHUNK_FILE_VERSION && backfill_waterlogged_voxels(&mut chunk, registry) {
            chunk.is_save_dirty = true;
        }

        Some(chunk)
    }

    pub fn save(&self, coords: &Vec2<i32>) -> bool {
        if !self.config.saving {
            panic!("Calling `chunks.save` when saving mode is not on.");
        }

        let chunk = if let Some(chunk) = self.get(coords) {
            chunk
        } else {
            return false;
        };

        let path = self.get_chunk_file_path(&chunk.name);
        let tmp_path = path.with_extension("json.tmp");

        let to_base_64 = |data: &Vec<u32>| {
            let mut bytes = vec![0; data.len() * 4];
            LittleEndian::write_u32_into(data, &mut bytes);

            let mut encoder = Encoder::new(vec![]).unwrap();
            encoder.write_all(bytes.as_slice()).unwrap();
            let encoded = encoder.finish().into_result().unwrap();
            base64::encode(&encoded)
        };

        let data = ChunkFileData {
            id: chunk.id.to_owned(),
            voxels: to_base_64(&chunk.voxels.data),
            height_map: to_base_64(&chunk.height_map.data),
            version: CHUNK_FILE_VERSION,
        };

        let j = match serde_json::to_string(&data) {
            Ok(j) => j,
            Err(_) => return false,
        };

        let mut file = match File::create(&tmp_path) {
            Ok(f) => f,
            Err(_) => return false,
        };

        if file.write_all(j.as_bytes()).is_err() {
            let _ = fs::remove_file(&tmp_path);
            return false;
        }

        if file.sync_all().is_err() {
            let _ = fs::remove_file(&tmp_path);
            return false;
        }

        drop(file);

        if fs::rename(&tmp_path, &path).is_err() {
            let _ = fs::remove_file(&tmp_path);
            return false;
        }

        true
    }

    pub fn prepare_save_data(&self, coords: &Vec2<i32>) -> Option<ChunkSaveData> {
        let chunk = self.get(coords)?;
        Some(ChunkSaveData {
            coords: coords.to_owned(),
            chunk_name: chunk.name.clone(),
            chunk_id: chunk.id.clone(),
            voxels: chunk.voxels.data.clone(),
            height_map: chunk.height_map.data.clone(),
        })
    }

    /// Take up to `max_saves` chunks off the save queue, prepared for the
    /// background saver.
    ///
    /// A queued chunk that cannot be read yet — it went back through the
    /// pipeline after being queued — is put back rather than skipped over, so a
    /// coordinate can only leave this queue two ways: prepared here, or dropped
    /// after `max_retries` ticks of failure with an error naming the chunk.
    /// Neither path is silent, and a stuck entry at the head cannot hold up the
    /// chunks behind it.
    pub fn take_pending_saves(
        &mut self,
        max_saves: usize,
        max_retries: usize,
    ) -> Vec<ChunkSaveData> {
        let mut prepared = Vec::new();
        let mut deferred = Vec::new();
        let mut unvisited = self.to_save.len();

        while prepared.len() < max_saves && unvisited > 0 {
            unvisited -= 1;

            let Some(mut pending) = self.to_save.pop_front() else {
                break;
            };

            if let Some(data) = self.prepare_save_data(&pending.coords) {
                prepared.push(data);
                continue;
            }

            pending.attempts += 1;

            if pending.attempts >= max_retries {
                error!(
                    "Dropping the queued save for chunk {:?}: unreadable for {} ticks, so it never reached disk. Any edits it holds are lost on restart.",
                    pending.coords, pending.attempts
                );
                continue;
            }

            deferred.push(pending);
        }

        self.to_save.extend(deferred);

        prepared
    }

    /// Update a chunk with the outcome of an asynchronous pass. The renewal
    /// mode names exactly which parts of the incoming chunk are newer than
    /// the live one — the async worker operated on a clone, so anything not
    /// taken from the result is deliberately kept from the live chunk.
    pub fn renew(&mut self, mut chunk: Chunk, renewal: ChunkRenewal) {
        if !matches!(renewal, ChunkRenewal::Full) {
            if let Some(mut old_chunk) = self.map.remove(&chunk.coords) {
                old_chunk.meshes = chunk.meshes;
                old_chunk.status = chunk.status;
                if matches!(renewal, ChunkRenewal::MeshAndLights) {
                    old_chunk.lights = chunk.lights;
                }
                self.map.insert(chunk.coords.to_owned(), old_chunk);
                return;
            }
            // No live chunk to merge into: fall through and insert whole.
        }

        chunk.waterlogging_rules = self.waterlogging_rules.clone();
        self.map.remove(&chunk.coords);
        self.map.insert(chunk.coords.to_owned(), chunk);
    }

    /// Add a new chunk, synonym for `chunks.renew`
    pub fn add(&mut self, chunk: Chunk) {
        self.renew(chunk, ChunkRenewal::Full);
    }

    /// Get raw chunk data.
    pub fn raw(&self, coords: &Vec2<i32>) -> Option<&Chunk> {
        if !self.is_within_world(coords) {
            return None;
        }

        self.map.get(coords)
    }

    /// Get raw mutable chunk data.
    pub fn raw_mut(&mut self, coords: &Vec2<i32>) -> Option<&mut Chunk> {
        if !self.is_within_world(coords) {
            return None;
        }

        self.cache.insert(coords.to_owned());
        self.map.get_mut(coords)
    }

    /// Get a chunk at a chunk coordinate. Keep in mind that this function only returns a chunk if the chunk
    /// has been fully instantiated and meshed. None is returned if not.
    pub fn get(&self, coords: &Vec2<i32>) -> Option<&Chunk> {
        if !self.is_within_world(coords) || !self.is_chunk_ready(coords) {
            return None;
        }

        self.map.get(coords)
    }

    /// Get a mutable chunk reference at a chunk coordinate. Keep in mind that this function only returns a chunk
    /// if the chunk has been fully instantiated and meshed. None is returned if not.
    pub fn get_mut(&mut self, coords: &Vec2<i32>) -> Option<&mut Chunk> {
        if !self.is_within_world(coords) || !self.is_chunk_ready(coords) {
            return None;
        }

        self.cache.insert(coords.to_owned());
        self.map.get_mut(coords)
    }

    // Get a chunk by voxel coordinates. Returns a chunk even if chunk isn't fully instantiated.
    pub fn raw_chunk_by_voxel(&self, vx: i32, vy: i32, vz: i32) -> Option<&Chunk> {
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, self.config.chunk_size as usize);
        self.raw(&coords)
    }

    /// Get a mutable chunk by voxel coordinates. Returns a chunk even if chunk isn't fully instantiated.
    pub fn raw_chunk_by_voxel_mut(&mut self, vx: i32, vy: i32, vz: i32) -> Option<&mut Chunk> {
        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, self.config.chunk_size as usize);
        self.raw_mut(&coords)
    }

    /// Get neighboring coords of a voxel coordinate.
    pub fn voxel_affected_chunks(&self, vx: i32, vy: i32, vz: i32) -> Vec<Vec2<i32>> {
        let mut neighbors = vec![];
        let chunk_size = self.config.chunk_size;

        let Vec2(cx, cz) = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        let Vec3(lx, _, lz) = ChunkUtils::map_voxel_to_chunk_local(vx, vy, vz, chunk_size);

        neighbors.push(Vec2(cx, cz));

        let a = lx == 0;
        let b = lz == 0;
        let c = lx == chunk_size - 1;
        let d = lz == chunk_size - 1;

        if a {
            neighbors.push(Vec2(cx - 1, cz))
        }
        if b {
            neighbors.push(Vec2(cx, cz - 1));
        }
        if c {
            neighbors.push(Vec2(cx + 1, cz));
        }
        if d {
            neighbors.push(Vec2(cx, cz + 1));
        }

        if a && b {
            neighbors.push(Vec2(cx - 1, cz - 1));
        }
        if a && d {
            neighbors.push(Vec2(cx - 1, cz + 1));
        }
        if b && c {
            neighbors.push(Vec2(cx + 1, cz - 1));
        }
        if c && d {
            neighbors.push(Vec2(cx + 1, cz + 1));
        }

        neighbors
            .into_iter()
            .filter(|coords| self.is_within_world(coords))
            .collect()
    }

    /// Get a list of chunks that light could traverse within.
    pub fn light_traversed_chunks(&self, coords: &Vec2<i32>) -> Vec<Vec2<i32>> {
        let mut list = vec![];
        let extended =
            (self.config.max_light_level as f32 / self.config.chunk_size as f32).ceil() as i32;

        for x in -extended..=extended {
            for z in -extended..=extended {
                let n_coords = Vec2(coords.0 + x, coords.1 + z);

                if self.is_within_world(&n_coords) {
                    list.push(n_coords);
                }
            }
        }

        list
    }

    /// Create a voxel querying space around a chunk coordinate.
    pub fn make_space<'a>(&'a self, coords: &Vec2<i32>, margin: usize) -> SpaceBuilder<'a> {
        SpaceBuilder {
            chunks: self,
            coords: coords.to_owned(),
            options: SpaceOptions {
                margin,
                chunk_size: self.config.chunk_size,
                sub_chunks: self.config.sub_chunks,
                max_height: self.config.max_height,
                max_light_level: self.config.max_light_level,
            },
            needs_voxels: false,
            needs_lights: false,
            needs_height_maps: false,
            strict: false,
        }
    }

    /// Check to see if chunk is within the world's min/max chunk.
    pub fn is_within_world(&self, coords: &Vec2<i32>) -> bool {
        coords.0 >= self.config.min_chunk[0]
            && coords.0 <= self.config.max_chunk[0]
            && coords.1 >= self.config.min_chunk[1]
            && coords.1 <= self.config.max_chunk[1]
    }

    /// Guard to getting a chunk, only allowing chunks to be accessed when they're ready.
    pub fn is_chunk_ready(&self, coords: &Vec2<i32>) -> bool {
        if let Some(chunk) = self.raw(coords) {
            return chunk.status == ChunkStatus::Ready;
        }

        false
    }

    /// Clear the mutable chunk borrowing list.
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }

    /// Whether the chunk has persisted data — voxels or height map — that has
    /// been written since it was loaded or generated.
    ///
    /// A mutable borrow is not the same question: light flooding borrows every
    /// chunk a cascade reaches, and light is never written to disk. Saving on
    /// the borrow instead writes a file for a chunk nobody changed, and a file
    /// that exists short-circuits worldgen for that chunk from then on.
    pub fn is_chunk_save_dirty(&self, coords: &Vec2<i32>) -> bool {
        self.raw(coords).is_some_and(|chunk| chunk.is_save_dirty)
    }

    /// Update a voxel in the chunk map. This includes recalculating the light and height maps
    /// and sending the chunk to the interested clients. This process is not instant, and will
    /// be done in the background.
    pub fn update_voxel(&mut self, voxel: &Vec3<i32>, val: u32) {
        self.updates_staging.insert(voxel.to_owned(), val);
    }

    /// Flush staged updates into the processing queue. Called before processing updates.
    ///
    /// Staged updates commit in (y, x, z) order rather than HashMap order:
    /// multi-voxel structures are written bottom-up, so when a batch is cut by
    /// the per-tick budget, a door bottom (or tall-plant base) is always
    /// committed before the half that depends on it. Random order let the
    /// dependent half commit first and watch its support "missing" for a tick.
    pub fn flush_staged_updates(&mut self) {
        if !self.updates_staging.is_empty() {
            self.updates
                .retain(|(v, _)| !self.updates_staging.contains_key(v));
            // An external write to a voxel supersedes whatever the simulation
            // still has queued for it: player intent wins, and the fluid or
            // growth ticker that produced the stale write re-plans from the
            // committed state on its next tick anyway.
            self.active_updates
                .retain(|(v, _)| !self.updates_staging.contains_key(v));
            self.active_updates_staging
                .retain(|v, _| !self.updates_staging.contains_key(v));
            Self::retain_parked(&mut self.parked_updates, |(v, _, _)| {
                !self.updates_staging.contains_key(v)
            });

            let mut staged: Vec<(Vec3<i32>, u32)> = self.updates_staging.drain().collect();
            staged.sort_by_key(|(voxel, _)| (voxel.1, voxel.0, voxel.2));
            self.updates.extend(staged);
        }

        if !self.active_updates_staging.is_empty() {
            self.active_updates
                .retain(|(v, _)| !self.active_updates_staging.contains_key(v));
            Self::retain_parked(&mut self.parked_updates, |(v, _, lane)| {
                *lane != UpdateLane::Active || !self.active_updates_staging.contains_key(v)
            });

            let mut staged: Vec<(Vec3<i32>, u32)> =
                self.active_updates_staging.drain().collect();
            staged.sort_by_key(|(voxel, _)| (voxel.1, voxel.0, voxel.2));
            self.active_updates.extend(staged);
        }
    }

    fn retain_parked(
        parked: &mut HashMap<Vec2<i32>, Vec<ParkedUpdate>>,
        mut keep: impl FnMut(&ParkedUpdate) -> bool,
    ) {
        for updates in parked.values_mut() {
            updates.retain(|update| keep(update));
        }
        parked.retain(|_, updates| !updates.is_empty());
    }

    /// Whether writes into `coords` can commit now: the chunk and every chunk
    /// its light can spill into are `Ready`.
    pub fn is_update_footprint_ready(&self, coords: &Vec2<i32>) -> bool {
        self.is_chunk_ready(coords)
            && self
                .light_traversed_chunks(coords)
                .iter()
                .all(|n| self.is_chunk_ready(n))
    }

    /// Set aside writes popped for a chunk whose footprint is not ready. See
    /// `parked_updates`.
    pub(crate) fn park_updates(&mut self, coords: Vec2<i32>, updates: Vec<ParkedUpdate>) {
        self.parked_updates
            .entry(coords)
            .or_default()
            .extend(updates);
    }

    /// Hand parked writes whose chunk footprint has become ready back to the
    /// front of their lanes, in their original order. Returns how many moved.
    pub(crate) fn readmit_parked_updates(&mut self) -> usize {
        let ready: Vec<Vec2<i32>> = self
            .parked_updates
            .keys()
            .filter(|coords| self.is_update_footprint_ready(coords))
            .cloned()
            .collect();
        let mut readmitted = 0;
        for coords in ready {
            let Some(updates) = self.parked_updates.remove(&coords) else {
                continue;
            };
            readmitted += updates.len();
            for (voxel, raw, lane) in updates.into_iter().rev() {
                self.lane_queue(lane).push_front((voxel, raw));
            }
        }
        readmitted
    }

    pub fn update_voxels(&mut self, voxels: &[(Vec3<i32>, u32)]) {
        for (voxel, val) in voxels {
            self.update_voxel(voxel, *val);
        }
    }

    /// Queue a write produced by the world's own simulation (an active
    /// updater or random tick) on the simulation lane. See `active_updates`.
    pub fn update_active_voxel(&mut self, voxel: &Vec3<i32>, val: u32) {
        self.active_updates_staging.insert(voxel.to_owned(), val);
    }

    pub fn update_active_voxels(&mut self, voxels: &[(Vec3<i32>, u32)]) {
        for (voxel, val) in voxels {
            self.update_active_voxel(voxel, *val);
        }
    }

    /// The flushed queue of one lane.
    pub(crate) fn lane_queue(&mut self, lane: UpdateLane) -> &mut VecDeque<VoxelUpdate> {
        match lane {
            UpdateLane::External => &mut self.updates,
            UpdateLane::Active => &mut self.active_updates,
        }
    }

    pub fn cancel_pending_updates_in_bounds(&mut self, min: &Vec3<i32>, max: &Vec3<i32>) -> usize {
        let is_inside = |voxel: &Vec3<i32>| {
            voxel.0 >= min.0
                && voxel.0 <= max.0
                && voxel.1 >= min.1
                && voxel.1 <= max.1
                && voxel.2 >= min.2
                && voxel.2 <= max.2
        };
        let previous_count = self.pending_updates_count();
        self.updates_staging.retain(|voxel, _| !is_inside(voxel));
        self.updates.retain(|(voxel, _)| !is_inside(voxel));
        self.active_updates_staging
            .retain(|voxel, _| !is_inside(voxel));
        self.active_updates.retain(|(voxel, _)| !is_inside(voxel));
        Self::retain_parked(&mut self.parked_updates, |(voxel, _, _)| {
            !is_inside(voxel)
        });
        previous_count - self.pending_updates_count()
    }

    pub fn pending_updates_in_bounds(
        &self,
        min: &Vec3<i32>,
        max: &Vec3<i32>,
    ) -> HashMap<Vec3<i32>, u32> {
        let is_inside = |voxel: &Vec3<i32>| {
            voxel.0 >= min.0
                && voxel.0 <= max.0
                && voxel.1 >= min.1
                && voxel.1 <= max.1
                && voxel.2 >= min.2
                && voxel.2 <= max.2
        };
        let mut pending = HashMap::new();
        // Simulation lane first so an external write to the same voxel is the
        // one reported, matching the precedence `flush_staged_updates` applies.
        // Parked writes precede their lane's queue for the same reason: a
        // later write to the voxel is what would have displaced them.
        for (voxel, value, lane) in self.parked_updates.values().flatten() {
            if *lane == UpdateLane::Active && is_inside(voxel) {
                pending.insert(voxel.clone(), *value);
            }
        }
        for (voxel, value) in &self.active_updates {
            if is_inside(voxel) {
                pending.insert(voxel.clone(), *value);
            }
        }
        for (voxel, value) in &self.active_updates_staging {
            if is_inside(voxel) {
                pending.insert(voxel.clone(), *value);
            }
        }
        for (voxel, value, lane) in self.parked_updates.values().flatten() {
            if *lane == UpdateLane::External && is_inside(voxel) {
                pending.insert(voxel.clone(), *value);
            }
        }
        for (voxel, value) in &self.updates {
            if is_inside(voxel) {
                pending.insert(voxel.clone(), *value);
            }
        }
        for (voxel, value) in &self.updates_staging {
            if is_inside(voxel) {
                pending.insert(voxel.clone(), *value);
            }
        }
        pending
    }

    /// Schedule `voxel` to become active at absolute tick `active_at`.
    ///
    /// Earliest-deadline upsert:
    /// - if the voxel is not queued, insert it
    /// - if already queued and `active_at` is **earlier** than the stored
    ///   deadline, reschedule to the earlier tick (stale later heap entries
    ///   are lazily discarded when popped -- see ChunkUpdatingSystem)
    /// - if already queued and `active_at` is later-or-equal, this is a no-op
    pub fn mark_voxel_active(&mut self, voxel: &Vec3<i32>, active_at: u64) {
        if let Some(&existing) = self.active_voxel_set.get(voxel) {
            if active_at >= existing {
                return;
            }
            // Earlier deadline wins. Leave the stale later heap entry; the
            // pop path only fires when the heap tick matches the set.
            self.active_voxel_set.insert(voxel.clone(), active_at);
            self.active_voxel_heap.push(Reverse(ActiveVoxel {
                tick: active_at,
                voxel: voxel.clone(),
            }));
            return;
        }
        self.active_voxel_set.insert(voxel.clone(), active_at);
        self.active_voxel_heap.push(Reverse(ActiveVoxel {
            tick: active_at,
            voxel: voxel.clone(),
        }));
    }

    /// Absolute tick currently scheduled for `voxel`, if any.
    pub fn active_voxel_deadline(&self, voxel: &Vec3<i32>) -> Option<u64> {
        self.active_voxel_set.get(voxel).copied()
    }

    /// Number of voxels currently scheduled to run their active updater.
    pub fn active_voxel_count(&self) -> usize {
        self.active_voxel_set.len()
    }

    /// Number of voxel updates staged or queued but not yet committed, on
    /// both the external and the simulation lane.
    pub fn pending_updates_count(&self) -> usize {
        self.updates.len()
            + self.updates_staging.len()
            + self.active_updates.len()
            + self.active_updates_staging.len()
            + self.parked_updates_count()
    }

    /// Simulation-lane share of `pending_updates_count`.
    pub fn pending_active_updates_count(&self) -> usize {
        self.active_updates.len()
            + self.active_updates_staging.len()
            + self
                .parked_updates
                .values()
                .flatten()
                .filter(|(_, _, lane)| *lane == UpdateLane::Active)
                .count()
    }

    /// Writes waiting in `parked_updates` for a chunk footprint to load.
    pub fn parked_updates_count(&self) -> usize {
        self.parked_updates.values().map(Vec::len).sum()
    }

    /// Where the head of each lane is waiting. The updating pass pops the
    /// first `budget` entries per tick and hands back any whose chunk (or
    /// light footprint) is not ready, so a queue whose depth never falls has
    /// a reason at its head; this names it, per chunk, for the operator.
    pub fn pending_update_head_report(&self, limit: usize) -> Vec<PendingUpdateHeadEntry> {
        let mut groups: HashMap<(UpdateLane, bool, Vec2<i32>), usize> = HashMap::new();
        for (lane, queue) in [
            (UpdateLane::External, &self.updates),
            (UpdateLane::Active, &self.active_updates),
        ] {
            for (voxel, _) in queue.iter().take(limit) {
                let coords =
                    ChunkUtils::map_voxel_to_chunk(voxel.0, voxel.1, voxel.2, self.config.chunk_size);
                *groups.entry((lane, false, coords)).or_insert(0) += 1;
            }
        }
        for (coords, updates) in &self.parked_updates {
            for (_, _, lane) in updates {
                *groups.entry((*lane, true, coords.clone())).or_insert(0) += 1;
            }
        }

        let mut report: Vec<PendingUpdateHeadEntry> = groups
            .into_iter()
            .map(|((lane, is_parked, coords), count)| {
                let status = match self.raw(&coords) {
                    None => "unloaded".to_owned(),
                    Some(chunk) => format!("{:?}", chunk.status),
                };
                let unready_neighbors = self
                    .light_traversed_chunks(&coords)
                    .into_iter()
                    .filter(|n| !self.is_chunk_ready(n))
                    .count();
                PendingUpdateHeadEntry {
                    lane,
                    is_parked,
                    coords,
                    count,
                    status,
                    unready_neighbors,
                }
            })
            .collect();
        report.sort_by(|a, b| b.count.cmp(&a.count));
        report
    }

    /// Add a chunk to be saved. A world that does not save discards the request
    /// here, so the queue cannot accumulate work nothing will ever drain.
    pub fn add_chunk_to_save(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if !self.config.saving {
            return;
        }

        if self.to_save.iter().any(|pending| &pending.coords == coords) {
            return;
        }

        let pending = PendingChunkSave {
            coords: coords.to_owned(),
            attempts: 0,
        };

        if prioritized {
            self.to_save.push_front(pending);
        } else {
            self.to_save.push_back(pending);
        }
    }

    /// Add a chunk to be sent. One pending entry per chunk, but the entry's
    /// message type is an upgrade lattice, not first-writer-wins: a `Load`
    /// (full snapshot) subsumes an `Update` (incremental levels), so a queued
    /// `Update` is upgraded in place when a `Load` arrives — dropping the
    /// `Load` instead would deliver a partial message to a client that was
    /// promised a whole chunk.
    pub fn add_chunk_to_send(
        &mut self,
        coords: &Vec2<i32>,
        r#type: &MessageType,
        prioritized: bool,
    ) {
        if let Some(entry) = self.to_send.iter_mut().find(|(c, _)| c == coords) {
            if entry.1 == MessageType::Update && *r#type == MessageType::Load {
                entry.1 = MessageType::Load;
            }
            return;
        }
        if prioritized {
            self.to_send.push_front((coords.to_owned(), r#type.clone()));
        } else {
            self.to_send.push_back((coords.to_owned(), r#type.clone()));
        }
    }

    /// Add a listener to a chunk.
    pub fn add_listener(&mut self, coords: &Vec2<i32>, listener: &Vec2<i32>) {
        let mut listeners = self.listeners.remove(coords).unwrap_or_default();
        listeners.push(listener.to_owned());
        self.listeners.insert(coords.to_owned(), listeners);
    }

    fn get_chunk_file_path(&self, chunk_name: &str) -> PathBuf {
        if self.folder.is_none() {
            return PathBuf::new();
        }

        let mut path = self.folder.clone().unwrap();
        path.push(format!("{}.json", chunk_name));
        path
    }

    fn add_updated_level_at(&mut self, vx: i32, vy: i32, vz: i32) {
        self.voxel_affected_chunks(vx, vy, vz)
            .into_iter()
            .for_each(|coords| {
                if let Some(neighbor) = self.raw_mut(&coords) {
                    neighbor.add_updated_level(vy);
                }
            });
    }
}

impl VoxelAccess for Chunks {
    fn waterlogging_rules(&self) -> Option<&WaterloggingRules> {
        self.waterlogging_rules.as_deref()
    }

    /// Get the raw voxel value at a voxel coordinate. If chunk not found, 0 is returned.
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if let Some(chunk) = self.raw_chunk_by_voxel(vx, vy, vz) {
            chunk.get_raw_voxel(vx, vy, vz)
        } else {
            0
        }
    }

    /// Set the raw voxel value at a voxel coordinate. Returns false couldn't set.
    fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) -> bool {
        if let Some(chunk) = self.raw_chunk_by_voxel_mut(vx, vy, vz) {
            chunk.set_raw_voxel(vx, vy, vz, id);
            self.add_updated_level_at(vx, vy, vz);

            return true;
        }

        false
    }

    /// Get the raw light value at a voxel coordinate. If chunk not found, 0 is returned.
    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if vy as usize >= self.config.max_height {
            return LightUtils::insert_sunlight(0, self.config.max_light_level);
        }

        if let Some(chunk) = self.raw_chunk_by_voxel(vx, vy, vz) {
            chunk.get_raw_light(vx, vy, vz)
        } else {
            0
        }
    }

    /// Set the raw light level at a voxel coordinate. Returns false couldn't set.
    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if let Some(chunk) = self.raw_chunk_by_voxel_mut(vx, vy, vz) {
            chunk.set_raw_light(vx, vy, vz, level);
            self.add_updated_level_at(vx, vy, vz);

            return true;
        }

        false
    }

    /// Get the sunlight level at a voxel position. Returns 0 if chunk does not exist.
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        if vy >= self.config.max_height as i32 {
            return self.config.max_light_level;
        }

        if let Some(chunk) = self.raw_chunk_by_voxel(vx, vy, vz) {
            chunk.get_sunlight(vx, vy, vz)
        } else {
            return if vy < 0 {
                0
            } else {
                self.config.max_light_level
            };
        }
    }

    /// Get the max height at a voxel column. Returns 0 if column does not exist.
    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        if let Some(chunk) = self.raw_chunk_by_voxel(vx, 0, vz) {
            chunk.get_max_height(vx, vz)
        } else {
            0
        }
    }

    /// Set the max height at a voxel column. Does nothing if column does not exist.
    fn set_max_height(&mut self, vx: i32, vz: i32, height: u32) -> bool {
        if let Some(chunk) = self.raw_chunk_by_voxel_mut(vx, 0, vz) {
            chunk.set_max_height(vx, vz, height);
            return true;
        }

        false
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.raw_chunk_by_voxel(vx, vy, vz).is_some()
    }
}

#[cfg(test)]
mod pending_save_queue_tests {
    use super::*;

    fn saving_chunks(label: &str) -> Chunks {
        let dir = std::env::temp_dir().join(format!(
            "voxelize-save-queue-{}-{}-{:?}",
            label,
            std::process::id(),
            std::thread::current().id()
        ));

        Chunks::new(
            &WorldConfig::new()
                .saving(true)
                .save_dir(dir.to_str().expect("utf-8 temp path"))
                .build(),
        )
    }

    fn put_chunk(chunks: &mut Chunks, coords: &Vec2<i32>, status: ChunkStatus) {
        let mut chunk = Chunk::new(
            "pending-save-test",
            coords.0,
            coords.1,
            &ChunkOptions {
                max_height: chunks.config.max_height,
                sub_chunks: chunks.config.sub_chunks,
                size: chunks.config.chunk_size,
            },
        );
        chunk.status = status;
        chunks.renew(chunk, ChunkRenewal::Full);
    }

    #[test]
    fn a_queued_update_send_upgrades_to_load_instead_of_shadowing_it() {
        let mut chunks = saving_chunks("send-dedupe");
        let coords = Vec2(1, 2);

        chunks.add_chunk_to_send(&coords, &MessageType::Update, false);
        chunks.add_chunk_to_send(&coords, &MessageType::Load, false);

        assert_eq!(chunks.to_send.len(), 1, "one pending entry per chunk");
        assert_eq!(
            chunks.to_send[0].1,
            MessageType::Load,
            "a Load send must not be swallowed by a queued Update: the \
             client was promised a whole chunk and would get partial levels"
        );

        // The reverse never downgrades.
        let other = Vec2(3, 4);
        chunks.add_chunk_to_send(&other, &MessageType::Load, false);
        chunks.add_chunk_to_send(&other, &MessageType::Update, false);
        assert_eq!(chunks.to_send[1].1, MessageType::Load);
    }

    #[test]
    fn a_save_queued_before_the_chunk_is_ready_is_kept_and_retried() {
        let mut chunks = saving_chunks("retry");
        let coords = Vec2(3, 7);
        let max_retries = 4;

        put_chunk(&mut chunks, &coords, ChunkStatus::Meshing);
        chunks.add_chunk_to_save(&coords, false);

        assert!(chunks.take_pending_saves(8, max_retries).is_empty());
        assert_eq!(
            chunks.to_save.len(),
            1,
            "a chunk that is not readable yet must stay queued, not be discarded"
        );

        put_chunk(&mut chunks, &coords, ChunkStatus::Ready);

        let prepared = chunks.take_pending_saves(8, max_retries);
        assert_eq!(prepared.len(), 1);
        assert_eq!(prepared[0].coords, coords);
        assert!(chunks.to_save.is_empty());
    }

    #[test]
    fn a_save_leaves_the_queue_only_once_the_retry_budget_is_spent() {
        let mut chunks = saving_chunks("budget");
        let coords = Vec2(-2, 5);
        let max_retries = 3;

        put_chunk(&mut chunks, &coords, ChunkStatus::Generating(0));
        chunks.add_chunk_to_save(&coords, false);

        for tick in 1..max_retries {
            assert!(chunks.take_pending_saves(8, max_retries).is_empty());
            assert_eq!(
                chunks.to_save.len(),
                1,
                "the entry must survive tick {tick} of {max_retries}"
            );
        }

        assert!(chunks.take_pending_saves(8, max_retries).is_empty());
        assert!(
            chunks.to_save.is_empty(),
            "the entry is dropped once the budget is spent, and only then"
        );
    }

    #[test]
    fn an_unreadable_chunk_does_not_hold_up_the_chunks_behind_it() {
        let mut chunks = saving_chunks("head-of-line");
        let stuck = Vec2(0, 0);
        let ready = Vec2(1, 0);

        put_chunk(&mut chunks, &stuck, ChunkStatus::Meshing);
        put_chunk(&mut chunks, &ready, ChunkStatus::Ready);
        chunks.add_chunk_to_save(&stuck, false);
        chunks.add_chunk_to_save(&ready, false);

        let prepared = chunks.take_pending_saves(8, 8);

        assert_eq!(prepared.len(), 1);
        assert_eq!(prepared[0].coords, ready);
        assert_eq!(
            chunks.to_save.len(),
            1,
            "the unreadable chunk is still waiting its turn"
        );
    }

    #[test]
    fn no_more_than_the_per_tick_cap_is_prepared() {
        let mut chunks = saving_chunks("cap");

        for x in 0..5 {
            let coords = Vec2(x, 0);
            put_chunk(&mut chunks, &coords, ChunkStatus::Ready);
            chunks.add_chunk_to_save(&coords, false);
        }

        assert_eq!(chunks.take_pending_saves(2, 8).len(), 2);
        assert_eq!(chunks.to_save.len(), 3);
    }

    #[test]
    fn a_world_that_does_not_save_never_queues_chunks() {
        let mut chunks = Chunks::new(&WorldConfig::new().build());
        let coords = Vec2(4, 4);

        put_chunk(&mut chunks, &coords, ChunkStatus::Ready);
        chunks.add_chunk_to_save(&coords, true);

        assert!(
            chunks.to_save.is_empty(),
            "a queue nothing drains must never be filled"
        );
    }
}

#[cfg(test)]
mod pending_update_projection_tests {
    use super::*;
    use crate::WorldConfig;

    fn empty_chunks() -> Chunks {
        Chunks::new(&WorldConfig::new().build())
    }

    #[test]
    fn cancel_pending_updates_in_bounds_removes_queued_and_staged_work() {
        let mut chunks = empty_chunks();
        chunks.update_voxel(&Vec3(1, 1, 1), 2);
        chunks.update_voxel(&Vec3(10, 1, 1), 2);
        chunks.flush_staged_updates();
        chunks.update_voxel(&Vec3(2, 2, 2), 3);
        chunks.update_voxel(&Vec3(11, 2, 2), 3);

        let removed = chunks.cancel_pending_updates_in_bounds(&Vec3(0, 0, 0), &Vec3(5, 5, 5));

        assert_eq!(removed, 2);
        assert_eq!(chunks.pending_updates_count(), 2);
        assert_eq!(chunks.updates.front(), Some(&(Vec3(10, 1, 1), 2)));
        assert_eq!(chunks.updates_staging.get(&Vec3(11, 2, 2)), Some(&3));
    }

    #[test]
    fn pending_updates_in_bounds_reports_the_latest_projected_values() {
        let mut chunks = empty_chunks();
        chunks.update_voxel(&Vec3(1, 1, 1), 2);
        chunks.update_voxel(&Vec3(10, 1, 1), 2);
        chunks.flush_staged_updates();
        chunks.update_voxel(&Vec3(1, 1, 1), 0);
        chunks.update_voxel(&Vec3(2, 2, 2), 3);

        let pending = chunks.pending_updates_in_bounds(&Vec3(0, 0, 0), &Vec3(5, 5, 5));

        assert_eq!(pending.len(), 2);
        assert_eq!(pending.get(&Vec3(1, 1, 1)), Some(&0));
        assert_eq!(pending.get(&Vec3(2, 2, 2)), Some(&3));
    }
}

#[cfg(test)]
mod update_lane_tests {
    use super::*;
    use crate::WorldConfig;

    fn empty_chunks() -> Chunks {
        Chunks::new(&WorldConfig::new().build())
    }

    #[test]
    fn simulation_writes_flush_onto_their_own_lane() {
        let mut chunks = empty_chunks();
        chunks.update_voxel(&Vec3(1, 1, 1), 2);
        chunks.update_active_voxel(&Vec3(5, 1, 1), 7);
        chunks.update_active_voxel(&Vec3(5, 0, 1), 7);
        chunks.flush_staged_updates();

        assert_eq!(chunks.updates.len(), 1);
        assert_eq!(chunks.active_updates.len(), 2);
        // Bottom-up like the external lane, so a cut batch never commits a
        // dependent half before its support.
        assert_eq!(chunks.active_updates.front(), Some(&(Vec3(5, 0, 1), 7)));
        assert_eq!(chunks.pending_updates_count(), 3);
        assert_eq!(chunks.pending_active_updates_count(), 2);
    }

    #[test]
    fn an_external_write_supersedes_queued_simulation_writes_to_the_same_voxel() {
        let mut chunks = empty_chunks();
        chunks.update_active_voxel(&Vec3(1, 1, 1), 7);
        chunks.flush_staged_updates();
        chunks.update_active_voxel(&Vec3(2, 1, 1), 7);
        chunks.update_voxel(&Vec3(1, 1, 1), 3);
        chunks.update_voxel(&Vec3(2, 1, 1), 3);
        chunks.flush_staged_updates();

        assert!(chunks.active_updates.is_empty());
        assert_eq!(chunks.updates.len(), 2);
        let pending = chunks.pending_updates_in_bounds(&Vec3(0, 0, 0), &Vec3(5, 5, 5));
        assert_eq!(pending.get(&Vec3(1, 1, 1)), Some(&3));
        assert_eq!(pending.get(&Vec3(2, 1, 1)), Some(&3));
    }

    #[test]
    fn a_newer_simulation_write_replaces_its_own_queued_predecessor_only() {
        let mut chunks = empty_chunks();
        chunks.update_voxel(&Vec3(1, 1, 1), 3);
        chunks.update_active_voxel(&Vec3(1, 1, 1), 7);
        chunks.flush_staged_updates();
        chunks.update_active_voxel(&Vec3(1, 1, 1), 8);
        chunks.flush_staged_updates();

        assert_eq!(chunks.updates.front(), Some(&(Vec3(1, 1, 1), 3)));
        assert_eq!(chunks.active_updates.len(), 1);
        assert_eq!(chunks.active_updates.front(), Some(&(Vec3(1, 1, 1), 8)));
        // The external word is the one reported: it commits last.
        let pending = chunks.pending_updates_in_bounds(&Vec3(0, 0, 0), &Vec3(5, 5, 5));
        assert_eq!(pending.get(&Vec3(1, 1, 1)), Some(&3));
    }

    #[test]
    fn cancelling_a_region_clears_both_lanes() {
        let mut chunks = empty_chunks();
        chunks.update_active_voxel(&Vec3(1, 1, 1), 7);
        chunks.update_active_voxel(&Vec3(10, 1, 1), 7);
        chunks.flush_staged_updates();
        chunks.update_active_voxel(&Vec3(2, 2, 2), 7);
        chunks.update_voxel(&Vec3(3, 3, 3), 3);

        let removed = chunks.cancel_pending_updates_in_bounds(&Vec3(0, 0, 0), &Vec3(5, 5, 5));

        assert_eq!(removed, 3);
        assert_eq!(chunks.pending_updates_count(), 1);
        assert_eq!(chunks.active_updates.front(), Some(&(Vec3(10, 1, 1), 7)));
    }

    fn insert_ready_chunk(chunks: &mut Chunks, cx: i32, cz: i32) {
        let config = chunks.config.clone();
        let mut chunk = crate::Chunk::new(
            "test",
            cx,
            cz,
            &crate::ChunkOptions {
                size: config.chunk_size,
                max_height: config.max_height,
                sub_chunks: config.sub_chunks,
            },
        );
        chunk.status = ChunkStatus::Ready;
        chunks.map.insert(Vec2(cx, cz), chunk);
    }

    #[test]
    fn parked_writes_stay_counted_and_return_in_order_once_the_footprint_is_ready() {
        let mut chunks = empty_chunks();
        let parked = vec![
            (Vec3(1, 0, 1), 2, UpdateLane::External),
            (Vec3(1, 1, 1), 3, UpdateLane::External),
            (Vec3(2, 0, 1), 7, UpdateLane::Active),
        ];
        chunks.park_updates(Vec2(0, 0), parked);
        chunks.update_voxel(&Vec3(40, 1, 1), 5);
        chunks.flush_staged_updates();

        // Nothing in the lanes for chunk (0,0), so its writes cannot occupy
        // a tick's budget; they are still pending and still visible.
        assert_eq!(chunks.updates.len(), 1);
        assert_eq!(chunks.pending_updates_count(), 4);
        assert_eq!(chunks.pending_active_updates_count(), 1);
        assert_eq!(chunks.parked_updates_count(), 3);
        assert_eq!(chunks.readmit_parked_updates(), 0);
        let report = chunks.pending_update_head_report(100);
        let parked_entry = report
            .iter()
            .find(|entry| entry.is_parked && entry.lane == UpdateLane::External)
            .expect("parked external writes are reported");
        assert_eq!(parked_entry.count, 2);
        assert_eq!(parked_entry.status, "unloaded");

        // A newer external write to a parked voxel supersedes it, on either
        // lane, exactly as it would a queued one.
        chunks.update_voxel(&Vec3(2, 0, 1), 9);
        chunks.flush_staged_updates();
        assert_eq!(chunks.parked_updates_count(), 2);

        let extended = (chunks.config.max_light_level as f32 / chunks.config.chunk_size as f32)
            .ceil() as i32;
        for cx in -extended..=extended {
            for cz in -extended..=extended {
                insert_ready_chunk(&mut chunks, cx, cz);
            }
        }
        assert!(chunks.is_update_footprint_ready(&Vec2(0, 0)));
        assert_eq!(chunks.readmit_parked_updates(), 2);
        assert_eq!(chunks.parked_updates_count(), 0);
        // Ahead of the write that was already queued, in their original order.
        let queued: Vec<_> = chunks.updates.iter().cloned().collect();
        assert_eq!(
            queued,
            vec![(Vec3(1, 0, 1), 2), (Vec3(1, 1, 1), 3), (Vec3(40, 1, 1), 5), (Vec3(2, 0, 1), 9)]
        );
    }

    #[test]
    fn cancelling_a_region_clears_parked_writes_too() {
        let mut chunks = empty_chunks();
        chunks.park_updates(
            Vec2(0, 0),
            vec![
                (Vec3(1, 1, 1), 2, UpdateLane::External),
                (Vec3(9, 1, 1), 2, UpdateLane::External),
            ],
        );

        let removed = chunks.cancel_pending_updates_in_bounds(&Vec3(0, 0, 0), &Vec3(5, 5, 5));

        assert_eq!(removed, 1);
        assert_eq!(chunks.parked_updates_count(), 1);
        let pending = chunks.pending_updates_in_bounds(&Vec3(0, 0, 0), &Vec3(20, 5, 5));
        assert_eq!(pending.get(&Vec3(9, 1, 1)), Some(&2));
        assert_eq!(pending.get(&Vec3(1, 1, 1)), None);
    }
}

#[cfg(test)]
mod active_voxel_upsert_tests {
    use super::*;
    use crate::WorldConfig;

    fn empty_chunks() -> Chunks {
        Chunks::new(&WorldConfig::new().build())
    }

    #[test]
    fn mark_voxel_active_earlier_deadline_wins() {
        let mut chunks = empty_chunks();
        let voxel = Vec3(1, 2, 3);
        chunks.mark_voxel_active(&voxel, 100);
        assert_eq!(chunks.active_voxel_deadline(&voxel), Some(100));

        chunks.mark_voxel_active(&voxel, 10);
        assert_eq!(chunks.active_voxel_deadline(&voxel), Some(10));

        // Later-or-equal is a no-op.
        chunks.mark_voxel_active(&voxel, 10);
        assert_eq!(chunks.active_voxel_deadline(&voxel), Some(10));
        chunks.mark_voxel_active(&voxel, 50);
        assert_eq!(chunks.active_voxel_deadline(&voxel), Some(10));
    }

    #[test]
    fn mark_voxel_active_lazy_discards_stale_later_heap_entry() {
        let mut chunks = empty_chunks();
        let voxel = Vec3(4, 5, 6);
        chunks.mark_voxel_active(&voxel, 100);
        chunks.mark_voxel_active(&voxel, 10);

        // Simulate the ChunkUpdatingSystem pop loop at tick 10.
        let current_tick = 10u64;
        let mut due = Vec::new();
        while let Some(Reverse(active)) = chunks.active_voxel_heap.peek() {
            if active.tick > current_tick {
                break;
            }
            let Reverse(active) = chunks.active_voxel_heap.pop().unwrap();
            match chunks.active_voxel_set.get(&active.voxel).copied() {
                Some(scheduled) if scheduled == active.tick => {
                    chunks.active_voxel_set.remove(&active.voxel);
                    due.push(active.voxel);
                }
                _ => {}
            }
        }
        assert_eq!(due, vec![voxel.clone()]);
        assert!(chunks.active_voxel_deadline(&voxel).is_none());

        // Stale T+100 entry must not fire later.
        let current_tick = 100u64;
        let mut due2 = Vec::new();
        while let Some(Reverse(active)) = chunks.active_voxel_heap.peek() {
            if active.tick > current_tick {
                break;
            }
            let Reverse(active) = chunks.active_voxel_heap.pop().unwrap();
            match chunks.active_voxel_set.get(&active.voxel).copied() {
                Some(scheduled) if scheduled == active.tick => {
                    chunks.active_voxel_set.remove(&active.voxel);
                    due2.push(active.voxel);
                }
                _ => {}
            }
        }
        assert!(due2.is_empty());
    }
}
