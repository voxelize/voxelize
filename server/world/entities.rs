use hashbrown::HashMap;
use serde_json::json;
use specs::{Entity, EntityBuilder, World as ECSWorld, WorldExt};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use crate::{ETypeComp, IDComp, MetadataComp, PositionComp, RigidBodyComp, World};

type CreateEntity = fn(String, String, MetadataComp, &mut World) -> EntityBuilder;

/// Takes all the metadata components, and saves them into the
/// world saving directory by their ID's.
#[derive(Clone)]
pub struct Entities {
    pub folder: PathBuf,

    pub loaders: HashMap<String, CreateEntity>,
}

impl Entities {
    pub fn new(saving: bool, directory: &str) -> Self {
        let mut folder = PathBuf::from(&directory);
        folder.push("entities");

        if saving {
            fs::create_dir_all(&folder).expect("Unable to create entities directory...");
        }

        Self {
            folder,
            loaders: HashMap::default(),
        }
    }

    pub fn add_loader(&mut self, etype: &str, loader: CreateEntity) {
        self.loaders.insert(etype.to_lowercase(), loader);
    }

    pub fn get_loader(&mut self, etype: &str) -> Option<CreateEntity> {
        self.loaders.to_owned().remove(&etype.to_lowercase())
    }

    pub fn save(&self, id: &IDComp, etype: &ETypeComp, metadata: &MetadataComp) {
        let mut map = HashMap::new();
        map.insert("etype".to_owned(), json!(etype.0.to_lowercase()));
        map.insert("metadata".to_owned(), json!(metadata));
        let mut path = self.folder.clone();
        path.push(format!("{}.json", id.0));
        let mut file = File::create(&path).expect("Could not create entity file...");
        let j = serde_json::to_string(&json!(map)).unwrap();
        file.write_all(j.as_bytes())
            .expect("Unable to write entity file.");
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
