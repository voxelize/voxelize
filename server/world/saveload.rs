use hashbrown::HashMap;
use log::info;
use serde_json::{json, Value};
use specs::{Builder, Entity, EntityBuilder, Join, WorldExt};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use crate::{ETypeComp, IDComp, MetadataComp, World};

type CreateEntity = fn(String, String, MetadataComp, &mut World) -> EntityBuilder;

/// SaveLoad basically takes all the metadata components, and saves them into the
/// world saving directory by their ID's.
#[derive(Clone)]
pub struct SaveLoad {
    pub folder: PathBuf,

    pub loaders: HashMap<String, CreateEntity>,
}

impl SaveLoad {
    pub fn new(directory: &str) -> Self {
        let mut folder = PathBuf::from(&directory);
        folder.push("entities");

        fs::create_dir_all(&folder).expect("Unable to create entities directory...");

        Self {
            folder,
            loaders: HashMap::default(),
        }
    }

    pub fn add_loader(&mut self, etype: &str, loader: CreateEntity) {
        self.loaders.insert(etype.to_lowercase(), loader);
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

    pub fn load(world: &mut World, folder: &PathBuf, loaders: &HashMap<String, CreateEntity>) {
        let paths = fs::read_dir(folder).unwrap();
        for path in paths {
            let path = path.unwrap().path();

            if let Ok(entity_data) = File::open(&path) {
                let id = path.file_stem().unwrap().to_str().unwrap().to_owned();
                let mut data: HashMap<String, Value> =
                    serde_json::from_reader(entity_data).expect("Could not load entity file...");
                let etype: String = serde_json::from_value(data.remove("etype").unwrap())
                    .expect("Metadata field does not exist!");
                let metadata: MetadataComp =
                    serde_json::from_value(data.remove("metadata").unwrap())
                        .expect("Metadata field does not exist!");

                if let Some(loader) = loaders.get(&etype) {
                    loader(id, etype, metadata, world).build();
                } else {
                    fs::remove_file(path).expect("Unable to remove entity file...");
                }
            }
        }
    }
}
