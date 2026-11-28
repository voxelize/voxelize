use hashbrown::{HashMap, HashSet};
use log::warn;
use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use crate::world::save_worker::{SaveWorker, SAVE_STALL_LIMIT};
use crate::{MetadataComp, WorldConfig};

/// A save tick queues every entity at once; the writer waits this long after
/// the first one so the whole tick lands as a single batch.
const COALESCE_WINDOW: Duration = Duration::from_millis(100);

/// An entity file being written. It becomes the entity's file by rename, so a
/// reader only ever sees a whole file, and the loader skips this suffix.
const TEMP_SUFFIX: &str = ".tmp";

#[derive(Clone)]
pub struct EntitySaveData {
    pub id: String,
    pub etype: String,
    pub is_block: bool,
    pub metadata: MetadataComp,
}

/// What is still owed to the disk for one entity. Only the latest request per
/// entity is kept (see [`SaveWorker`]), so a removal can never be overtaken by
/// an earlier save re-creating the file.
enum PendingOp {
    /// `after_removal`: a removal was queued first, so the entity's old file
    /// goes before this one is written.
    Save {
        data: EntitySaveData,
        after_removal: bool,
    },
    Remove,
}

/// The entities folder, as the writer thread sees it.
struct EntityFiles {
    folder: PathBuf,
    /// A hash of what was last written per entity. An entity whose saved
    /// form has not changed since (a sign, a sleeping animal) is not written
    /// again every save tick.
    written: Mutex<HashMap<String, u64>>,
}

pub struct BackgroundEntitiesSaver {
    worker: Option<SaveWorker<String, PendingOp>>,
    folder: PathBuf,
}

impl BackgroundEntitiesSaver {
    pub fn new(config: &WorldConfig) -> Self {
        let mut folder = PathBuf::from(&config.save_dir);
        folder.push("entities");

        let worker = (config.saving && config.save_entities).then(|| {
            fs::create_dir_all(&folder).expect("Unable to create entities directory...");
            Self::remove_interrupted_writes(&folder);

            let files = EntityFiles {
                folder: folder.clone(),
                written: Mutex::new(HashMap::new()),
            };
            SaveWorker::new(
                format!("entity saves for {}", folder.display()),
                COALESCE_WINDOW,
                SAVE_STALL_LIMIT,
                move |batch| files.write_batch(batch),
            )
        });

        Self { worker, folder }
    }

    /// A process killed mid-write leaves its temp file behind. The entity's
    /// real file is untouched (the rename never happened), so the leftover is
    /// only litter.
    fn remove_interrupted_writes(folder: &Path) {
        let Ok(entries) = fs::read_dir(folder) else {
            return;
        };
        for entry in entries.flatten() {
            if entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.ends_with(TEMP_SUFFIX))
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    pub fn queue_save(&self, id: &str, etype: &str, is_block: bool, metadata: &MetadataComp) {
        let Some(worker) = &self.worker else {
            return;
        };

        let data = EntitySaveData {
            id: id.to_string(),
            etype: etype.to_string(),
            is_block,
            metadata: metadata.clone(),
        };

        worker.submit(id.to_owned(), |waiting| PendingOp::Save {
            data,
            after_removal: matches!(
                waiting,
                Some(
                    PendingOp::Remove
                        | PendingOp::Save {
                            after_removal: true,
                            ..
                        }
                )
            ),
        });
    }

    pub fn remove(&self, id: &str) {
        if let Some(worker) = &self.worker {
            worker.submit(id.to_owned(), |_| PendingOp::Remove);
        }
    }

    /// Return once every save and removal queued so far is on disk.
    pub fn flush(&self) {
        if let Some(worker) = &self.worker {
            worker.flush();
        }
    }

    pub fn folder(&self) -> &PathBuf {
        &self.folder
    }
}

impl EntityFiles {
    fn write_batch(&self, batch: HashMap<String, PendingOp>) {
        let mut written = self.written.lock().unwrap_or_else(PoisonError::into_inner);

        let removed: HashSet<&str> = batch
            .iter()
            .filter(|(_, op)| {
                matches!(
                    op,
                    PendingOp::Remove
                        | PendingOp::Save {
                            after_removal: true,
                            ..
                        }
                )
            })
            .map(|(id, _)| id.as_str())
            .collect();
        if !removed.is_empty() {
            self.remove_from_disk(&removed);
            for id in &removed {
                written.remove(*id);
            }
        }

        for (id, op) in &batch {
            let PendingOp::Save { data, .. } = op else {
                continue;
            };
            match self.save(data, written.get(id).copied()) {
                Some(hash) => written.insert(id.clone(), hash),
                None => written.remove(id),
            };
        }
    }

