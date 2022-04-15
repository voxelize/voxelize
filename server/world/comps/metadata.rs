use serde::{Deserialize, Serialize};
use serde_json::Value;
use specs::{Component, VecStorage};

#[derive(Serialize, Deserialize)]
pub struct Metadata {
    pub component: String,
    pub value: Value,
}

/// A list of chunks that the entity is requesting to generate.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct MetadataComp(pub Vec<Metadata>);

impl MetadataComp {
    /// Create a component of a new list of chunk requests.
    pub fn new() -> Self {
        Self::default()
    }
}
