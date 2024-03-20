use crate::Vec3;
use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

pub type EType = String;

#[derive(Debug, Serialize, Deserialize, PartialEq, Default)]
pub enum TargetType {
    #[default]
    All,
    Player,
    Entities,
}

/// By adding this component, an entity has the ability to scan around
/// and look at the closest entity.
#[derive(Component, Debug, Serialize, Deserialize, Default)]
#[storage(VecStorage)]
pub struct TargetComp(pub TargetType, pub Option<Vec3<f32>>);
