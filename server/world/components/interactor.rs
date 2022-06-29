use rapier3d::prelude::RigidBodyHandle;
use specs::{Component, VecStorage};

/// What makes an entity physical in Voxelize.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct InteractorComp(pub RigidBodyHandle);

impl InteractorComp {
    /// Create a new interactor component.
    pub fn new(body_handle: RigidBodyHandle) -> Self {
        Self(body_handle)
    }
}
