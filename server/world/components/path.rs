use crate::Vec3;
use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};

#[derive(Component, Debug, Serialize, Deserialize, Default)]
#[storage(VecStorage)]
#[serde(rename_all = "camelCase")]
pub struct PathComp {
    pub path: Option<Vec<Vec3<i32>>>,
    pub max_nodes: usize,
    pub max_distance: f64,
}

impl PathComp {
    pub fn new(max_nodes: usize, max_distance: f64) -> Self {
        Self {
            path: None,
            max_nodes,
            max_distance,
        }
    }
}
