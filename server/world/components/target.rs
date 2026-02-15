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

#[inline]
const fn target_dirty_default() -> bool {
    true
}

/// By adding this component, an entity has the ability to scan around
/// and look at the closest entity.
#[derive(Component, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[storage(VecStorage)]
pub struct TargetComp {
    pub target_type: TargetType,
    pub position: Option<Vec3<f32>>,
    pub id: Option<String>,

    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    #[serde(default = "target_dirty_default")]
    pub dirty: bool,
}

impl Default for TargetComp {
    fn default() -> Self {
        Self::all()
    }
}

impl TargetComp {
    pub fn new(target_type: TargetType, position: Option<Vec3<f32>>, id: Option<String>) -> Self {
        TargetComp {
            target_type,
            position,
            id,
            dirty: true,
        }
    }

    pub fn all() -> Self {
        TargetComp {
            target_type: TargetType::All,
            position: None,
            id: None,
            dirty: true,
        }
    }

    pub fn players() -> Self {
        TargetComp {
            target_type: TargetType::Players,
            position: None,
            id: None,
            dirty: true,
        }
    }

    pub fn entities() -> Self {
        TargetComp {
            target_type: TargetType::Entities,
            position: None,
            id: None,
            dirty: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{TargetComp, TargetType};

    #[test]
    fn constructors_mark_target_dirty() {
        let all = TargetComp::all();
        assert!(all.dirty);
        assert_eq!(all.target_type, TargetType::All);

        let players = TargetComp::players();
        assert!(players.dirty);
        assert_eq!(players.target_type, TargetType::Players);

        let entities = TargetComp::entities();
        assert!(entities.dirty);
        assert_eq!(entities.target_type, TargetType::Entities);
    }

    #[test]
    fn default_target_is_all_and_dirty() {
        let target = TargetComp::default();
        assert!(target.dirty);
        assert_eq!(target.target_type, TargetType::All);
    }
}
