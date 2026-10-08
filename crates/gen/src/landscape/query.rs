//! Public queries on a [`Landscape`].
//!
//! Point queries stay cheap and exact: they read the facts cache first
//! (O(1) for generated chunks), then a bounded column cache, and on a cold
//! miss build one column's facts through the same code as a chunk
//! (composing the landforms that touch it), so a point answer equals the
//! chunk's bit for bit. `column_ground` composes one column without the
//! slope stencil. A tier below `Tier::Full` composes only the layers up to
//! it. `*_if_ready` queries never compute: they answer from the caches or
//! return `Query::Pending`, so a game's tick systems can ask without ever
//! paying for generation (or solving a plan).
//!
//! **Spawn** is the engine node `engine.spawn`: candidates in a fixed
//! spiral are tested against ground composed through every node below the
//! Water layer that does not read the spawn anchor (directly or through
//! its inputs), and the first that passes is verified through the Detail
//! layer: dry, calm, and with no ROCK, HYDRO or NO_SITES claim.

use std::sync::Arc;

use voxelize::Vec2;

use super::compose::Claims;
use super::counters::{bump, Counter};
use super::facts::{ColumnFact, Tier};
use super::fields::Area;
use super::math::unit_dir;
use super::spec::SpawnSpec;
use super::water::{hit_in, WaterColumn, WaterHit};
use super::Landscape;

/// How the spawn column was chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpawnOutcome {
    /// `SpawnSpec::Fixed`.
    Fixed,
    /// The search found a column passing every test, after `tested`
    /// candidates.
    Found {
        /// Candidates tested, this one included.
        tested: u32,
    },
    /// No candidate within `max_radius` passed; spawn fell back to the
    /// search origin, which may be wet, steep or outside the windows.
    Fallback {
        /// Candidates tested.
        tested: u32,
    },
}

/// The spawn column and how it was chosen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpawnReport {
    /// The column.
    pub column: (i32, i32),
    /// How it was chosen.
    pub outcome: SpawnOutcome,
}

/// An answer that may not be ready without computing.
#[derive(Clone, Debug, PartialEq)]
pub enum Query<T> {
    /// The answer.
    Ready(T),
    /// Not cached; ask the computing query off the tick thread.
    Pending,
}

impl Landscape {
    fn chunk_of(&self, x: i32, z: i32) -> (i32, i32) {
        (x.div_euclid(self.chunk_size), z.div_euclid(self.chunk_size))
    }

    fn cached_column(&self, x: i32, z: i32) -> Option<Arc<ColumnFact>> {
        if let Some(f) = self.facts_cache.get(&self.chunk_of(x, z)) {
            if let Some(c) = f.column(x, z, &self.sea) {
                return Some(Arc::new(c));
            }
        }
        self.columns.get(&(x, z))
    }

    pub(crate) fn column_arc(&self, x: i32, z: i32) -> Arc<ColumnFact> {
        if let Some(c) = self.cached_column(x, z) {
            return c;
        }
        bump(Counter::PointColumns, 1);
        let f = self.build_facts((x, z), 1, 0);
        let c = Arc::new(f.column(x, z, &self.sea).expect("the built column"));
        self.columns.insert((x, z), c)
    }

    /// One column's facts at `tier`: the full pipeline's state after the
    /// tier's last layer (the final state for `Tier::Full`).
    pub fn column(&self, x: i32, z: i32, tier: Tier) -> ColumnFact {
        let set = self.tier_set(tier);
        if set.all {
            return (*self.column_arc(x, z)).clone();
        }
        bump(Counter::PointColumns, 1);
        self.build_facts_in((x, z), 1, 0, set)
            .column(x, z, &self.sea)
            .expect("the built column")
    }

    /// One column's facts at `tier` if cached; never computes (a tier
    /// below the final state is never cached).
    pub fn column_if_ready(&self, x: i32, z: i32, tier: Tier) -> Query<ColumnFact> {
        if !self.tier_set(tier).all {
            return Query::Pending;
        }
        match self.cached_column(x, z) {
            Some(c) => Query::Ready((*c).clone()),
            None => Query::Pending,
        }
    }

    /// Ground at one column at `tier`, composed alone (no slope stencil),
    /// after the floor and the ceiling.
    pub fn column_ground(&self, x: i32, z: i32, tier: Tier) -> f64 {
        let set = self.tier_set(tier);
        if set.all {
            if let Some(c) = self.cached_column(x, z) {
                return c.ground;
            }
        }
        bump(Counter::PointColumns, 1);
        self.finish_ground(self.compose_point(set, x, z))
    }

