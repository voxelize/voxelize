use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};
use voxelize::Vec3;

/// By adding this component, an entity has the ability to scan around
/// and look at the closest entity.
#[derive(Component, Debug, Serialize, Deserialize, Default)]
#[storage(VecStorage)]
pub struct TargetComp(pub Option<Vec3<f32>>);
