use crate::Vec3;
use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};
use std::time::Duration;
#[derive(Component, Debug, Serialize, Deserialize, Default)]
#[storage(VecStorage)]
#[serde(rename_all = "camelCase")]
pub struct PathComp {
    pub path: Option<Vec<Vec3<i32>>>,
    pub max_nodes: usize,
    pub max_distance: f64,
    pub max_depth_search: i32,
    pub max_pathfinding_time: Duration,
    /// The (seeker voxel, target voxel) pair the current `path` was computed
    /// from. A* over voxels is a pure function of this pair, so as long as
    /// neither side has crossed a voxel boundary the answer cannot change
    /// and rerunning the search buys nothing. Recomputing every tick for
    /// stationary seekers was the single largest line in busy worlds' ticks.
    #[serde(skip)]
    pub computed_for: Option<(Vec3<i32>, Vec3<i32>)>,
    /// Ticks since `path` was last computed. Terrain can change under an
    /// unmoved pair, so a computed path is trusted only this long before the
    /// search reruns anyway.
    #[serde(skip)]
    pub ticks_since_computed: u32,
    /// How many ticks an unmoved pair's path stays trusted. Defaulted so
    /// entities persisted before this field existed still deserialize —
    /// without it, loading one old save panics the whole server.
    #[serde(default = "default_repath_max_age_ticks")]
    pub repath_max_age_ticks: u32,
}

/// A third of a second: long enough to amortise the search, short enough
/// that a wall placed across a cached path heals before anyone reads the
/// pause as pathing through it.
fn default_repath_max_age_ticks() -> u32 {
    20
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
            computed_for: None,
            ticks_since_computed: 0,
            repath_max_age_ticks: default_repath_max_age_ticks(),
        }
    }
}
