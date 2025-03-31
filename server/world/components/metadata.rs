use bincode;
use blake3::Hash;
use hashbrown::HashMap;
use log::info;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use specs::{Component, VecStorage};

/// A list of chunks that the entity is requesting to generate.
#[derive(Debug, Default, Component, Serialize, Deserialize, Clone)]
#[storage(VecStorage)]
pub struct MetadataComp {
    pub map: HashMap<String, Value>,

    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    cache_hash: Option<Hash>,
}

impl MetadataComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(map: HashMap<String, Value>) -> Self {
        Self {
            map,
            cache_hash: None,
        }
    }

    /// Set a component's metadata
    pub fn set<T: Component + Serialize>(&mut self, component: &str, data: &T) {
        let value = json!(data);
        self.map.insert(component.to_owned(), value);
    }

    /// Get a component's metadata
    pub fn get<T: Component + DeserializeOwned>(&self, component: &str) -> Option<T> {
        if let Some(component) = self.map.get(component) {
            return Some(serde_json::from_value(component.to_owned()).unwrap());
        }

        None
    }

    /// Calculate hash of the current metadata map
    fn calculate_hash(&self) -> Hash {
        // Serialize to binary format which is more efficient than JSON string
        let bytes = bincode::serialize(&self.map).unwrap_or_default();
        blake3::hash(&bytes)
    }

    /// Convert metadata to JSON string, also caches is current state using hash.
    pub fn to_cached_str(&mut self) -> (String, bool) {
        let current_hash = self.calculate_hash();

        let mut updated = false;
        if let Some(cache_hash) = self.cache_hash {
            if cache_hash != current_hash {
                updated = true;
                self.cache_hash = Some(current_hash);
            }
        } else {
            updated = true;
            self.cache_hash = Some(current_hash);
        }

        (self.to_string(), updated)
    }

    /// Get a clean JSON string with no side-effects.
    pub fn to_string(&self) -> String {
        serde_json::to_string(&self.map).unwrap()
    }

    /// Is the metadata empty?
    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// Reset this metadata
    pub fn reset(&mut self) {
        self.map.clear();
    }
}
