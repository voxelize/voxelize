use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};
use voxelize::Vec3;

/// Parameters of one wandering fauna: a deterministic Lissajous-style orbit
/// around a fixed center, used by the replication stress scenario to keep
/// hundreds of entities in smooth continuous motion with zero physics cost.
#[derive(Debug, Default, Component, Serialize, Deserialize, Clone)]
#[storage(VecStorage)]
#[serde(rename_all = "camelCase")]
pub struct FaunaComp {
    pub center: Vec3<f32>,
    pub radius_x: f32,
    pub radius_z: f32,
    pub angular_speed_x: f32,
    pub angular_speed_z: f32,
    pub bob_amplitude: f32,
    pub phase: f32,
}
