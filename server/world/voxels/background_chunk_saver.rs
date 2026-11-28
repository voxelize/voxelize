use byteorder::{ByteOrder, LittleEndian};
use crossbeam_channel::{unbounded, Receiver, Sender};
use hashbrown::HashMap;
use libflate::zlib::Encoder;
use log::warn;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use crate::world::save_worker::{SaveWorker, SAVE_STALL_LIMIT};
use crate::Vec2;

/// Saves queued within this long of each other are written as one batch.
const COALESCE_WINDOW: Duration = Duration::from_millis(50);

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
    /// Keeps only the newest save per chunk (see [`SaveWorker`]); `None` for
    /// a world that does not save chunks.
    worker: Option<SaveWorker<Vec2<i32>, ChunkSaveData>>,
    /// One outcome per save that reached disk or failed to. A save replaced by
    /// a newer one for the same chunk before its flush reports nothing; the
    /// newer one's outcome covers it.
    outcomes: Receiver<ChunkSaveOutcome>,
}

impl BackgroundChunkSaver {
    pub fn new(folder: Option<PathBuf>) -> Self {
        let (outcome_sender, outcomes) = unbounded::<ChunkSaveOutcome>();

        let worker = folder.map(|folder| {
            SaveWorker::new(
                format!("chunk saves for {}", folder.display()),
                COALESCE_WINDOW,
                SAVE_STALL_LIMIT,
                move |batch| Self::write_batch(batch, &folder, &outcome_sender),
            )
        });

        Self { worker, outcomes }
    }

    fn write_batch(
        batch: HashMap<Vec2<i32>, ChunkSaveData>,
        folder: &PathBuf,
        outcomes: &Sender<ChunkSaveOutcome>,
    ) {
        for (_, data) in batch {
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

    /// Hand a save to the background thread. Returns whether it was taken:
    /// only a world that does not save chunks refuses.
    pub fn queue_save(&self, data: ChunkSaveData) -> bool {
        let Some(worker) = &self.worker else {
            return false;
        };
        worker.submit(data.coords.clone(), |_| data);
        true
    }

    /// Return once every save queued so far is on disk (or has failed and
    /// reported so in [`Self::take_outcomes`]).
    pub fn flush(&self) {
        if let Some(worker) = &self.worker {
            worker.flush();
        }
    }

    /// Outcomes of the saves the background thread finished since last asked.
    pub fn take_outcomes(&self) -> Vec<ChunkSaveOutcome> {
        self.outcomes.try_iter().collect()
    }
}