    /// Write one entity's file. Returns the hash of what is now on disk, or
    /// `None` when the write failed and the next save tick must try again.
    fn save(&self, data: &EntitySaveData, last_written: Option<u64>) -> Option<u64> {
        let etype_value = if data.is_block {
            format!(
                "block::{}",
                data.etype.to_lowercase().trim_start_matches("block::")
            )
        } else {
            data.etype.to_lowercase()
        };

        let sanitized_filename = etype_value.replace("::", "-").replace(' ', "-");
        let new_path = self
            .folder
            .join(format!("{}-{}.json", sanitized_filename, data.id));
        let old_path = self.folder.join(format!("{}.json", data.id));
        let path = if old_path.exists() {
            old_path
        } else {
            new_path
        };

        // The id is part of the file: the file name alone cannot give it
        // back, because both an entity type and an id may hold dashes.
        let contents = json!({
            "etype": etype_value,
            "id": data.id,
            "metadata": data.metadata,
        })
        .to_string();

        let mut hasher = DefaultHasher::new();
        contents.hash(&mut hasher);
        let hash = hasher.finish();
        if last_written == Some(hash) && path.exists() {
            return Some(hash);
        }

        // Written beside the file and renamed over it: a process that dies
        // mid-write leaves the previous save intact instead of half a file.
        // Not fsynced (hundreds of entities every few seconds): this protects
        // against the process dying, not against the machine losing power.
        let mut temp_path = path.clone().into_os_string();
        temp_path.push(TEMP_SUFFIX);
        let temp_path = PathBuf::from(temp_path);

        if let Err(e) = fs::write(&temp_path, contents.as_bytes()) {
            warn!("Failed to write entity file {}: {}", temp_path.display(), e);
            let _ = fs::remove_file(&temp_path);
            return None;
        }
        if let Err(e) = fs::rename(&temp_path, &path) {
            warn!("Failed to put entity file {} in place: {}", path.display(), e);
            let _ = fs::remove_file(&temp_path);
            return None;
        }

        Some(hash)
    }

    fn remove_from_disk(&self, ids: &HashSet<&str>) {
        let Ok(entries) = fs::read_dir(&self.folder) else {
            return;
        };

        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(stem) = name.to_str().and_then(|name| name.strip_suffix(".json")) else {
                continue;
            };
            if Self::file_belongs_to_one_of(stem, ids) {
                if let Err(e) = fs::remove_file(entry.path()) {
                    warn!("Failed to remove entity file: {}", e);
                }
            }
        }
    }

