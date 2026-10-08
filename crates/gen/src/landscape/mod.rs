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
//!   min/max, the rational soft ceiling, and the one-sided soft clamps that
//!   are the identity wherever the target equals the ground);
//! - [`profile`]: C1 cross-sections with analytic slopes and inverses
//!   (walls, cones, sea-cliff faces, caldera S-walls, slot sections, dune
//!   waves);
//! - [`strata`]: wandering absolute-height bands that bench a wall without
//!   ever inverting its slope;
//! - [`geometry`]: footprints and fades, zero-line distance, iso-contour
//!   tracing, arc schedules, feature frames and conservative tile gates;
//! - [`lattice`]: world-aligned trilinear lattices with exact cell bounds,
//!   so culled evaluation equals unculled evaluation;
//! - [`channels`]: polyline networks with a payload per vertex;
//! - [`flood`]: lake spill floods and priority floods with synthetic
//!   divides;
//! - [`settle`]: fluid steady-state checks and pre-settling, run with the
//!   game's own fluid configuration;
//! - [`cache`]: `ClockCache`, the cost-only cache every tier uses;
//! - `kit` (feature `kit`): `assert_no_libm!`, the bit-stability scan for
//!   game crates.
//!
//! Every value is a pure function of its inputs, and all arithmetic under
//! this module is IEEE add, sub, mul, div, sqrt, floor, abs, min and max
//! (`tests/no_libm.rs` refuses anything else), so output is the same bits
//! on every platform.

// The kernels compare with `!(x > y)` where NaN must take the fallback
// branch, and clamp with `max(a).min(b)`, which returns a bound for NaN where
// `clamp` would pass it through; both are deliberate.
#![allow(clippy::neg_cmp_op_on_partial_ord, clippy::manual_clamp)]

pub mod cache;
pub mod channels;
pub mod flood;
pub mod geometry;
#[cfg(feature = "kit")]
pub mod kit;
pub mod lattice;
pub mod math;
pub mod profile;
pub mod settle;
pub mod strata;

use crate::stream::{stream_seed_lane, FIRST_LAYER_LANE};

/// The seed lanes of the landscape layer.
///
/// They continue past v1's `Subsystem` lanes (which stop below
/// [`FIRST_LAYER_LANE`]) through `stream_seed_lane`, so v1's public enum
/// gains no variant. Order is identity: each value is hashed into every seed
/// its lane derives, so the values are written out and pinned by tests.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Lane {
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

const _: () = assert!(Lane::Landforms as u8 == FIRST_LAYER_LANE);

impl Lane {
    pub const ALL: [Lane; 5] = [
        Lane::Landforms,
        Lane::Water,
        Lane::Sites,
        Lane::Volume,
        Lane::Spawn,
    ];

    /// The lane number hashed into seeds.
    pub const fn id(self) -> u8 {
        self as u8
    }

    /// The five-component seed `{world, dimension, lane, salt, cell}`.
    pub fn seed(self, world_seed: u32, dimension: &str, salt: &[u8], cell: u64) -> u64 {
        stream_seed_lane(world_seed, dimension, self.id(), salt, cell)
    }
}
