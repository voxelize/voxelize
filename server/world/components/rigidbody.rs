use specs::{Component, VecStorage};

use crate::world::physics::rigidbody::RigidBody;

/// What makes an entity physical in Voxelize.
#[derive(Default, Component)]
#[storage(VecStorage)]
pub struct RigidBodyComp(pub RigidBody);
