use rapier3d::prelude::{ColliderHandle, RigidBodyHandle};
use specs::{Component, VecStorage};

/// What makes an entity physical in Voxelize.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct InteractorComp(pub RigidBodyHandle, pub ColliderHandle);

impl InteractorComp {
    /// Create a new interactor component.
    pub fn new(data: &(RigidBodyHandle, ColliderHandle)) -> Self {
        Self(data.0.to_owned(), data.1.to_owned())
    }

    pub fn body_handle(&self) -> &RigidBodyHandle {
        &self.0
    }

    pub fn collider_handle(&self) -> &ColliderHandle {
        &self.1
    }
}
