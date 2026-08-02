use crate::Vec3;
use serde::{Deserialize, Serialize};
use specs::{Component, VecStorage};
use std::time::Duration;
#[derive(Component, Debug, Serialize, Deserialize)]
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
    /// How many ticks an unmoved pair's path stays trusted. Code-owned, not
    /// save data: it once persisted, and a derived `Default` of 0 spawned a
    /// generation of entities whose saves disabled the repath guard outright
    /// — every pathfinder re-ran its full A* every tick, forever. Skipping
    /// the field heals those saves on load instead of trusting them.
    #[serde(skip, default = "default_repath_max_age_ticks")]
    pub repath_max_age_ticks: u32,
}

impl Default for PathComp {
    fn default() -> Self {
        Self {
            path: None,
            max_nodes: 0,
            max_distance: 0.0,
            max_depth_search: 0,
            max_pathfinding_time: Duration::ZERO,
            computed_for: None,
            ticks_since_computed: 0,
            repath_max_age_ticks: default_repath_max_age_ticks(),
        }
    }
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
