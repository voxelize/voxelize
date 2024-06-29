use crate::Vec3;
use serde::{Deserialize, Serialize};
use specs::{Component, Entity, VecStorage};

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
#[serde(rename_all = "camelCase")]
#[storage(VecStorage)]
pub struct TargetComp {
    pub target_type: TargetType,
    pub position: Option<Vec3<f32>>,
    #[serde(skip_serializing, skip_deserializing)]
    pub entity: Option<Entity>,
}

impl TargetComp {
    pub fn new(
        target_type: TargetType,
        position: Option<Vec3<f32>>,
        entity: Option<Entity>,
    ) -> Self {
        TargetComp {
            target_type,
            position,
            entity,
        }
    }

    pub fn all() -> Self {
        TargetComp {
            target_type: TargetType::All,
            position: None,
            entity: None,
        }
    }

    pub fn players() -> Self {
        TargetComp {
            target_type: TargetType::Players,
            position: None,
            entity: None,
        }
    }

    pub fn entities() -> Self {
        TargetComp {
            target_type: TargetType::Entities,
            position: None,
            entity: None,
        }
    }
}
