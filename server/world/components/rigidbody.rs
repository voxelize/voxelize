use specs::{Component, VecStorage};

use crate::RigidBody;

/// What makes an entity physical in Voxelize.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct RigidBodyComp(pub RigidBody);

impl RigidBodyComp {
    /// Create a new rigid body component.
    pub fn new(body: &RigidBody) -> Self {
        Self(body.to_owned())
    }
}
