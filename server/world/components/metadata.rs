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
    cached_json: Option<String>,

    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    dirty: bool,
}

impl MetadataComp {
    #[inline]
    fn wrap_map_json_for_persistence(map_json: &str) -> String {
        let mut wrapped = String::with_capacity(map_json.len() + 8);
        wrapped.push_str("{\"map\":");
        wrapped.push_str(map_json);
        wrapped.push('}');
        wrapped
    }

    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(map: HashMap<String, Value>) -> Self {
        Self {
            map,
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
        self.map
            .get(component)
            .and_then(|component| serde_json::from_value(component.to_owned()).ok())
    }

    fn refresh_cached_json_if_dirty(&mut self) -> bool {
        if !self.dirty {
            return false;
        }

        let current_json = self.to_string();
        let updated = match self.cached_json.as_ref() {
            Some(cached_json) => cached_json != &current_json,
            None => true,
        };
        if updated || self.cached_json.is_none() {
            self.cached_json = Some(current_json);
        }
        self.dirty = false;
        updated
    }

    pub fn to_cached_str_if_updated(&mut self) -> Option<String> {
        if self.refresh_cached_json_if_dirty() {
            return self.cached_json.clone();
        }
        None
    }

    pub fn to_cached_str_for_new_record(&mut self) -> String {
        if let Some(cached_json) = self.cached_json.as_ref() {
            self.dirty = false;
            return cached_json.clone();
        }
        let json_str = self.to_string();
        self.cached_json = Some(json_str.clone());
        self.dirty = false;
        json_str
    }

    /// Convert metadata to JSON string, also caches is current state using hash.
    pub fn to_cached_str(&mut self) -> (String, bool) {
        let updated = self.refresh_cached_json_if_dirty();
        if let Some(cached_json) = self.cached_json.as_ref() {
            return (cached_json.clone(), updated);
        }

        let json_str = self.to_string();
        let updated = true;
        self.cached_json = Some(json_str.clone());
        self.dirty = false;

        (json_str, updated)
    }

    /// Get a clean JSON string with no side-effects.
    pub fn to_string(&self) -> String {
        serde_json::to_string(&self.map).unwrap_or_else(|_| String::from("{}"))
    }

    /// Build persisted metadata JSON without mutating cache/dirty state.
    pub fn to_persisted_json_snapshot(&self) -> Option<String> {
        if !self.dirty {
            if let Some(cached_json) = self.cached_json.as_ref() {
                return Some(Self::wrap_map_json_for_persistence(cached_json));
            }
        }
        serde_json::to_string(self).ok()
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

    #[derive(Component, Deserialize, Serialize)]
    #[storage(VecStorage)]
    struct TestMetadataString {
        value: String,
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

    #[test]
    fn to_cached_str_if_updated_returns_none_for_clean_state() {
        let mut metadata = MetadataComp::new();
        metadata.set("test", &TestMetadataValue { value: 1 });
        assert!(metadata.to_cached_str_if_updated().is_some());
        assert!(metadata.to_cached_str_if_updated().is_none());
    }

    #[test]
    fn to_cached_str_for_new_record_marks_clean_without_update() {
        let mut metadata = MetadataComp::new();
        metadata.set("test", &TestMetadataValue { value: 1 });
        let first = metadata.to_cached_str_for_new_record();
        let second = metadata.to_cached_str_for_new_record();

        assert_eq!(first, second);
        assert!(metadata.to_cached_str_if_updated().is_none());
    }

    #[test]
    fn persisted_json_snapshot_wraps_cached_map_json() {
        let mut metadata = MetadataComp::new();
        metadata.set("test", &TestMetadataValue { value: 1 });
        let _ = metadata.to_cached_str();

        let persisted = metadata
            .to_persisted_json_snapshot()
            .expect("snapshot should serialize");

        assert_eq!(persisted, String::from("{\"map\":{\"test\":{\"value\":1}}}"));
    }

    #[test]
    fn persisted_json_snapshot_serializes_dirty_metadata_without_mutation() {
        let mut metadata = MetadataComp::new();
        metadata.set("test", &TestMetadataValue { value: 1 });

        let persisted_before = metadata
            .to_persisted_json_snapshot()
            .expect("snapshot should serialize");
        let persisted_after = metadata
            .to_persisted_json_snapshot()
            .expect("snapshot should serialize");

        assert_eq!(persisted_before, persisted_after);
        assert_eq!(
            persisted_before,
            String::from("{\"map\":{\"test\":{\"value\":1}}}")
        );
    }

    #[test]
    fn get_returns_none_for_type_mismatches_instead_of_panicking() {
        let mut metadata = MetadataComp::new();
        metadata.set_once("test", &TestMetadataValue { value: 1 });

        let mismatched: Option<TestMetadataString> = metadata.get("test");

        assert!(mismatched.is_none());
    }
}
