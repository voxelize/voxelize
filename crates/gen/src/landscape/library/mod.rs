//! Built-in kinds. They register exactly as a game's own kinds do.
//!
//! The surfacers so far; the landforms, region solvers, provinces and site
//! sets join with the planner.

pub mod ecotones;
pub mod surface_rules;
pub mod zones;

pub use ecotones::{
    CliffParams, Ecotones, EcotonesParams, PatchParams, RockLineParams, SnowParams, TalusParams,
};
pub use surface_rules::{PaintCondM, PaintRuleM, SurfaceRules, SurfaceRulesParams};
pub use zones::{ZonePaintParams, Zones, ZonesParams};
