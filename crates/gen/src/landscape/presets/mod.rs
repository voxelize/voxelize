//! Built-in presets, the standard roles and the demo block pack.
//!
//! Rust is the source of truth: a preset is a function of [`Knobs`] that
//! returns a [`LandscapeSpec`], built only from library kinds. Its JSON
//! twin (`presets/<name>.json`, written by `examples/export_preset.rs`
//! through the canonical writer) hashes identically; games copy the JSON
//! and edit or merge-patch it.
//!
//! - [`plain::plain_landscape`] (`voxelize.plain`): the heightfield core
//!   with no landforms: continents, a routed relief, medium wear, climate,
//!   biomes, paint, groves and the sea.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::spec::{Height, SpawnSearch, SpawnSpec};

pub mod demo_blocks;
pub mod plain;
pub mod roles;

pub use demo_blocks::{demo_blocks, DemoKind, DEMO_PACK};
pub use plain::plain_landscape;
pub use roles::{standard_roles, RoleBinding};

/// The knobs a preset is a function of.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Knobs {
    /// World height; must equal `WorldConfig::max_height`. Tuned at 512.
    pub height: u32,
    /// Sea level.
    pub sea: Height,
    /// The scale knob, 0.5..=2.0: `Span` sizes times s, relief times
    /// `min(1, sqrt s)`, `Blocks` sizes fixed.
    pub scale: f64,
    /// Per-node enable flags (landform presets).
    pub landforms: BTreeMap<String, bool>,
    /// Roll multipliers (landform presets).
    pub rarity: BTreeMap<String, f64>,
    /// Hero placements near spawn (landform presets).
    pub showcase: bool,
    /// Where players arrive.
    pub spawn: SpawnSpec,
}

impl Default for Knobs {
    fn default() -> Self {
        Self {
            height: 512,
            sea: Height::ShareOfWorld(0.168),
            scale: 1.0,
            landforms: BTreeMap::new(),
            rarity: BTreeMap::new(),
            showcase: true,
            spawn: SpawnSpec::Search(SpawnSearch {
                origin: (0, 0),
                max_radius: 3072,
                stride: 32,
                ground: (Height::AboveSea(3.0), Height::AboveSea(40.0)),
                max_slope: 0.35,
                temperature: (0.40, 0.75),
                moisture: (0.35, 0.80),
                coast_within: Some(1500),
                clear_radius: 256,
            }),
        }
    }
}

impl Knobs {
    /// Knobs for tests: the defaults at a smaller height, which keeps the
    /// voxel work small while every share-based recipe stays in proportion.
    pub fn test() -> Self {
        Self {
            height: 256,
            ..Self::default()
        }
    }
}
