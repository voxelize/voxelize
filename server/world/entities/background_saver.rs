use crossbeam_channel::{bounded, Receiver, Sender, TryRecvError};
use hashbrown::HashMap;
use log::warn;
use std::borrow::Cow;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::{world::is_block_entity_type, MetadataComp, WorldConfig};

#[derive(Clone)]
pub struct EntitySaveData {
    pub etype: String,
    pub is_block: bool,
    pub metadata_json: String,
}

#[inline]
fn normalized_entity_type<'a>(etype: &'a str) -> Cow<'a, str> {
    let mut has_non_ascii = false;
    for &byte in etype.as_bytes() {
        if byte.is_ascii_uppercase() {
            return Cow::Owned(etype.to_lowercase());
        }
        if !byte.is_ascii() {
            has_non_ascii = true;
        }
    }
    if !has_non_ascii {
        Cow::Borrowed(etype)
    } else {
        for ch in etype.chars() {
            if ch.is_uppercase() {
                return Cow::Owned(etype.to_lowercase());
            }
        }
        Cow::Borrowed(etype)
    }
}

#[inline]
fn sanitize_entity_filename<'a>(etype: &'a str) -> Cow<'a, str> {
    if !etype.contains("::") && !etype.contains(' ') {
        return Cow::Borrowed(etype);
    }
    let mut sanitized = String::with_capacity(etype.len());
    let mut chars = etype.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == ':' && matches!(chars.peek(), Some(':')) {
            sanitized.push('-');
            chars.next();
            continue;
        }
        if ch == ' ' {
            sanitized.push('-');
        } else {
            sanitized.push(ch);
        }
    }
    Cow::Owned(sanitized)
}

#[inline]
fn escaped_json_string(value: &str) -> Option<String> {
    serde_json::to_string(value).ok()
}

#[inline]
fn take_map_with_capacity<K, V>(map: &mut HashMap<K, V>) -> HashMap<K, V> {
    let capacity = map.capacity();
    std::mem::replace(map, HashMap::with_capacity(capacity))
}

#[inline]
fn normalize_block_entity_type<'a>(normalized_etype: Cow<'a, str>) -> Cow<'a, str> {
    if is_block_entity_type(normalized_etype.as_ref()) {
        return normalized_etype;
    }
    let normalized_etype = normalized_etype.as_ref();
    let mut prefixed = String::with_capacity(7 + normalized_etype.len());
    prefixed.push_str("block::");
    prefixed.push_str(normalized_etype);
    Cow::Owned(prefixed)
}

pub struct BackgroundEntitiesSaver {
    sender: Sender<(String, EntitySaveData)>,
    folder: PathBuf,
    saving: bool,
    shutdown: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl BackgroundEntitiesSaver {
    pub fn new(config: &WorldConfig) -> Self {
        let mut folder = PathBuf::from(&config.save_dir);
        folder.push("entities");

        let mut saving = config.saving && config.save_entities;
        if saving {
            if let Err(error) = fs::create_dir_all(&folder) {
                warn!(
                    "Unable to create entities directory {:?}: {}",
                    folder, error
                );
                saving = false;
            }
        }
        let (sender, receiver) = bounded::<(String, EntitySaveData)>(10000);
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
        receiver: Receiver<(String, EntitySaveData)>,
        folder: PathBuf,
        shutdown: Arc<AtomicBool>,
    ) {
        let flush_interval = Duration::from_millis(100);
        let mut last_flush = Instant::now();
        let mut pending: HashMap<String, EntitySaveData> = HashMap::with_capacity(64);

        loop {
            match receiver.try_recv() {
                Ok((id, data)) => {
                    pending.insert(id, data);
                }
                Err(TryRecvError::Empty) => {
                    if shutdown.load(Ordering::Relaxed) {
                        if pending.is_empty() {
                            break;
                        }
                        Self::flush_pending(&mut pending, &folder);
                        last_flush = Instant::now();
                        continue;
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
        let pending = take_map_with_capacity(pending);
        for (id, data) in pending {
            Self::save_entity_to_disk(&id, &data, folder);
        }
    }

    fn save_entity_to_disk(id: &str, data: &EntitySaveData, folder: &PathBuf) {
        let normalized_etype = normalized_entity_type(&data.etype);
        let etype_value = if data.is_block {
            normalize_block_entity_type(normalized_etype)
        } else {
            normalized_etype
        };
        let Some(escaped_etype) = escaped_json_string(etype_value.as_ref()) else {
            warn!("Failed to build persisted entity payload for {}", id);
            return;
        };

        let sanitized_filename = sanitize_entity_filename(etype_value.as_ref());
        let mut new_filename = String::with_capacity(sanitized_filename.len() + id.len() + 6);
        new_filename.push_str(sanitized_filename.as_ref());
        new_filename.push('-');
        new_filename.push_str(id);
        new_filename.push_str(".json");
        let mut old_filename = String::with_capacity(id.len() + 5);
        old_filename.push_str(id);
        old_filename.push_str(".json");

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
                if let Err(e) = file
                    .write_all(b"{\"etype\":")
                    .and_then(|_| file.write_all(escaped_etype.as_bytes()))
                    .and_then(|_| file.write_all(b",\"metadata\":"))
                    .and_then(|_| file.write_all(data.metadata_json.as_bytes()))
                    .and_then(|_| file.write_all(b"}"))
                {
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
        let metadata_json = match metadata.to_persisted_json_snapshot() {
            Some(metadata_json) => metadata_json,
            None => {
                warn!("Failed to serialize entity metadata snapshot for {}", id);
                return;
            }
        };

        let data = EntitySaveData {
            etype: etype.to_string(),
            is_block,
            metadata_json,
        };

        if let Err(e) = self.sender.try_send((id.to_string(), data)) {
            warn!("Failed to queue entity save: {}", e);
        }
    }

    pub fn remove(&self, id: &str) {
        if !self.saving {
            return;
        }
        let suffixed_file_name = format!("-{}.json", id);
        let legacy_file_name = format!("{}.json", id);
        let mut removed_any = false;

        if let Ok(entries) = fs::read_dir(&self.folder) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if let Some(filename) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if filename.ends_with(&suffixed_file_name) || filename == legacy_file_name {
                        if let Err(e) = fs::remove_file(&entry_path) {
                            warn!(
                                "Failed to remove entity file: {}. Entity could still be saving?",
                                e
                            );
                        } else {
                            removed_any = true;
                        }
                    }
                }
            }
        }

        if !removed_any {
            warn!("Could not find entity file to remove for id: {}", id);
        }
    }

    pub fn folder(&self) -> &PathBuf {
        &self.folder
    }
}

impl Drop for BackgroundEntitiesSaver {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use super::normalize_block_entity_type;

    #[test]
    fn normalize_block_entity_type_keeps_existing_prefix() {
        let normalized = normalize_block_entity_type(Cow::Borrowed("block::lamp"));
        assert!(matches!(normalized, Cow::Borrowed("block::lamp")));
    }

    #[test]
    fn normalize_block_entity_type_adds_missing_prefix() {
        let normalized = normalize_block_entity_type(Cow::Borrowed("lamp"));
        assert_eq!(normalized.as_ref(), "block::lamp");
    }
}
