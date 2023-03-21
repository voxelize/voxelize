use hashbrown::HashMap;
use serde_json::{json, Value};
use specs::{Entity, World as ECSWorld, WorldExt};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use crate::{ETypeComp, IDComp, MetadataComp, PositionComp, RigidBodyComp};

/// Takes all the metadata components, and saves them into the
/// world saving directory by their ID's.
#[derive(Clone)]
pub struct EntitiesSaver {
    pub folder: PathBuf,
    pub saving: bool,
}

impl EntitiesSaver {
    pub fn new(saving: bool, directory: &str) -> Self {
        let mut folder = PathBuf::from(&directory);
        folder.push("entities");

        if saving {
            fs::create_dir_all(&folder).expect("Unable to create entities directory...");
        }

        Self { saving, folder }
    }

    pub fn save(&self, id: &str, etype: &str, metadata: &HashMap<String, Value>) {
        if !self.saving {
            return;
        }

        let mut map = HashMap::new();
        map.insert("etype".to_owned(), json!(etype.to_lowercase()));
        map.insert("metadata".to_owned(), json!(metadata));
        let mut path = self.folder.clone();
        path.push(format!("{}.json", id));
        let mut file = File::create(&path).expect("Could not create entity file...");
        let j = serde_json::to_string(&json!(map)).unwrap();
        file.write_all(j.as_bytes())
            .expect("Unable to write entity file.");
    }

    pub fn remove(&self, id: &str) {
        if !self.saving {
            return;
        }

        let mut path = self.folder.clone();
        path.push(format!("{}.json", id));
        fs::remove_file(&path).expect("Unable to remove entity file.");
    }
}

pub fn set_position(ecs: &mut ECSWorld, entity: Entity, x: f32, y: f32, z: f32) {
    let mut positions = ecs.write_storage::<PositionComp>();
    if let Some(position) = positions.get_mut(entity.to_owned()) {
        position.0.set(x, y, z);
    }

    let mut bodies = ecs.write_storage::<RigidBodyComp>();
    if let Some(body) = bodies.get_mut(entity.to_owned()) {
        body.0.set_position(x, y, z);
    }
}
