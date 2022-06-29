use rapier3d::prelude::{ColliderHandle, RigidBodyHandle};

pub struct RapierBody {
    rigid_handle: RigidBodyHandle,

    collider_handler: ColliderHandle,
}

// impl RapierBody
