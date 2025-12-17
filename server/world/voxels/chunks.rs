use base64::{engine::general_purpose::STANDARD, Engine};
use byteorder::{ByteOrder, LittleEndian};
use hashbrown::{HashMap, HashSet};
use libflate::zlib::{Decoder, Encoder};
use log::info;
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
    ChunkOptions, ChunkStatus, ChunkUtils, LightUtils, MessageType, Registry, Vec2, Vec3,
    VoxelUpdate, WorldConfig,
};

use super::{
    access::VoxelAccess,
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

/// Prototype for chunk's internal data used to send to client
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkFileData {
    id: String,
    voxels: String,
    height_map: String,
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
    pub(crate) to_save: VecDeque<Vec2<i32>>,

    pub(crate) active_voxel_heap: BinaryHeap<Reverse<ActiveVoxel>>,
    pub(crate) active_voxel_set: HashMap<Vec3<i32>, u64>,

    /// A listener for when a chunk is done generating or meshing.
    pub(crate) listeners: HashMap<Vec2<i32>, Vec<Vec2<i32>>>,

    /// A cache of what chunks has been borrowed mutable.
    pub(crate) cache: HashSet<Vec2<i32>>,

    pub block_entities: HashMap<Vec3<i32>, Entity>,

    /// A copy of the world's config.
    config: WorldConfig,

    /// The folder to store the chunks.
    folder: Option<PathBuf>,
}

impl Chunks {
    /// Create a new instance of a chunk manager.
    pub fn new(config: &WorldConfig) -> Self {
        let folder = if config.saving {
            let mut folder = PathBuf::from(&config.save_dir);
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

    pub fn test_load(&self, coords: &Vec2<i32>) -> bool {
        let path = self.get_chunk_file_path(&ChunkUtils::get_chunk_name(coords.0, coords.1));
        File::open(&path).is_ok()
    }

    // Try to load the data of a chunk, returns whether successful or not.
    pub fn try_load(&self, coords: &Vec2<i32>, registry: &Registry) -> Option<Chunk> {
        if !self.config.saving {
            return None;
        }

        let path = self.get_chunk_file_path(&ChunkUtils::get_chunk_name(coords.0, coords.1));
        let file = File::open(&path).ok()?;
        let chunk_data = BufReader::new(file);

        let data: ChunkFileData = serde_json::from_reader(chunk_data).ok()?;

        let decode_base64 = |base: &str| -> Vec<u32> {
            if base.is_empty() {
                return vec![];
            }

            let decoded = STANDARD.decode(base).expect("Failed to decode base64");
            let mut decoder = Decoder::new(&decoded[..]).expect("Failed to create decoder");
            let mut buf = Vec::new();
            decoder
                .read_to_end(&mut buf)
                .expect("Failed to decode data");
            let mut data = vec![0; buf.len() / 4];
            LittleEndian::read_u32_into(&buf, &mut data);
            data
        };

        let (voxels, height_map) = rayon::join(
            || decode_base64(&data.voxels),
            || decode_base64(&data.height_map),
        );

        let mut chunk = Chunk::new(
            &data.id,
            coords.0,
            coords.1,
            &ChunkOptions {
                max_height: self.config.max_height,
                sub_chunks: self.config.sub_chunks,
                size: self.config.chunk_size,
            },
        );

        Arc::make_mut(&mut chunk.voxels).data = voxels;

        if height_map.len() > 0 {
            Arc::make_mut(&mut chunk.height_map).data = height_map;
        } else {
            chunk.calculate_max_height(registry);
        }

        chunk.status = ChunkStatus::Meshing;

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

    /// Update a chunk, removing the old chunk instance and updating with a new one.
    pub fn renew(&mut self, chunk: Chunk, renew_mesh_only: bool) {
        if renew_mesh_only {
            if let Some(mut old_chunk) = self.map.remove(&chunk.coords) {
                old_chunk.meshes = chunk.meshes;
                old_chunk.status = chunk.status;
                self.map.insert(chunk.coords.to_owned(), old_chunk);
            }

            return;
        }

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

    /// Update a voxel in the chunk map. This includes recalculating the light and height maps
    /// and sending the chunk to the interested clients. This process is not instant, and will
    /// be done in the background.
    pub fn update_voxel(&mut self, voxel: &Vec3<i32>, val: u32) {
        self.updates_staging.insert(voxel.to_owned(), val);
    }

    /// Flush staged updates into the processing queue. Called before processing updates.
    pub fn flush_staged_updates(&mut self) {
        if self.updates_staging.is_empty() {
            return;
        }

        self.updates
            .retain(|(v, _)| !self.updates_staging.contains_key(v));

        for (voxel, val) in self.updates_staging.drain() {
            self.updates.push_back((voxel, val));
        }
    }

    pub fn update_voxels(&mut self, voxels: &[(Vec3<i32>, u32)]) {
        for (voxel, val) in voxels {
            self.update_voxel(voxel, *val);
        }
    }

    pub fn mark_voxel_active(&mut self, voxel: &Vec3<i32>, active_at: u64) {
        if self.active_voxel_set.contains_key(voxel) {
            return;
        }
        self.active_voxel_set.insert(voxel.clone(), active_at);
        self.active_voxel_heap.push(Reverse(ActiveVoxel {
            tick: active_at,
            voxel: voxel.clone(),
        }));
    }

    /// Add a chunk to be saved.
    pub fn add_chunk_to_save(&mut self, coords: &Vec2<i32>, prioritized: bool) {
        if !self.to_save.contains(coords) {
            if prioritized {
                self.to_save.push_front(coords.to_owned());
            } else {
                self.to_save.push_back(coords.to_owned());
            }
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
