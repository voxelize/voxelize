//! Built-in kinds. They register exactly as a game's own kinds do.
//!
//! This phase ships the surfacers; the landforms, region solvers, provinces
//! and site sets join from P3 on.

pub mod ecotones;
pub mod surface_rules;
pub mod zones;

pub use ecotones::{CliffM, Ecotones, EcotonesParams, PatchM, RockLineM, SnowM, TalusM};
pub use surface_rules::{PaintCondM, PaintRuleM, SurfaceRules, SurfaceRulesParams};
pub use zones::{ZonePaintM, Zones, ZonesParams};