    /// An entity's file is `<id>.json` (the old layout) or `<etype>-<id>.json`.
    /// Entity types and ids may both hold dashes, so every dash is a possible
    /// split between the two.
    fn file_belongs_to_one_of(stem: &str, ids: &HashSet<&str>) -> bool {
        ids.contains(stem)
            || stem
                .match_indices('-')
                .any(|(dash, _)| ids.contains(&stem[dash + 1..]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WorldConfig;
    use nanoid::nanoid;
    use serde_json::{json, Value};

    fn saving_config() -> (WorldConfig, PathBuf) {
        let save_dir = std::env::temp_dir().join(format!("bg-saver-test-{}", nanoid!()));
        let config = WorldConfig::new()
            .saving(true)
            .save_entities(true)
            .save_dir(save_dir.to_str().unwrap())
            .build();
        (config, save_dir)
    }

    fn saved_files(entities_dir: &Path) -> Vec<String> {
        let mut saved: Vec<String> = fs::read_dir(entities_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        saved.sort();
        saved
    }

    #[test]
    fn queue_save_writes_the_entity_file_once_the_queue_flushes() {
        let (config, save_dir) = saving_config();
        let entities_dir = save_dir.join("entities");
        {
            let saver = BackgroundEntitiesSaver::new(&config);
            let mut metadata = MetadataComp::new();
            metadata.map.insert("fishType".to_owned(), json!("salmon"));

            saver.queue_save("keep-me", "fish", false, &metadata);
            // Drop joins the background thread, which flushes pending saves.
        }

        let saved = saved_files(&entities_dir);
        let file: Value =
            serde_json::from_str(&fs::read_to_string(entities_dir.join(&saved[0])).unwrap())
                .unwrap();
        fs::remove_dir_all(&save_dir).unwrap();

        assert_eq!(saved, vec!["fish-keep-me.json".to_owned()]);
        assert_eq!(
            file,
            json!({
                "etype": "fish",
                "id": "keep-me",
                "metadata": { "map": { "fishType": "salmon" } }
            })
        );
    }

    #[test]
    fn a_save_tick_of_any_size_is_written_whole() {
        // More entities than the old fixed queue held (10,000): the rest of
        // such a tick used to be dropped with one warning per entity.
        const ENTITIES: usize = 12_000;

        let (config, save_dir) = saving_config();
        let entities_dir = save_dir.join("entities");
        let saver = BackgroundEntitiesSaver::new(&config);
        let metadata = MetadataComp::new();
        for index in 0..ENTITIES {
            saver.queue_save(&format!("e{index}"), "fish", false, &metadata);
        }
        saver.flush();

        let saved = saved_files(&entities_dir).len();
        drop(saver);
        fs::remove_dir_all(&save_dir).unwrap();

        assert_eq!(saved, ENTITIES);
    }

    #[test]
    fn the_latest_request_for_an_entity_is_the_one_on_disk() {
        let (config, save_dir) = saving_config();
        let entities_dir = save_dir.join("entities");
        {
            let saver = BackgroundEntitiesSaver::new(&config);
            let mut metadata = MetadataComp::new();

            metadata.map.insert("age".to_owned(), json!(1));
            saver.queue_save("grows-up", "fish", false, &metadata);
            metadata.map.insert("age".to_owned(), json!(2));
            saver.queue_save("grows-up", "fish", false, &metadata);

            // Ids hold dashes, and so do the file names built from them.
            saver.queue_save("gone-for-good", "fish", false, &metadata);
            saver.remove("gone-for-good");

            saver.remove("came-back");
            saver.queue_save("came-back", "fish", false, &metadata);
        }

        let saved = saved_files(&entities_dir);
        let grown = fs::read_to_string(entities_dir.join("fish-grows-up.json")).unwrap();
        fs::remove_dir_all(&save_dir).unwrap();

        assert_eq!(
            saved,
            vec![
                "fish-came-back.json".to_owned(),
                "fish-grows-up.json".to_owned()
            ]
        );
        assert!(grown.contains("\"age\":2"), "saved the stale copy: {grown}");
    }

    #[test]
    fn a_removal_deletes_a_file_saved_in_an_earlier_batch() {
        let (config, save_dir) = saving_config();
        let entities_dir = save_dir.join("entities");
        let saver = BackgroundEntitiesSaver::new(&config);
        let metadata = MetadataComp::new();

        saver.queue_save("stays-here", "fish", false, &metadata);
        saver.queue_save("leaves-later", "block::two words", true, &metadata);
        saver.flush();
        assert_eq!(saved_files(&entities_dir).len(), 2);

        saver.remove("leaves-later");
        saver.flush();

        let saved = saved_files(&entities_dir);
        drop(saver);
        fs::remove_dir_all(&save_dir).unwrap();

        assert_eq!(saved, vec!["fish-stays-here.json".to_owned()]);
    }

    #[test]
    fn an_unchanged_entity_is_not_rewritten_but_a_missing_file_is_restored() {
        let (config, save_dir) = saving_config();
        let entities_dir = save_dir.join("entities");
        let path = entities_dir.join("fish-still.json");
        let saver = BackgroundEntitiesSaver::new(&config);
        let mut metadata = MetadataComp::new();
        metadata.map.insert("age".to_owned(), json!(1));

        saver.queue_save("still", "fish", false, &metadata);
        saver.flush();
        // Stand-in contents: a rewrite would replace them.
        fs::write(&path, "untouched").unwrap();
        saver.queue_save("still", "fish", false, &metadata);
        saver.flush();
        let after_unchanged_save = fs::read_to_string(&path).unwrap();

        metadata.map.insert("age".to_owned(), json!(2));
        saver.queue_save("still", "fish", false, &metadata);
        saver.flush();
        let after_changed_save = fs::read_to_string(&path).unwrap();

        fs::remove_file(&path).unwrap();
        saver.queue_save("still", "fish", false, &metadata);
        saver.flush();
        let is_restored = path.exists();

        drop(saver);
        fs::remove_dir_all(&save_dir).unwrap();

        assert_eq!(after_unchanged_save, "untouched");
        assert!(after_changed_save.contains("\"age\":2"));
        assert!(is_restored, "a file deleted behind the saver's back stays gone");
    }

    #[test]
    fn a_write_leaves_no_temp_file_and_startup_clears_interrupted_ones() {
        let (config, save_dir) = saving_config();
        let entities_dir = save_dir.join("entities");
        fs::create_dir_all(&entities_dir).unwrap();
        // What a process killed mid-write leaves behind.
        fs::write(entities_dir.join("fish-half.json.tmp"), "{\"etype\":\"fi").unwrap();

        let saver = BackgroundEntitiesSaver::new(&config);
        saver.queue_save("whole", "fish", false, &MetadataComp::new());
        saver.flush();

        let saved = saved_files(&entities_dir);
        drop(saver);
        fs::remove_dir_all(&save_dir).unwrap();

        assert_eq!(saved, vec!["fish-whole.json".to_owned()]);
    }
}
