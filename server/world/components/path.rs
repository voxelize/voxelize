use crate::Vec3;
use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};
use std::time::{Duration, Instant};
#[derive(Component, Debug, Serialize, Deserialize, Default)]
#[storage(VecStorage)]
#[serde(rename_all = "camelCase")]
pub struct PathComp {
    pub path: Option<Vec<Vec3<i32>>>,
    pub max_nodes: usize,
    pub max_distance: f64,
    pub max_depth_search: i32,
    pub max_pathfinding_time: Duration,
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
        }
    }
}
