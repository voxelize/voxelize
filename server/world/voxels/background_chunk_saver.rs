use base64::{engine::general_purpose::STANDARD, Engine};
use crossbeam_channel::{bounded, Receiver, Sender, TryRecvError};
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

#[cfg(not(target_endian = "little"))]
use byteorder::{ByteOrder, LittleEndian};

use crate::Vec2;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChunkFileData {
    id: String,
    voxels: String,
    height_map: String,
}

pub struct ChunkSaveData {
    pub coords: Vec2<i32>,
    pub chunk_name: String,
    pub chunk_id: String,
    pub voxels: Vec<u32>,
    pub height_map: Vec<u32>,
}

pub struct BackgroundChunkSaver {
    sender: Sender<ChunkSaveData>,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl BackgroundChunkSaver {
    pub fn new(folder: Option<PathBuf>) -> Self {
        let (sender, receiver) = bounded::<ChunkSaveData>(5000);
        let shutdown = Arc::new(AtomicBool::new(false));

        let handle = if let Some(folder) = folder {
            let shutdown_clone = shutdown.clone();
            Some(thread::spawn(move || {
                Self::background_save_loop(receiver, folder, shutdown_clone);
            }))
        } else {
            None
        };

        Self {
            sender,
            shutdown,
            handle,
        }
    }

    fn background_save_loop(
        receiver: Receiver<ChunkSaveData>,
        folder: PathBuf,
        shutdown: Arc<AtomicBool>,
    ) {
        let flush_interval = Duration::from_millis(50);
        let mut last_flush = Instant::now();
        let mut pending: HashMap<Vec2<i32>, ChunkSaveData> = HashMap::with_capacity(64);

        loop {
            match receiver.try_recv() {
                Ok(data) => {
                    pending.insert(data.coords, data);
                }
                Err(TryRecvError::Empty) => {
                    if shutdown.load(Ordering::Relaxed) {
                        if pending.is_empty() {
                            break;
                        }
                        Self::flush_pending(&mut pending, &folder);
                        break;
                    }
                    thread::sleep(Duration::from_millis(5));
                }
                Err(TryRecvError::Disconnected) => {
                    Self::flush_pending(&mut pending, &folder);
                    break;
                }
            }

            if last_flush.elapsed() >= flush_interval && !pending.is_empty() {
                Self::flush_pending(&mut pending, &folder);
                last_flush = Instant::now();
            }
        }
    }

    fn flush_pending(pending: &mut HashMap<Vec2<i32>, ChunkSaveData>, folder: &PathBuf) {
        for (_, data) in pending.drain() {
            Self::save_chunk_to_disk(data, folder);
        }
    }

    fn to_base_64(data: &[u32]) -> Option<String> {
        if data.is_empty() {
            return Some(String::new());
        }
        let byte_len = data.len().saturating_mul(std::mem::size_of::<u32>());

        #[cfg(target_endian = "little")]
        {
            let bytes = unsafe { std::slice::from_raw_parts(data.as_ptr() as *const u8, byte_len) };
            let mut encoder = Encoder::new(Vec::with_capacity(byte_len)).ok()?;
            encoder.write_all(bytes).ok()?;
            let encoded = encoder.finish().into_result().ok()?;
            Some(STANDARD.encode(encoded))
        }

        #[cfg(not(target_endian = "little"))]
        {
            let mut bytes = vec![0; byte_len];
            LittleEndian::write_u32_into(data, &mut bytes);

            let mut encoder = Encoder::new(Vec::with_capacity(byte_len)).ok()?;
            encoder.write_all(bytes.as_slice()).ok()?;
            let encoded = encoder.finish().into_result().ok()?;
            Some(STANDARD.encode(encoded))
        }
    }

    fn save_chunk_to_disk(data: ChunkSaveData, folder: &PathBuf) {
        let voxels = match Self::to_base_64(&data.voxels) {
            Some(voxels) => voxels,
            None => {
                warn!("Failed to encode chunk voxels for {}", data.chunk_name);
                return;
            }
        };
        let height_map = match Self::to_base_64(&data.height_map) {
            Some(height_map) => height_map,
            None => {
                warn!("Failed to encode chunk height map for {}", data.chunk_name);
                return;
            }
        };
        let file_data = ChunkFileData {
            id: data.chunk_id,
            voxels,
            height_map,
        };

        let mut path = folder.clone();
        path.push(data.chunk_name);
        path.set_extension("json");
        let tmp_path = path.with_extension("json.tmp");

        let mut file = match File::create(&tmp_path) {
            Ok(f) => f,
            Err(e) => {
                warn!("Failed to create chunk temp file: {}", e);
                return;
            }
        };

        if let Err(e) = serde_json::to_writer(&mut file, &file_data) {
            warn!("Failed to serialize chunk data: {}", e);
            let _ = fs::remove_file(&tmp_path);
            return;
        }

        if file.sync_all().is_err() {
            let _ = fs::remove_file(&tmp_path);
            return;
        }

        drop(file);

        if fs::rename(&tmp_path, &path).is_err() {
            let _ = fs::remove_file(&tmp_path);
        }
    }

    pub fn queue_save(
        &self,
        coords: Vec2<i32>,
        chunk_name: String,
        chunk_id: String,
        voxels: Vec<u32>,
        height_map: Vec<u32>,
    ) {
        let data = ChunkSaveData {
            coords,
            chunk_name,
            chunk_id,
            voxels,
            height_map,
        };

        if let Err(e) = self.sender.try_send(data) {
            warn!("Failed to queue chunk save: {}", e);
        }
    }
}

impl Drop for BackgroundChunkSaver {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
