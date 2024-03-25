use crate::Vec3;
use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

pub type EType = String;

#[derive(Debug, Serialize, Deserialize, PartialEq, Default)]
pub enum TargetType {
    #[default]
    All,
    Players,
    Entities,
}

/// By adding this component, an entity has the ability to scan around
/// and look at the closest entity.
#[derive(Component, Debug, Serialize, Deserialize, Default)]
#[storage(VecStorage)]
pub struct TargetComp(pub TargetType, pub Option<Vec3<f32>>);

impl TargetComp {
    pub fn new(target_type: TargetType, target_position: Option<Vec3<f32>>) -> Self {
        TargetComp(target_type, target_position)
    }

    pub fn all() -> Self {
        TargetComp(TargetType::All, None)
    }

    pub fn players() -> Self {
        TargetComp(TargetType::Players, None)
    }

    pub fn entities() -> Self {
        TargetComp(TargetType::Entities, None)
    }
}
