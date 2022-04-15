use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specs::{Component, VecStorage};

/// A list of chunks that the entity is requesting to generate.
#[derive(Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct MetadataComp(pub HashMap<String, Value>);

impl MetadataComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set a component's metadata
    pub fn set(&mut self, component: &str, value: Value) {
        let component = component.to_owned();

        if self.0.contains_key(&component) {
            self.0.remove(&component);
        }

        self.0.insert(component, value);
    }

    /// Convert metadata to JSON string
    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.0).unwrap()
    }

    /// Reset this metadata
    pub fn reset(&mut self) {
        self.0.clear();
    }
}
