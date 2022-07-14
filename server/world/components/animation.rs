use serde::Serialize;
use specs::{Component, VecStorage};

/// The direction this entity is looking at.
#[derive(Default, Component, Serialize)]
#[storage(VecStorage)]
pub struct AnimationComp(pub Option<String>);

impl AnimationComp {
    /// Create a component of the animation this entity is running.
    pub fn new() -> Self {
        Self(None)
    }
}
