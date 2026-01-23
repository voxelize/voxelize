use crossbeam_channel::{bounded, Receiver, Sender, TryRecvError};
use hashbrown::HashMap;
use log::warn;
use serde_json::json;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::{MetadataComp, WorldConfig};

#[derive(Clone)]
pub struct EntitySaveData {
    pub id: String,
    pub etype: String,
    pub is_block: bool,
    pub metadata: MetadataComp,
}

pub struct BackgroundEntitiesSaver {
    sender: Sender<EntitySaveData>,
    folder: PathBuf,
    saving: bool,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl BackgroundEntitiesSaver {
    pub fn new(config: &WorldConfig) -> Self {
        let mut folder = PathBuf::from(&config.save_dir);
        folder.push("entities");

        if config.saving && config.save_entities {
            fs::create_dir_all(&folder).expect("Unable to create entities directory...");
        }

        let saving = config.saving && config.save_entities;
        let (sender, receiver) = bounded::<EntitySaveData>(10000);
        let shutdown = Arc::new(AtomicBool::new(false));

        let handle = if saving {
            let folder_clone = folder.clone();
            let shutdown_clone = shutdown.clone();
            Some(thread::spawn(move || {
                Self::background_save_loop(receiver, folder_clone, shutdown_clone);
            }))
        } else {
            None
        };

        Self {
            sender,
            folder,
            saving,
            shutdown,
            handle,
        }
    }

    fn background_save_loop(
        receiver: Receiver<EntitySaveData>,
        folder: PathBuf,
        shutdown: Arc<AtomicBool>,
    ) {
        let flush_interval = Duration::from_millis(100);
        let mut last_flush = Instant::now();
        let mut pending: HashMap<String, EntitySaveData> = HashMap::new();

        loop {
            match receiver.try_recv() {
                Ok(data) => {
                    pending.insert(data.id.clone(), data);
                }
                Err(TryRecvError::Empty) => {
                    if shutdown.load(Ordering::Relaxed) && pending.is_empty() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(10));
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

    fn flush_pending(pending: &mut HashMap<String, EntitySaveData>, folder: &PathBuf) {
        for (_, data) in pending.drain() {
            Self::save_entity_to_disk(&data, folder);
        }
    }

    fn save_entity_to_disk(data: &EntitySaveData, folder: &PathBuf) {
        let mut map = HashMap::new();
        let etype_value = if data.is_block {
            format!(
                "block::{}",
                data.etype.to_lowercase().trim_start_matches("block::")
            )
        } else {
            data.etype.to_lowercase()
        };
        map.insert("etype".to_owned(), json!(etype_value));
        map.insert("metadata".to_owned(), json!(data.metadata));

        let sanitized_filename = etype_value.replace("::", "-").replace(' ', "-");
        let new_filename = format!("{}-{}.json", sanitized_filename, data.id);
        let old_filename = format!("{}.json", data.id);

        let mut new_path = folder.clone();
        new_path.push(&new_filename);

        let mut old_path = folder.clone();
        old_path.push(&old_filename);

        let path_to_use = if old_path.exists() {
            old_path
        } else {
            new_path
        };

        match File::create(&path_to_use) {
            Ok(mut file) => {
                let j = serde_json::to_string(&json!(map)).unwrap();
                if let Err(e) = file.write_all(j.as_bytes()) {
                    warn!("Failed to write entity file: {}", e);
                }
            }
            Err(e) => {
                warn!("Could not create entity file: {}", e);
            }
        }
    }

    pub fn queue_save(&self, id: &str, etype: &str, is_block: bool, metadata: &MetadataComp) {
        if !self.saving {
            return;
        }

        let data = EntitySaveData {
            id: id.to_string(),
            etype: etype.to_string(),
            is_block,
            metadata: metadata.clone(),
        };

        if let Err(e) = self.sender.try_send(data) {
            warn!("Failed to queue entity save: {}", e);
        }
    }

    pub fn remove(&self, id: &str) {
        if !self.saving {
            return;
        }

        if let Ok(entries) = fs::read_dir(&self.folder) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if let Some(filename) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if filename.ends_with(&format!("-{}.json", id))
                        || filename == format!("{}.json", id)
                    {
                        if let Err(e) = fs::remove_file(&entry_path) {
                            warn!(
                                "Failed to remove entity file: {}. Entity could still be saving?",
                                e
                            );
                        }
                        return;
                    }
                }
            }
        }

        warn!("Could not find entity file to remove for id: {}", id);
    }

    pub fn folder(&self) -> &PathBuf {
        &self.folder
    }
}

impl Drop for BackgroundEntitiesSaver {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        drop(self.sender.clone());
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
