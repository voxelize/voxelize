use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

/// Which variant of its family an entity is drawn as. Written into the
/// entity's metadata as `variant`, which the client's instanced entity reads
/// (`InstancedEntityData.variant`).
#[derive(Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct VariantComp(pub String);

impl VariantComp {
    pub fn new(variant: &str) -> Self {
        Self(variant.to_owned())
    }
}
