//! `landscape`: the terrain and structure generator (spec format 2).
//!
//! **Unstable.** This module compiles only with the non-default
//! `unstable-landscape` feature until its design is frozen; nothing that
//! builds `voxelize-gen` without that feature compiles or links any of it.
//! The design lives in `crates/gen/docs/landscape.md`.
//!
//! **Plugins and composition**: the five plugin kinds ([`Landform`],
//! [`RegionSolver`], [`Province`], [`Surfacer`] and [`SiteSet`]) acquire
//! every input as a typed handle from [`BuildCtx`], which records the
//! planner [`Dag`]; instances live in a spatial index and are dispatched
//! once per chunk with a masked [`ColumnBatch`]; ground ops are one-sided
//! soft clamps faded by an engine-computed footprint edge, and claims carry
//! continuous weights ([`compose`]).
//!
//! **The heightfield core**: a [`LandscapeSpec`] (owned
//! data, read strictly from JSON with correctly rounded numbers, written
//! canonically, merge-patchable) compiles against a [`KindRegistry`], a
//! game's [`RoleBinding`] and the block registry into an immutable
//! [`Landscape`]. Named fields compile into hash-consed stage programs
//! with range, bandwidth and Lipschitz analyses and compile-time taste
//! guards; every chunk gets one [`ChunkFacts`] record (structure of arrays
//! with a halo, kept in a byte-capped cache); surfacers paint material
//! runs; the implicit sea is water as data; the run writer fills the chunk
//! in one pass and keeps the engine's height watermark. Point queries read
//! the same facts, and [`QualityReport`] measures cut-ness and spectrum in
//! both directions. The `plain` preset exercises all of it.
//!
//! - [`spec`], [`json`], [`canon`], [`mirror`], [`lower`]: the spec, its
//!   number path, owned mirrors of v1 configs and their lowering;
//! - [`fields`]: the field compiler, evaluator and grid;
//! - [`facts`], [`stage`], [`query`], [`explain`]: per-chunk facts, the
//!   engine stage and run writer, public queries, provenance;
//! - [`surface`], [`library`], [`water`], [`flora`]: paint, the built-in
//!   surfacers, the sea, trees;
//! - [`plugin`], [`build`], [`registry`], [`dag`], [`compose`], [`index`],
//!   [`plan`], [`volume`]: the plugin kinds, typed handles, the kind
//!   registry, the planner DAG and composition order, the composition
//!   contract, the plan index and dispatch, planning with budgets, and the
//!   province volume;
//! - [`identity`]: identity persisted next to the chunks;
//! - [`quality`], [`counters`]: taste and cost as numbers;
//! - [`presets`]: the `plain` preset, the standard roles, the demo blocks.
//!
//! The kernel toolkits every layer builds on:
//!
//! - [`math`]: bit-stable scalar math (`pow_smooth` with its analytic
//!   derivative, `psin`/`pcos`, the diamond angle, ring noise, smooth
//!   min/max, the rational soft ceiling, the one-sided soft clamps that are
//!   the identity wherever the target equals the ground, and [`MinMax`],
//!   the float minimum and maximum with one rule on every platform);
//! - [`profile`]: C1 cross-sections with analytic slopes and inverses
//!   (walls, cones, sea-cliff faces, caldera S-walls, slot sections, dune
//!   waves);
//! - [`strata`]: wandering absolute-height bands that bench a wall without
//!   ever inverting its slope, continuous from column to column;
//! - [`geometry`]: footprints and fades, zero-line distance, iso-contour
//!   tracing, arc schedules, feature frames and conservative tile gates;
//! - [`lattice`]: world-aligned trilinear lattices with exact cell bounds,
//!   so culled evaluation equals unculled evaluation;
//! - [`network`]: channel networks, polylines with a payload per vertex;
//! - [`flood`]: lake spill floods and priority floods with synthetic
//!   divides;
//! - [`settle`]: fluid steady-state checks and pre-settling, run with the
//!   game's own fluid configuration;
//! - [`cache`]: `ClockCache`, the striped cost-only cache every tier uses;
//! - `kit` (feature `kit`): `assert_no_libm!`, the determinism suite and
//!   the writer's height-map check, for game crates too.
//!
//! Every value is a pure function of its inputs, and all arithmetic under
//! this module is IEEE add, sub, mul, div, sqrt, floor, abs, comparisons and
//! selects: no platform maths library, no fused multiply-add, and no
//! `f64::max`/`f64::min` (which may return either zero for ±0.0; [`MinMax`]
//! picks by comparison instead). `tests/no_libm.rs` refuses all three, so
//! output is the same bits on every platform, down to the sign of a zero.
//!
//! [`MinMax`]: math::MinMax

// The kernels compare with `!(x > y)` where NaN must take the fallback
// branch; that is deliberate.
#![allow(clippy::neg_cmp_op_on_partial_ord)]
#![warn(missing_docs)]

pub mod build;
pub mod cache;
pub mod canon;
pub mod compile;
pub mod compose;
pub mod counters;
pub mod dag;
pub mod explain;
pub mod facts;
pub mod fields;
pub mod flood;
pub mod flora;
pub mod geometry;
pub mod identity;
pub mod index;
pub mod json;
#[cfg(feature = "kit")]
pub mod kit;
pub mod lattice;
pub mod library;
pub mod lower;
pub mod math;
pub mod mirror;
pub mod network;
pub mod plan;
pub mod plugin;
pub mod presets;
pub mod profile;
pub mod quality;
pub mod query;
pub mod registry;
pub mod settle;
pub mod spec;
pub mod stage;
pub mod strata;
pub mod surface;
pub mod volume;
pub mod water;

