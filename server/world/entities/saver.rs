use log::warn;
use specs::{Entity, World as ECSWorld, WorldExt};
use std::borrow::Cow;
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use crate::{
    world::is_block_entity_type, MetadataComp, PositionComp, RigidBodyComp, WorldConfig,
};

/// Takes all the metadata components, and saves them into the
/// world saving directory by their ID's.
#[derive(Clone)]
pub struct EntitiesSaver {
    pub folder: PathBuf,
    pub saving: bool,
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
    let bytes = etype.as_bytes();
    let byte_len = bytes.len();
    let mut sanitized = String::new();
    let mut copy_start = 0usize;
    let mut index = 0usize;

    while index < byte_len {
        if bytes[index] == b':' && index + 1 < byte_len && bytes[index + 1] == b':' {
            if sanitized.is_empty() {
                sanitized = String::with_capacity(byte_len);
            }
            if copy_start < index {
                sanitized.push_str(&etype[copy_start..index]);
            }
            sanitized.push('-');
            index += 2;
            copy_start = index;
            continue;
        }
        if bytes[index] == b' ' {
            if sanitized.is_empty() {
                sanitized = String::with_capacity(byte_len);
            }
            if copy_start < index {
                sanitized.push_str(&etype[copy_start..index]);
            }
            sanitized.push('-');
            index += 1;
            copy_start = index;
            continue;
        }
        index += 1;
    }
    if sanitized.is_empty() {
        return Cow::Borrowed(etype);
    }
    if copy_start < byte_len {
        sanitized.push_str(&etype[copy_start..]);
    }
    Cow::Owned(sanitized)
}

#[inline]
fn escaped_json_string(value: &str) -> Option<String> {
    serde_json::to_string(value).ok()
}

const JSON_EXTENSION_LENGTH: usize = 5;
const SUFFIXED_ENTITY_FILENAME_EXTRA_LENGTH: usize = JSON_EXTENSION_LENGTH + 1;

#[inline]
fn has_json_extension(bytes: &[u8], start: usize) -> bool {
    bytes.len() == start + JSON_EXTENSION_LENGTH
        && bytes[start] == b'.'
        && bytes[start + 1] == b'j'
        && bytes[start + 2] == b's'
        && bytes[start + 3] == b'o'
        && bytes[start + 4] == b'n'
}

#[inline]
fn filename_matches_entity_id(filename: &str, id: &str) -> bool {
    let filename_bytes = filename.as_bytes();
    let id_bytes = id.as_bytes();
    let id_len = id_bytes.len();
    let filename_len = filename_bytes.len();

    if filename_len == id_len + JSON_EXTENSION_LENGTH
        && &filename_bytes[..id_len] == id_bytes
        && has_json_extension(filename_bytes, id_len)
    {
        return true;
    }
    if filename_len < id_len + SUFFIXED_ENTITY_FILENAME_EXTRA_LENGTH {
        return false;
    }

    let suffix_start = filename_len - (id_len + SUFFIXED_ENTITY_FILENAME_EXTRA_LENGTH);
    if filename_bytes[suffix_start] != b'-' {
        return false;
    }
    let id_start = suffix_start + 1;
    let id_end = id_start + id_len;
    &filename_bytes[id_start..id_end] == id_bytes && has_json_extension(filename_bytes, id_end)
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

impl EntitiesSaver {
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

        Self {
            saving,
            folder,
        }
    }

    pub fn save(&self, id: &str, etype: &str, is_block: bool, metadata: &MetadataComp) {
        if !self.saving {
            return;
        }

        let normalized_etype = normalized_entity_type(etype);
        let etype_value = if is_block {
            normalize_block_entity_type(normalized_etype)
        } else {
            normalized_etype
        };
        let Some(escaped_etype) = escaped_json_string(etype_value.as_ref()) else {
            warn!("Unable to serialize persisted entity type for {}", id);
            return;
        };
        let Some(metadata_json) = metadata.to_persisted_json_snapshot() else {
            warn!("Unable to serialize persisted entity metadata for {}", id);
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

        let mut new_path = self.folder.clone();
        new_path.push(&new_filename);

        let mut old_path = self.folder.clone();
        old_path.push(&old_filename);

        let path_to_use = if old_path.exists() {
            old_path
        } else {
            new_path
        };

        match File::create(&path_to_use) {
            Ok(mut file) => {
                if let Err(error) = file
                    .write_all(b"{\"etype\":")
                    .and_then(|_| file.write_all(escaped_etype.as_bytes()))
                    .and_then(|_| file.write_all(b",\"metadata\":"))
                    .and_then(|_| file.write_all(metadata_json.as_bytes()))
                    .and_then(|_| file.write_all(b"}"))
                {
                    warn!(
                        "Unable to write persisted entity file {:?}: {}",
                        path_to_use, error
                    );
                }
            }
            Err(error) => {
                warn!(
                    "Could not create persisted entity file {:?}: {}",
                    path_to_use, error
                );
            }
        }
    }

    pub fn remove(&self, id: &str) {
        if !self.saving {
            return;
        }
        let mut removed_any = false;

        if let Ok(entries) = fs::read_dir(&self.folder) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if let Some(filename) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if filename_matches_entity_id(filename, id) {
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
}

pub fn set_position(ecs: &mut ECSWorld, entity: Entity, x: f32, y: f32, z: f32) {
    let mut positions = ecs.write_storage::<PositionComp>();
    if let Some(position) = positions.get_mut(entity) {
        position.0.set(x, y, z);
    }

    let mut bodies = ecs.write_storage::<RigidBodyComp>();
    if let Some(body) = bodies.get_mut(entity) {
        body.0.set_position(x, y, z);
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use super::{
        filename_matches_entity_id, normalize_block_entity_type, sanitize_entity_filename,
    };

    #[test]
    fn normalize_block_entity_type_keeps_existing_prefix() {
        let normalized = normalize_block_entity_type(Cow::Borrowed("block::stone"));
        assert!(matches!(normalized, Cow::Borrowed("block::stone")));
    }

    #[test]
    fn normalize_block_entity_type_adds_missing_prefix() {
        let normalized = normalize_block_entity_type(Cow::Borrowed("stone"));
        assert_eq!(normalized.as_ref(), "block::stone");
    }

    #[test]
    fn sanitize_entity_filename_keeps_clean_names_borrowed() {
        let sanitized = sanitize_entity_filename("entity-stone");
        assert!(matches!(sanitized, Cow::Borrowed("entity-stone")));
    }

    #[test]
    fn sanitize_entity_filename_replaces_double_colons_and_spaces() {
        let sanitized = sanitize_entity_filename("block::stone slab");
        assert_eq!(sanitized.as_ref(), "block-stone-slab");
    }

    #[test]
    fn sanitize_entity_filename_handles_unicode_input() {
        let sanitized = sanitize_entity_filename("blöck::蓝 色");
        assert_eq!(sanitized.as_ref(), "blöck-蓝-色");
    }

    #[test]
    fn filename_matches_entity_id_handles_legacy_and_suffixed_names() {
        assert!(filename_matches_entity_id("abc123.json", "abc123"));
        assert!(filename_matches_entity_id(
            "block-stone-abc123.json",
            "abc123"
        ));
        assert!(!filename_matches_entity_id("block-stone-abc123.txt", "abc123"));
        assert!(!filename_matches_entity_id("block-stone-zzz999.json", "abc123"));
    }
}
