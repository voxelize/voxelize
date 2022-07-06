use rapier3d::prelude::CollisionEvent;
use specs::{Component, Entity, VecStorage};

#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct CollisionsComp(pub Vec<(CollisionEvent, Entity)>);

impl CollisionsComp {
    /// Create a new component of the collisions this entity has.
    pub fn new() -> Self {
        Self::default()
    }
}
