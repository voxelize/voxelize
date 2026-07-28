use crossbeam_channel::{bounded, Receiver, Sender, TryRecvError};
use hashbrown::HashMap;
use log::{debug, warn};
use serde_json::json;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::{MetadataComp, WorldConfig};

/// Metadata key that marks an entity as owned by a test scenario (stamped by
/// `test:spawn`-style methods). Scenario entities are live-only: they spawn
/// and despawn normally, but persisting them would litter the world save
/// with one orphaned JSON file per test run.
pub const SCENARIO_ID_METADATA_KEY: &str = "scenarioId";

pub fn is_scenario_owned(metadata: &MetadataComp) -> bool {
    metadata.map.contains_key(SCENARIO_ID_METADATA_KEY)
}

#[derive(Clone)]
pub struct EntitySaveData {
    pub id: String,
    pub etype: String,
    pub is_block: bool,
    pub metadata: MetadataComp,
}

/// Save and remove requests flow through one queue so a removal can never be
/// overtaken by an earlier queued save re-creating the file on disk.
enum EntitySaveOp {
    Save(EntitySaveData),
    Remove(String),
}

pub struct BackgroundEntitiesSaver {
    sender: Sender<EntitySaveOp>,
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
        let (sender, receiver) = bounded::<EntitySaveOp>(10000);
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
        receiver: Receiver<EntitySaveOp>,
        folder: PathBuf,
        shutdown: Arc<AtomicBool>,
    ) {
        let flush_interval = Duration::from_millis(100);
        let mut last_flush = Instant::now();
        let mut pending: HashMap<String, EntitySaveData> = HashMap::new();

        loop {
            match receiver.try_recv() {
                Ok(EntitySaveOp::Save(data)) => {
                    pending.insert(data.id.clone(), data);
                }
                Ok(EntitySaveOp::Remove(id)) => {
                    pending.remove(&id);
                    Self::remove_entity_from_disk(&id, &folder);
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

        // A decision, not a silent drop: scenario-owned entities live and die
        // with their test run and must never reach the world save.
        if is_scenario_owned(metadata) {
            debug!(
                "not persisting entity {} ({}): metadata carries {}, so it is scenario-owned",
                id, etype, SCENARIO_ID_METADATA_KEY
            );
            return;
        }

        let data = EntitySaveData {
            id: id.to_string(),
            etype: etype.to_string(),
            is_block,
            metadata: metadata.clone(),
        };

        if let Err(e) = self.sender.try_send(EntitySaveOp::Save(data)) {
            warn!("Failed to queue entity save: {}", e);
        }
    }

    pub fn remove(&self, id: &str) {
        if !self.saving {
            return;
        }

        if let Err(e) = self.sender.try_send(EntitySaveOp::Remove(id.to_string())) {
            warn!("Failed to queue entity removal: {}", e);
        }
    }

    fn remove_entity_from_disk(id: &str, folder: &PathBuf) {
        if let Ok(entries) = fs::read_dir(folder) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if let Some(filename) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if filename.ends_with(&format!("-{}.json", id))
                        || filename == format!("{}.json", id)
                    {
                        if let Err(e) = fs::remove_file(&entry_path) {
                            warn!("Failed to remove entity file: {}", e);
                        }
                        return;
                    }
                }
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WorldConfig;
    use nanoid::nanoid;
    use serde_json::json;

    fn scenario_metadata() -> MetadataComp {
        let mut metadata = MetadataComp::new();
        metadata
            .map
            .insert(SCENARIO_ID_METADATA_KEY.to_owned(), json!("scn-test"));
        metadata
    }

    fn saving_config() -> (WorldConfig, PathBuf) {
        let save_dir = std::env::temp_dir().join(format!("bg-saver-test-{}", nanoid!()));
        let config = WorldConfig::new()
            .saving(true)
            .save_entities(true)
            .save_dir(save_dir.to_str().unwrap())
            .build();
        (config, save_dir)
    }

    #[test]
    fn scenario_stamped_metadata_is_scenario_owned() {
        assert!(is_scenario_owned(&scenario_metadata()));
    }

    #[test]
    fn ordinary_metadata_is_not_scenario_owned() {
        assert!(!is_scenario_owned(&MetadataComp::new()));

        let mut metadata = MetadataComp::new();
        metadata.map.insert("fishType".to_owned(), json!("salmon"));
        assert!(!is_scenario_owned(&metadata));
    }

    #[test]
    fn queue_save_persists_ordinary_entities_but_never_scenario_owned_ones() {
        let (config, save_dir) = saving_config();
        let entities_dir = save_dir.join("entities");
        {
            let saver = BackgroundEntitiesSaver::new(&config);
            let mut ordinary = MetadataComp::new();
            ordinary.map.insert("fishType".to_owned(), json!("salmon"));

            saver.queue_save("keep-me", "fish", false, &ordinary);
            saver.queue_save("skip-me", "fish", false, &scenario_metadata());
            // Drop joins the background thread, which flushes pending saves.
        }

        let saved: Vec<String> = fs::read_dir(&entities_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        fs::remove_dir_all(&save_dir).unwrap();

        assert_eq!(saved, vec!["fish-keep-me.json".to_owned()]);
    }
}
