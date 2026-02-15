use bincode;
use blake3::Hash;
use hashbrown::{hash_map::RawEntryMut, HashMap};
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

    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    cached_json: Option<String>,

    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    dirty: bool,
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
            cached_json: None,
            dirty: true,
        }
    }

    /// Set a component's metadata (dynamic - sent every update)
    pub fn set<T: Component + Serialize>(&mut self, component: &str, data: &T) {
        let value = json!(data);
        match self.map.raw_entry_mut().from_key(component) {
            RawEntryMut::Occupied(mut entry) => {
                if entry.get() == &value {
                    return;
                }
                *entry.get_mut() = value;
                self.dirty = true;
                self.cached_json = None;
            }
            RawEntryMut::Vacant(entry) => {
                entry.insert(component.to_owned(), value);
                self.dirty = true;
                self.cached_json = None;
            }
        }
    }

    /// Set static metadata only if it doesn't already exist (sent on CREATE, not every UPDATE)
    pub fn set_once<T: Component + Serialize>(&mut self, component: &str, data: &T) {
        match self.map.raw_entry_mut().from_key(component) {
            RawEntryMut::Occupied(_) => {}
            RawEntryMut::Vacant(entry) => {
                entry.insert(component.to_owned(), json!(data));
                self.dirty = true;
                self.cached_json = None;
            }
        }
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
        if !self.dirty {
            if let Some(cached_json) = self.cached_json.as_ref() {
                return (cached_json.clone(), false);
            }
        }

        let current_hash = self.calculate_hash();

        let mut updated = false;
        if let Some(cache_hash) = self.cache_hash {
            if cache_hash != current_hash {
                updated = true;
                self.cache_hash = Some(current_hash);
                // Invalidate JSON cache when hash changes
                self.cached_json = None;
            }
        } else {
            updated = true;
            self.cache_hash = Some(current_hash);
            // Invalidate JSON cache for first update
            self.cached_json = None;
        }

        // Use cached JSON if available and not updated
        if !updated && self.cached_json.is_some() {
            self.dirty = false;
            return (self.cached_json.clone().unwrap(), updated);
        }

        // Generate and cache the JSON string
        let json_str = self.to_string();
        self.cached_json = Some(json_str.clone());
        self.dirty = false;

        (json_str, updated)
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
        if self.map.is_empty() {
            return;
        }
        self.map.clear();
        self.cached_json = None;
        self.dirty = true;
    }
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};
    use specs::{Component, VecStorage};

    use super::MetadataComp;

    #[derive(Component, Deserialize, Serialize)]
    #[storage(VecStorage)]
    struct TestMetadataValue {
        value: i32,
    }

    #[test]
    fn set_keeps_cache_when_value_unchanged() {
        let mut metadata = MetadataComp::new();
        metadata.set("test", &TestMetadataValue { value: 1 });
        let (first_json, first_updated) = metadata.to_cached_str();
        assert!(first_updated);

        metadata.set("test", &TestMetadataValue { value: 1 });
        let (second_json, second_updated) = metadata.to_cached_str();

        assert!(!second_updated);
        assert_eq!(first_json, second_json);
    }

    #[test]
    fn set_once_does_not_overwrite_existing_value() {
        let mut metadata = MetadataComp::new();
        metadata.set_once("test", &TestMetadataValue { value: 1 });
        metadata.set_once("test", &TestMetadataValue { value: 2 });

        let stored: Option<TestMetadataValue> = metadata.get("test");
        assert_eq!(stored.map(|value| value.value), Some(1));
    }
}
