//! Deterministic work counters (feature `gen-counters`): cost only, never
//! output.
//!
//! The counters count work that depends only on what is generated, never
//! on the machine: noise octaves, field columns, lattice nodes, voxels
//! written, cache misses (with every cache at a fixed capacity). The budget
//! gate compares their per-chunk median and p95 against
//! `crates/gen/budgets/<preset>.json` on every CI run, on any machine,
//! naming the counter that grew.
//!
//! Counters are per thread: a chunk job resets them, generates, and reads
//! a [`snapshot`]. Without the feature every call compiles to nothing.

/// One counted kind of work.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Counter {
    /// 2D noise octaves evaluated.
    NoiseOctaves2d,
    /// Columns run through a stage program.
    FieldColumns,
    /// Strided lattice nodes evaluated.
    LatticeNodes,
    /// Macro tiles computed (cache misses).
    MacroTileMisses,
    /// Facts computed (facts cache misses, point grids included).
    FactsBuilt,
    /// Point-query column grids built.
    PointColumns,
    /// Voxels written by the run writer (terrain and water).
    VoxelsWritten,
    /// Tree voxels stamped.
    TreeVoxels,
    /// Trees placed.
    Trees,
}

impl Counter {
    /// Every counter, in report order.
    pub const ALL: [Counter; 9] = [
        Counter::NoiseOctaves2d,
        Counter::FieldColumns,
        Counter::LatticeNodes,
        Counter::MacroTileMisses,
        Counter::FactsBuilt,
        Counter::PointColumns,
        Counter::VoxelsWritten,
        Counter::TreeVoxels,
        Counter::Trees,
    ];

    /// The counter's report name.
    pub fn name(self) -> &'static str {
        match self {
            Counter::NoiseOctaves2d => "noise_octaves_2d",
            Counter::FieldColumns => "field_columns",
            Counter::LatticeNodes => "lattice_nodes",
            Counter::MacroTileMisses => "macro_tile_misses",
            Counter::FactsBuilt => "facts_built",
            Counter::PointColumns => "point_columns",
            Counter::VoxelsWritten => "voxels_written",
            Counter::TreeVoxels => "tree_voxels",
            Counter::Trees => "trees",
        }
    }
}

#[cfg(feature = "gen-counters")]
mod imp {
    use super::Counter;
    use std::cell::Cell;

    thread_local! {
        static COUNTS: [Cell<u64>; 9] = Default::default();
    }

    #[inline]
    pub fn bump(c: Counter, n: u64) {
        COUNTS.with(|a| {
            let cell = &a[c as usize];
            cell.set(cell.get() + n);
        });
    }

    pub fn reset() {
        COUNTS.with(|a| a.iter().for_each(|c| c.set(0)));
    }

    pub fn snapshot() -> [u64; 9] {
        COUNTS.with(|a| {
            let mut out = [0u64; 9];
            for (o, c) in out.iter_mut().zip(a.iter()) {
                *o = c.get();
            }
            out
        })
    }
}

#[cfg(not(feature = "gen-counters"))]
mod imp {
    use super::Counter;

    #[inline(always)]
    pub fn bump(_: Counter, _: u64) {}

    pub fn reset() {}

    pub fn snapshot() -> [u64; 9] {
        [0; 9]
    }
}

/// Add `n` to counter `c` on this thread (nothing without the feature).
#[inline(always)]
pub fn bump(c: Counter, n: u64) {
    imp::bump(c, n);
}

/// Zero this thread's counters.
pub fn reset() {
    imp::reset();
}

/// This thread's counters, indexed like [`Counter::ALL`].
pub fn snapshot() -> [u64; 9] {
    imp::snapshot()
}

/// Whether counting is compiled in.
pub const ENABLED: bool = cfg!(feature = "gen-counters");
