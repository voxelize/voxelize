use log::warn;
use serde::Serialize;
use specs::{Entity, World as ECSWorld, WorldExt};
use std::fs::{self, File};
use std::path::PathBuf;

use crate::{MetadataComp, PositionComp, RigidBodyComp, WorldConfig};

/// Takes all the metadata components, and saves them into the
/// world saving directory by their ID's.
#[derive(Clone)]
pub struct EntitiesSaver {
    pub folder: PathBuf,
    pub saving: bool,
}

#[derive(Serialize)]
struct SavedEntityFile<'a> {
    etype: &'a str,
    metadata: &'a MetadataComp,
}

impl EntitiesSaver {
    pub fn new(config: &WorldConfig) -> Self {
        let mut folder = PathBuf::from(&config.save_dir);
        folder.push("entities");

        if config.saving && config.save_entities {
            fs::create_dir_all(&folder).expect("Unable to create entities directory...");
        }

        Self {
            saving: config.saving && config.save_entities,
            folder,
        }
    }

    pub fn save(&self, id: &str, etype: &str, is_block: bool, metadata: &MetadataComp) {
        if !self.saving {
            return;
        }

        let etype_value = if is_block {
            format!(
                "block::{}",
                etype.to_lowercase().trim_start_matches("block::")
            )
        } else {
            etype.to_lowercase()
        };
        let payload = SavedEntityFile {
            etype: &etype_value,
            metadata,
        };

        let mut sanitized_filename = if etype_value.contains("::") {
            etype_value.replace("::", "-")
        } else {
            etype_value.clone()
        };
        if sanitized_filename.contains(' ') {
            sanitized_filename = sanitized_filename.replace(' ', "-");
        }
        let new_filename = format!("{}-{}.json", sanitized_filename, id);
        let old_filename = format!("{}.json", id);

        let mut new_path = self.folder.clone();
        new_path.push(&new_filename);

        let mut old_path = self.folder.clone();
        old_path.push(&old_filename);

        let path_to_use = if old_path.exists() {
            old_path
        } else {
            new_path
        };

        let mut file = File::create(&path_to_use).expect("Could not create entity file...");
        serde_json::to_writer(&mut file, &payload).expect("Unable to write entity file.");
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
                    if filename.ends_with(&suffixed_file_name)
                        || filename == legacy_file_name
                    {
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
