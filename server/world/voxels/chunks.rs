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
    chunk::Chunk,
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

/// A manager for all chunks in the Voxelize world.
#[derive(Default)]
pub struct Chunks {
    /// A map of all the chunks, coords -> Chunk.
    pub map: HashMap<Vec2<i32>, Chunk>,

    /// Voxel updates waiting to be processed.
    pub(crate) updates: VecDeque<VoxelUpdate>,

    /// Staging area for new voxel updates (deduplicates before flushing to queue).
    pub(crate) updates_staging: HashMap<Vec3<i32>, u32>,

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

    /// Update a chunk, removing the old chunk instance and updating with a new one.
    pub fn renew(&mut self, mut chunk: Chunk, renew_mesh_only: bool) {
        if renew_mesh_only {
            if let Some(mut old_chunk) = self.map.remove(&chunk.coords) {
                old_chunk.meshes = chunk.meshes;
                old_chunk.status = chunk.status;
                self.map.insert(chunk.coords.to_owned(), old_chunk);
            }

            return;
        }

        chunk.waterlogging_rules = self.waterlogging_rules.clone();
        self.map.remove(&chunk.coords);
        self.map.insert(chunk.coords.to_owned(), chunk);
    }

    /// Add a new chunk, synonym for `chunks.renew`
    pub fn add(&mut self, chunk: Chunk) {
        self.renew(chunk, false);
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
        if self.updates_staging.is_empty() {
            return;
        }

        self.updates
            .retain(|(v, _)| !self.updates_staging.contains_key(v));

        let mut staged: Vec<(Vec3<i32>, u32)> = self.updates_staging.drain().collect();
        staged.sort_by_key(|(voxel, _)| (voxel.1, voxel.0, voxel.2));

        for (voxel, val) in staged {
            self.updates.push_back((voxel, val));
        }
    }

    pub fn update_voxels(&mut self, voxels: &[(Vec3<i32>, u32)]) {
        for (voxel, val) in voxels {
            self.update_voxel(voxel, *val);
        }
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

    /// Number of voxel updates staged or queued but not yet committed.
    pub fn pending_updates_count(&self) -> usize {
        self.updates.len() + self.updates_staging.len()
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

    /// Add a chunk to be sent.
    pub fn add_chunk_to_send(
        &mut self,
        coords: &Vec2<i32>,
        r#type: &MessageType,
        prioritized: bool,
    ) {
        if self.to_send.iter().any(|(c, _)| c == coords) {
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
        chunks.renew(chunk, false);
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
