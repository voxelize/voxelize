use crate::Vec3;
use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};
use std::time::Duration;

#[inline]
const fn path_dirty_default() -> bool {
    true
}

#[derive(Component, Debug, Serialize, Deserialize)]
#[storage(VecStorage)]
#[serde(rename_all = "camelCase")]
pub struct PathComp {
    pub path: Option<Vec<Vec3<i32>>>,
    pub max_nodes: usize,
    pub max_distance: f64,
    pub max_depth_search: i32,
    pub max_pathfinding_time: Duration,

    #[serde(skip_serializing)]
    #[serde(skip_deserializing)]
    #[serde(default = "path_dirty_default")]
    pub dirty: bool,
}

impl Default for PathComp {
    fn default() -> Self {
        Self {
            path: None,
            max_nodes: 0,
            max_distance: 0.0,
            max_depth_search: 0,
            max_pathfinding_time: Duration::default(),
            dirty: true,
        }
    }
}

impl PathComp {
    pub fn new(
        max_nodes: usize,
        max_distance: f64,
        max_depth_search: i32,
        max_pathfinding_time: Duration,
    ) -> Self {
        Self {
            path: None,
            max_nodes,
            max_distance,
            max_depth_search,
            max_pathfinding_time,
            dirty: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::PathComp;

    #[test]
    fn default_marks_path_dirty() {
        let path = PathComp::default();
        assert!(path.dirty);
        assert!(path.path.is_none());
    }

    #[test]
    fn new_marks_path_dirty() {
        let path = PathComp::new(32, 128.0, 64, Duration::from_millis(5));
        assert!(path.dirty);
        assert!(path.path.is_none());
        assert_eq!(path.max_nodes, 32);
    }
}