pub use build::{
    BuildCtx, ClaimReader, FactKey, FieldRef, Noise, NoiseSpec, PlanReader, ProbeReader,
    ProvinceHandle, RoleId, SpawnReader, Through,
};
pub use compile::{compile, compile_with, CompileOptions, Landscape};
pub use compose::{
    ClaimEntry, Claims, Col, ColumnBatch, ColumnClaims, ComposeLog, GroundOp, SolidSpan,
};
pub use dag::{Dag, DagEdge, DagNode};
pub use explain::ColumnExplain;
pub use facts::{BiomeCell, ChunkFacts, ColumnFact, Tier};
pub use identity::{Compat, DriftPolicy, IdentityFile, KindStamp, LandscapeIdentity, ENGINE_ALGO};
pub use index::{InstanceInfo, PlanStats};
pub use plan::{forbid_solves, ForbidSolves, ItemCtx, PlanCtx, Work, WorkMeter};
pub use plugin::{
    Effect, Fact, Landform, LatticeView, Layer, Layout, Planned, Province, RegionSolver, Reject,
    Site, SiteSet, TileId, TileLattice, TileSet, VoxelAt,
};
pub use presets::{Knobs, RoleBinding};
pub use quality::{QualityBands, QualityReport};
pub use query::{Query, SpawnOutcome, SpawnReport};
pub use registry::KindRegistry;
pub use spec::{
    merge_patch, read_spec, FieldDef, Height, LandscapeSpec, Size, SpecError, TasteGuards,
    WorldFrame, LANDSCAPE_FORMAT,
};
pub use stage::{install, LandscapeStage, ROOT_DEPTH};
pub use surface::{MaterialRuns, PaintColumn, PaintCtx, RoleBlock, Surfacer, ZoneKey};
pub use water::{WaterBodyId, WaterColumn, WaterHit, WaterKind, WaterLayer};

/// The names a game's landscape code reaches for.
pub mod prelude {
    pub use super::build::{
        BuildCtx, ClaimReader, FactKey, FieldRef, Noise, NoiseSpec, PlanReader, ProbeReader,
        ProvinceHandle, RoleId, SpawnReader, Through,
    };
    pub use super::compose::{Claims, Col, ColumnBatch, ColumnClaims, GroundOp};
    pub use super::fields::nodes::fx;
    pub use super::fields::{FieldExpr, NoiseM, TermRole};
    pub use super::geometry::{Aabb2, FadedFootprint, Footprint};
    pub use super::lattice::LatticeSpec;
    pub use super::math::{clamp01, smootherstep, smoothstep, MinMax};
    pub use super::plan::{PlanCtx, WorkMeter};
    pub use super::plugin::{
        Effect, Fact, Landform, LatticeView, Layer, Layout, Planned, Province, RegionSolver, Site,
        SiteSet, TileId, TileLattice, TileSet, VoxelAt,
    };
    pub use super::profile;
    pub use super::spec::{
        Domain, FieldDef, Height, LandscapeSpec, Resolution, Size, SpecError, Validate, Validator,
    };
    pub use super::surface::{MaterialRuns, PaintColumn, PaintCtx, RoleBlock, Surfacer, ZoneKey};
    // `compile` and `install` stay out: v1 has crate-root items of those
    // names, so a game globbing both preludes would get ambiguity errors.
    // Call them as `landscape::compile` and `landscape::install`.
    pub use super::{KindRegistry, Knobs, Landscape, RoleBinding, Tier};
}

use crate::stream::{stream_seed_lane, FIRST_LAYER_LANE};

/// The seed lanes of the landscape layer: one per subsystem, each split
/// into a plan stream and a build stream.
///
/// They continue past v1's `Subsystem` lanes (which stop below
/// [`FIRST_LAYER_LANE`]) through `stream_seed_lane`, so v1's public enum
/// gains no variant. A subsystem's plan lane is its value and its build
/// lane is that value with the top bit set ([`SeedPhase::Build`]), so the
/// draws that decide where a feature goes and the draws that shape its
/// voxels never share a stream, whatever salts they use. Order is
/// identity: each lane number is hashed into every seed it derives, so the
/// values are written out and pinned by tests.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SeedLane {
    /// Landform plans and their columns.
    Landforms = 6,
    /// Water bodies, region solvers and aquifers.
    Water = 7,
    /// Site sets: siting, fits and pieces.
    Sites = 8,
    /// 3D provinces and their lattices.
    Volume = 9,
    /// The spawn search.
    Spawn = 10,
}

const _: () = assert!(SeedLane::Landforms as u8 == FIRST_LAYER_LANE);

/// Which stream of a lane a seed comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum SeedPhase {
    /// Planning: placement, routing, solves.
    Plan = 0,
    /// Building: per-column and per-voxel detail.
    Build = 0x80,
}

impl SeedLane {
    /// Every lane, in id order.
    pub const ALL: [SeedLane; 5] = [
        SeedLane::Landforms,
        SeedLane::Water,
        SeedLane::Sites,
        SeedLane::Volume,
        SeedLane::Spawn,
    ];

    /// The lane number hashed into seeds of `phase`.
    pub const fn id(self, phase: SeedPhase) -> u8 {
        self as u8 | phase as u8
    }

    /// The five-component seed `{world, dimension, lane, salt, cell}` of
    /// this lane's `phase` stream.
    pub fn seed(
        self,
        phase: SeedPhase,
        world_seed: u32,
        dimension: &str,
        salt: &[u8],
        cell: u64,
    ) -> u64 {
        stream_seed_lane(world_seed, dimension, self.id(phase), salt, cell)
    }
}