    /// Final ground over a window, sampled every `stride` columns: `w x d`
    /// samples at `(x0 + i * stride, z0 + j * stride)`, x fastest. Rows are
    /// evaluated on scoped threads; each sample is a pure function of its
    /// column, so the result never depends on the thread count.
    pub fn ground_window(&self, x0: i32, z0: i32, w: usize, d: usize, stride: i32) -> Vec<f64> {
        let mut out = vec![0.0f64; w * d];
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 16);
        let band = Ord::max(d.div_ceil(threads), 1);
        std::thread::scope(|scope| {
            for (b, rows) in out.chunks_mut(band * w).enumerate() {
                scope.spawn(move || {
                    let j0 = b * band;
                    let nrows = rows.len() / w;
                    if stride == 1 {
                        // Whole rows of columns in tiles of 64 x nrows.
                        let mut i0 = 0usize;
                        while i0 < w {
                            let tw = Ord::min(64, w - i0);
                            let area = Area {
                                x0: x0 + i0 as i32,
                                z0: z0 + j0 as i32,
                                w: tw,
                                d: nrows,
                            };
                            let grid = self.fields.evaluate(area, 0, &self.tiles);
                            let mut g = Vec::with_capacity(area.len());
                            for jj in 0..nrows {
                                for ii in 0..tw {
                                    let (x, z) = (area.x0 + ii as i32, area.z0 + jj as i32);
                                    g.push(grid.output(self.slots.ground, x, z));
                                }
                            }
                            let d = self.dispatch(area, &self.all_nodes);
                            if !d.is_empty() {
                                g = self.compose(area, g, &d, None).ground;
                            }
                            for jj in 0..nrows {
                                for ii in 0..tw {
                                    rows[jj * w + i0 + ii] = self.finish_ground(g[jj * tw + ii]);
                                }
                            }
                            i0 += tw;
                        }
                    } else {
                        for jj in 0..nrows {
                            for i in 0..w {
                                let x = x0 + i as i32 * stride;
                                let z = z0 + (j0 + jj) as i32 * stride;
                                rows[jj * w + i] =
                                    self.finish_ground(self.compose_point(&self.all_nodes, x, z));
                            }
                        }
                    }
                });
            }
        });
        out
    }

    /// Column facts over a window, sampled every `stride` columns, on
    /// scoped threads (pure per column).
    pub fn columns_window(
        &self,
        x0: i32,
        z0: i32,
        w: usize,
        d: usize,
        stride: i32,
    ) -> Vec<ColumnFact> {
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 16);
        let rows: Vec<usize> = (0..d).collect();
        let band = Ord::max(d.div_ceil(threads), 1);
        let mut parts: Vec<Vec<ColumnFact>> = Vec::new();
        std::thread::scope(|scope| {
            let handles: Vec<_> = rows
                .chunks(band)
                .map(|js| {
                    let js = js.to_vec();
                    scope.spawn(move || {
                        let mut v = Vec::with_capacity(js.len() * w);
                        for j in js {
                            for i in 0..w {
                                let x = x0 + i as i32 * stride;
                                let z = z0 + j as i32 * stride;
                                if stride == 1 {
                                    let f = self.chunk_facts(Vec2(
                                        x.div_euclid(self.chunk_size),
                                        z.div_euclid(self.chunk_size),
                                    ));
                                    v.push(f.column(x, z, &self.sea).expect("stored"));
                                } else {
                                    v.push(
                                        self.build_facts((x, z), 1, 0)
                                            .column(x, z, &self.sea)
                                            .expect("built"),
                                    );
                                }
                            }
                        }
                        v
                    })
                })
                .collect();
            for h in handles {
                parts.push(h.join().expect("a window band"));
            }
        });
        parts.into_iter().flatten().collect()
    }

    /// The water layers of a column.
    pub fn water_at(&self, x: i32, z: i32) -> WaterColumn {
        self.column_arc(x, z).water.clone()
    }

    /// The water layers of a column if cached; never computes.
    pub fn water_if_ready(&self, x: i32, z: i32) -> Query<WaterColumn> {
        match self.cached_column(x, z) {
            Some(c) => Query::Ready(c.water.clone()),
            None => Query::Pending,
        }
    }

    /// The fluid at a voxel, if any.
    pub fn fluid_at(&self, x: i32, y: i32, z: i32) -> Option<WaterHit> {
        hit_in(&self.column_arc(x, z).water, y)
    }

    /// The spawn column (searched once, then fixed).
    pub fn spawn(&self) -> (i32, i32) {
        self.spawn_report().column
    }

    /// The spawn column and how it was chosen: a `Fallback` means the
    /// search's windows found nothing within its radius.
    pub fn spawn_report(&self) -> SpawnReport {
        *self.spawn.get_or_init(|| self.search_spawn())
    }

    /// The spawn voxel: `(x, final top + 1, z)`.
    pub fn spawn_point(&self) -> (i32, i32, i32) {
        let (x, z) = self.spawn();
        (x, self.column_arc(x, z).top + 1, z)
    }

    fn search_spawn(&self) -> SpawnReport {
        let s = match &self.spec.spawn {
            SpawnSpec::Fixed { x, z } => {
                return SpawnReport {
                    column: (*x, *z),
                    outcome: SpawnOutcome::Fixed,
                }
            }
            SpawnSpec::Search(s) => s,
        };
        let lo = self.frame.resolve(s.ground.0);
        let hi = self.frame.resolve(s.ground.1);
        let rings = s.max_radius / s.stride;
        let mut tested = 0u32;
        // The shape search composes every ground writer below the Water
        // layer, the verification every writer through Detail, both without
        // spawn readers (which keep clear of spawn) and their dependents.
        let shape = |x: i32, z: i32| -> Arc<ColumnFact> {
            if self.spawn_shape.all {
                self.column_arc(x, z)
            } else {
                Arc::new(
                    self.build_facts_in((x, z), 1, 0, &self.spawn_shape)
                        .column(x, z, &self.sea)
                        .expect("the built column"),
                )
            }
        };
        let verify = |x: i32, z: i32, shaped: &Arc<ColumnFact>| -> bool {
            let c = if self.spawn_verify == self.spawn_shape {
                shaped.clone()
            } else if self.spawn_verify.all {
                self.column_arc(x, z)
            } else {
                Arc::new(
                    self.build_facts_in((x, z), 1, 0, &self.spawn_verify)
                        .column(x, z, &self.sea)
                        .expect("the built column"),
                )
            };
            let banned = Claims::ROCK | Claims::HYDRO | Claims::NO_SITES;
            c.water.is_dry()
                && c.slope <= s.max_slope
                && !c
                    .claims
                    .iter()
                    .any(|e| banned.0 & (1 << e.bit) != 0 && e.weight > 0.0)
        };
        for k in 0..=rings {
            for (dx, dz) in ring(k) {
                tested += 1;
                let x = s.origin.0 + dx * s.stride;
                let z = s.origin.1 + dz * s.stride;
                let c = shape(x, z);
                let top = c.top as f64;
                if top < lo || top > hi || !c.water.is_dry() || c.slope > s.max_slope {
                    continue;
                }
                if c.temperature < s.temperature.0
                    || c.temperature > s.temperature.1
                    || c.moisture < s.moisture.0
                    || c.moisture > s.moisture.1
                {
                    continue;
                }
                if let Some(r) = s.coast_within {
                    if !self.sea_within(x, z, r) {
                        continue;
                    }
                }
                if !verify(x, z, &c) {
                    continue;
                }
                return SpawnReport {
                    column: (x, z),
                    outcome: SpawnOutcome::Found { tested },
                };
            }
        }
        SpawnReport {
            column: s.origin,
            outcome: SpawnOutcome::Fallback { tested },
        }
    }

    /// Whether open sea lies within `r` blocks, probed along 16 rays every
    /// 64 blocks.
    fn sea_within(&self, x: i32, z: i32, r: i32) -> bool {
        let sea = self.frame.sea as f64;
        let mut d = 64;
        while d <= r {
            for i in 0..16 {
                let (ux, uz) = unit_dir(i, 16);
                let px = x + (ux * d as f64).floor() as i32;
                let pz = z + (uz * d as f64).floor() as i32;
                let g = if self.spawn_shape.all {
                    self.column_ground(px, pz, Tier::Full)
                } else {
                    self.finish_ground(self.compose_point(&self.spawn_shape, px, pz))
                };
                if g < sea - 2.0 {
                    return true;
                }
            }
            d += 64;
        }
        false
    }
}

/// The candidates of spiral ring `k` in a fixed order: the origin for 0,
/// then the square perimeter clockwise from the north-west corner.
fn ring(k: i32) -> Vec<(i32, i32)> {
    if k == 0 {
        return vec![(0, 0)];
    }
    let mut v = Vec::with_capacity(8 * k as usize);
    for x in -k..k {
        v.push((x, -k));
    }
    for z in -k..k {
        v.push((k, z));
    }
    for x in (-k + 1..=k).rev() {
        v.push((x, k));
    }
    for z in (-k + 1..=k).rev() {
        v.push((-k, z));
    }
    v
}
