use hashbrown::HashMap;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use specs::{Component, VecStorage};

/// A list of chunks that the entity is requesting to generate.
#[derive(Debug, Default, Component, Serialize, Deserialize, Clone)]
#[storage(VecStorage)]
pub struct MetadataComp {
    pub map: HashMap<String, Value>,

    /// The last JSON snapshot emitted by `to_cached_str`, used to detect changes.
    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    last_emitted_json: Option<String>,
}

impl MetadataComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(map: HashMap<String, Value>) -> Self {
        Self {
            map,
            last_emitted_json: None,
        }
    }

    pub fn set_value(&mut self, component: &str, value: Value) {
        self.map.insert(component.to_owned(), value);
    }

    /// Set a component's metadata (dynamic - sent every update)
    pub fn set<T: Component + Serialize>(&mut self, component: &str, data: &T) {
        let value = json!(data);
        self.set_value(component, value);
    }

    /// Set static metadata only if it doesn't already exist (sent on CREATE, not every UPDATE)
    pub fn set_once<T: Component + Serialize>(&mut self, component: &str, data: &T) {
        if !self.map.contains_key(component) {
            self.map.insert(component.to_owned(), json!(data));
        }
    }

    /// Get a component's metadata
    pub fn get<T: Component + DeserializeOwned>(&self, component: &str) -> Option<T> {
        if let Some(component) = self.map.get(component) {
            return Some(serde_json::from_value(component.to_owned()).unwrap());
        }

        None
    }

    /// Serialize to JSON, returning whether it changed since the last call.
    pub fn to_cached_str(&mut self) -> (String, bool) {
        let json_str = self.to_string();
        let updated = self.last_emitted_json.as_deref() != Some(json_str.as_str());

        if updated {
            self.last_emitted_json = Some(json_str.clone());
        }

        (json_str, updated)
    }

    /// Get a clean JSON string with no side-effects.
    pub fn to_string(&self) -> String {
        serde_json::to_string(&self.map).unwrap()
    }

    /// Force the next `to_cached_str` to report a change, so this metadata is
    /// re-emitted to consumers even if its content did not change. Used to
    /// deterministically re-sync peer state when world membership changes.
    pub fn mark_dirty(&mut self) {
        self.last_emitted_json = None;
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
