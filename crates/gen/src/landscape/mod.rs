//! `landscape`: the terrain and structure generator (spec format 2).
//!
//! **Unstable.** This module compiles only with the non-default
//! `unstable-landscape` feature until its design is frozen; nothing that
//! builds `voxelize-gen` without that feature compiles or links any of it.
//! The design lives in `crates/gen/docs/landscape.md`.
//!
//! This phase holds the kernel toolkits every later layer builds on:
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
//! - [`cache`]: `ClockCache`, the cost-only cache every tier uses;
//! - `kit` (feature `kit`): `assert_no_libm!`, the bit-stability scan for
//!   game crates.
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

pub mod cache;
pub mod flood;
pub mod geometry;
#[cfg(feature = "kit")]
pub mod kit;
pub mod lattice;
pub mod math;
pub mod network;
pub mod profile;
pub mod settle;
pub mod strata;

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
