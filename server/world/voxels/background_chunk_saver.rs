use byteorder::{ByteOrder, LittleEndian};
use crossbeam_channel::{bounded, unbounded, Receiver, Sender, TryRecvError};
use hashbrown::HashMap;
use libflate::zlib::Encoder;
use log::warn;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::Vec2;

/// Bumped whenever a chunk file needs a one-time migration on load.
///
/// - `0`: files written before per-voxel waterlogging existed.
/// - `1`: waterlogged bit is authoritative in the voxel word.
pub const CHUNK_FILE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkFileData {
    id: String,
    voxels: String,
    height_map: String,
    #[serde(default)]
    version: u32,
}

pub struct ChunkSaveData {
    pub coords: Vec2<i32>,
    pub chunk_name: String,
    pub chunk_id: String,
    pub voxels: Vec<u32>,
    pub height_map: Vec<u32>,
    /// The chunk's `write_epoch` when these bytes were taken: what landing
    /// them on disk proves persisted.
    pub epoch: u64,
}

/// What became of a save handed to the background thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkSaveOutcome {
    pub coords: Vec2<i32>,
    pub epoch: u64,
    pub is_written: bool,
}

pub struct BackgroundChunkSaver {
    sender: Sender<ChunkSaveData>,
    /// One outcome per save that reached disk or failed to. A save replaced by
    /// a newer one for the same chunk before its flush reports nothing; the
    /// newer one's outcome covers it.
    outcomes: Receiver<ChunkSaveOutcome>,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl BackgroundChunkSaver {
    pub fn new(folder: Option<PathBuf>) -> Self {
        let (sender, receiver) = bounded::<ChunkSaveData>(5000);
        let (outcome_sender, outcomes) = unbounded::<ChunkSaveOutcome>();
        let shutdown = Arc::new(AtomicBool::new(false));

        let handle = if let Some(folder) = folder {
            let shutdown_clone = shutdown.clone();
            Some(thread::spawn(move || {
                Self::background_save_loop(receiver, outcome_sender, folder, shutdown_clone);
            }))
        } else {
            None
        };

        Self {
            sender,
            outcomes,
            shutdown,
            handle,
        }
    }

    fn background_save_loop(
        receiver: Receiver<ChunkSaveData>,
        outcomes: Sender<ChunkSaveOutcome>,
        folder: PathBuf,
        shutdown: Arc<AtomicBool>,
    ) {
        let flush_interval = Duration::from_millis(50);
        let mut last_flush = Instant::now();
        let mut pending: HashMap<Vec2<i32>, ChunkSaveData> = HashMap::new();

        loop {
            match receiver.try_recv() {
                Ok(data) => {
                    pending.insert(data.coords.clone(), data);
                }
                Err(TryRecvError::Empty) => {
                    if shutdown.load(Ordering::Relaxed) && pending.is_empty() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(5));
                }
                Err(TryRecvError::Disconnected) => {
                    Self::flush_pending(&mut pending, &folder, &outcomes);
                    break;
                }
            }

            if last_flush.elapsed() >= flush_interval && !pending.is_empty() {
                Self::flush_pending(&mut pending, &folder, &outcomes);
                last_flush = Instant::now();
            }
        }
    }

    fn flush_pending(
        pending: &mut HashMap<Vec2<i32>, ChunkSaveData>,
        folder: &PathBuf,
        outcomes: &Sender<ChunkSaveOutcome>,
    ) {
        for (_, data) in pending.drain() {
            let is_written = Self::save_chunk_to_disk(&data, folder);
            // Nobody listening (the world is going away) is not an error.
            let _ = outcomes.send(ChunkSaveOutcome {
                coords: data.coords,
                epoch: data.epoch,
                is_written,
            });
        }
    }

    fn to_base_64(data: &[u32]) -> String {
        let mut bytes = vec![0; data.len() * 4];
        LittleEndian::write_u32_into(data, &mut bytes);

        let mut encoder = Encoder::new(vec![]).unwrap();
        encoder.write_all(bytes.as_slice()).unwrap();
        let encoded = encoder.finish().into_result().unwrap();
        base64::encode(&encoded)
    }

    fn save_chunk_to_disk(data: &ChunkSaveData, folder: &PathBuf) -> bool {
        if let Err(e) = fs::create_dir_all(folder) {
            warn!(
                "Failed to create chunks directory {}: {}",
                folder.display(),
                e
            );
            return false;
        }

        let file_data = ChunkFileData {
            id: data.chunk_id.clone(),
            voxels: Self::to_base_64(&data.voxels),
            height_map: Self::to_base_64(&data.height_map),
            version: CHUNK_FILE_VERSION,
        };

        let json_data = match serde_json::to_string(&file_data) {
            Ok(j) => j,
            Err(e) => {
                warn!("Failed to serialize chunk data: {}", e);
                return false;
            }
        };

        let mut path = folder.clone();
        path.push(format!("{}.json", data.chunk_name));
        let tmp_path = path.with_extension("json.tmp");

        let mut file = match File::create(&tmp_path) {
            Ok(f) => f,
            Err(e) => {
                warn!(
                    "Failed to create chunk temp file {}: {}",
                    tmp_path.display(),
                    e
                );
                return false;
            }
        };

        if file.write_all(json_data.as_bytes()).is_err() {
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

    /// Hand a save to the background thread. Returns whether it was taken: a
    /// full queue refuses it, and the chunk stays unsaved until queued again.
    pub fn queue_save(&self, data: ChunkSaveData) -> bool {
        if let Err(e) = self.sender.try_send(data) {
            warn!("Failed to queue chunk save: {}", e);
            return false;
        }
        true
    }

    /// Outcomes of the saves the background thread finished since last asked.
    pub fn take_outcomes(&self) -> Vec<ChunkSaveOutcome> {
        self.outcomes.try_iter().collect()
    }
}

impl Drop for BackgroundChunkSaver {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        drop(self.sender.clone());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
