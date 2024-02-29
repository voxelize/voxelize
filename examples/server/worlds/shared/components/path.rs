use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};
use voxelize::Vec3;

#[derive(Component, Debug, Serialize, Deserialize, Default)]
#[storage(VecStorage)]
#[serde(rename_all = "camelCase")]
pub struct PathComp {
    pub path: Option<Vec<Vec3<i32>>>,
    pub max_nodes: usize,
}

impl PathComp {
    pub fn new(max_nodes: usize) -> Self {
        Self {
            path: None,
            max_nodes,
        }
    }
}
