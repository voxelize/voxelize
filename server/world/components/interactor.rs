use rapier3d::prelude::{ColliderHandle, RigidBodyHandle};
use specs::{Component, VecStorage};

/// What makes an entity physical in Voxelize.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct InteractorComp {
    pub body_handle: RigidBodyHandle,
    pub collider_handle: ColliderHandle,
}

impl InteractorComp {
    /// Create a new interactor component.
    pub fn new(body_handle: RigidBodyHandle, collider_handle: ColliderHandle) -> Self {
        Self {
            body_handle,
            collider_handle,
        }
    }
}
