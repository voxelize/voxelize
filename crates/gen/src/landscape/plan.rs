//! Planning: `PlanCtx`, deterministic work budgets, scoped parallel maps
//! and tick safety.
//!
//! **Plans are pure.** A Cells plan is a function of (seed, dimension,
//! salt, cell) and of what the node acquired: fields, composed ground
//! upstream (probes), other nodes' plans and occupancy, the spawn anchor.
//! Plans are cached per node behind `OnceLock` cells, so a plan solves at
//! most once while it stays resident, and threads racing on a cold cell
//! wait for the one solve. A strict DAG means a solve only ever waits on
//! solves of nodes it depends on, so no wait cycle can form.
//!
//! **Budgets are semantic.** [`WorkMeter`] counts deterministic steps
//! (probe calls, trace steps, flood cells) against `spec.budgets`; a plan
//! that exceeds them is rejected (`Reject::Budget`) and counted, and the
//! budgets are part of the spec hash. Under [`PlanCtx::par_map`] every item
//! has its own meter and its own budget, so which step trips a budget
//! never depends on scheduling; after the join the item counts are summed
//! in index order and the plan budget is checked.
//!
//! **Tick safety.** `let _g = forbid_solves();` marks a scope (a game's
//! tick systems) where no plan may solve: a solve inside it panics in
//! debug builds and wherever the `kit` feature is on, so a cold read on
//! the tick thread becomes a test failure.

use std::cell::Cell;
use std::marker::PhantomData;
use std::sync::Arc;

use super::build::{ClaimReader, FieldRef, PlanReader, ProbeReader, SpawnReader};
use super::compose::Claims;
use super::geometry::{Aabb2, Footprint};
use super::math::MinMax;
use super::plugin::{Landform, Reject, Site};
use super::spec::{PlanBudgets, WorldFrame};
use super::Landscape;
use crate::stream::{fnv1a_64, mix64, HashStream};

/// A kind of deterministic planning work.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Work {
    /// Exact probes of composed ground.
    ProbeCalls = 0,
    /// Steps of a trace (a channel, a contour).
    TraceSteps = 1,
    /// Cells of a flood.
    FloodCells = 2,
}

/// Counts deterministic planning work against a budget.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkMeter {
    counts: [u64; 3],
    limits: [u64; 3],
    exceeded: bool,
}

impl WorkMeter {
    /// A meter with these limits (probe calls, trace steps, flood cells).
    pub fn new(limits: [u64; 3]) -> Self {
        Self {
            counts: [0; 3],
            limits,
            exceeded: false,
        }
    }

    /// A meter with the spec's plan budgets.
    pub fn from_budgets(b: &PlanBudgets) -> Self {
        Self::new([b.probe_calls, b.trace_steps, b.flood_cells])
    }

    /// Count `n` steps of `w`; `Err(Reject::Budget)` once the budget is
    /// exceeded (and on every later step).
    pub fn step(&mut self, w: Work, n: u64) -> Result<(), Reject> {
        let c = &mut self.counts[w as usize];
        *c = c.saturating_add(n);
        if *c > self.limits[w as usize] {
            self.exceeded = true;
        }
        if self.exceeded {
            Err(Reject::Budget)
        } else {
            Ok(())
        }
    }

    /// Steps of `w` so far.
    pub fn count(&self, w: Work) -> u64 {
        self.counts[w as usize]
    }

    /// Whether any budget was exceeded.
    pub fn exceeded(&self) -> bool {
        self.exceeded
    }

    fn absorb(&mut self, other: &WorkMeter) {
        for w in [Work::ProbeCalls, Work::TraceSteps, Work::FloodCells] {
            let _ = self.step(w, other.count(w));
        }
    }
}

thread_local! {
    static FORBID: Cell<u32> = const { Cell::new(0) };
}

/// A scope in which no plan may solve (see [`forbid_solves`]).
#[must_use = "solves are forbidden only while the guard lives"]
pub struct ForbidSolves {
    _not_send: PhantomData<*const ()>,
}

impl Drop for ForbidSolves {
    fn drop(&mut self) {
        FORBID.with(|f| f.set(f.get() - 1));
    }
}

/// Forbid plan and tile solves on this thread while the guard lives: a
/// solve inside panics in debug builds and wherever the `kit` feature is
/// on (game tests), and is counted otherwise. `*_if_ready` queries never
/// solve.
pub fn forbid_solves() -> ForbidSolves {
    FORBID.with(|f| f.set(f.get() + 1));
    ForbidSolves {
        _not_send: PhantomData,
    }
}

/// Called before every plan or tile solve.
pub(crate) fn solve_allowed(what: &dyn Fn() -> String) {
    if FORBID.with(|f| f.get()) > 0 {
        if cfg!(any(debug_assertions, feature = "kit")) {
            panic!("a plan solved inside forbid_solves(): {}", what());
        }
        super::counters::bump(super::counters::Counter::ForbiddenSolves, 1);
    }
}

/// The plan stream key of a cell.
pub(crate) fn cell_key(cell: (i32, i32)) -> u64 {
    ((cell.0 as u32 as u64) << 32) | cell.1 as u32 as u64
}

/// What a plan (or region tile) solve may read.
pub struct PlanCtx<'a> {
    pub(crate) land: &'a Landscape,
    pub(crate) node: u16,
    pub(crate) site: Site,
    pub(crate) meter: WorkMeter,
}

impl<'a> PlanCtx<'a> {
    pub(crate) fn new(land: &'a Landscape, node: u16, site: Site) -> Self {
        Self {
            land,
            node,
            site,
            meter: WorkMeter::from_budgets(&land.spec.budgets),
        }
    }

    /// The world frame.
    pub fn frame(&self) -> &WorldFrame {
        &self.land.frame
    }

    /// The site being solved.
    pub fn site(&self) -> Site {
        self.site
    }

    /// The id of the node being solved.
    pub fn node_id(&self) -> &str {
        &self.land.node(self.node).id
    }

    /// A named field at the column holding `(x, z)`.
    pub fn field(&mut self, f: FieldRef, x: f64, z: f64) -> f64 {
        self.land.field_at(f, x.floor() as i32, z.floor() as i32)
    }

    /// A deterministic stream for this site, named `sub` (plan lane).
    pub fn stream(&self, sub: &str) -> HashStream {
        HashStream::new(mix64(self.site.seed ^ fnv1a_64(sub.as_bytes())))
    }

    /// Composed ground upstream at the column holding `(x, z)`, as
    /// `Col::ground` would see it (before the floor and ceiling). Counts
    /// one probe call; past the budget the plan is rejected.
    pub fn probe_exact(&mut self, p: &ProbeReader, x: f64, z: f64) -> f64 {
        let _ = self.meter.step(Work::ProbeCalls, 1);
        self.land
            .probe_ground(p.0, x.floor() as i32, z.floor() as i32)
    }

    /// The lowest of `n` exact probes on the circle of radius `r` about
    /// `c` (directions from the pinned unit table, `n` in {8, 16, 32}).
    pub fn probe_ring_min(&mut self, p: &ProbeReader, c: (f64, f64), r: f64, n: usize) -> f64 {
        let n = match n {
            0..=8 => 8,
            9..=16 => 16,
            _ => 32,
        };
        let mut lo = f64::INFINITY;
        for i in 0..n {
            let (ux, uz) = super::math::unit_dir(i as i64, n as u32);
            lo = lo.fmin(self.probe_exact(p, c.0 + ux * r, c.1 + uz * r));
        }
        lo
    }

    /// Whether any instance of the occupancy reader's nodes with plan
    /// claims `bits` has a footprint meeting `area` (bounding boxes, exact
    /// for two discs: conservative).
    pub fn claimed(&mut self, r: &ClaimReader, area: &Footprint, bits: Claims) -> bool {
        let b = area.bounds();
        for &node in &self.land.occupancy_sets[r.0 as usize] {
            for inst in self.land.node_instances(node, b) {
                if !inst.claims.intersects(bits) {
                    continue;
                }
                let Some(fp) = &inst.footprint else { continue };
                if overlaps(&fp.footprint, area) {
                    return true;
                }
            }
        }
        false
    }

    /// Plans of a landform node whose footprints meet `area`, in cell
    /// order.
    pub fn plans<K: Landform>(&mut self, r: &PlanReader<K>, area: Aabb2) -> Vec<Arc<K::Plan>> {
        self.land
            .node_instances(r.node, area)
            .into_iter()
            .filter_map(|i| i.plan.clone().downcast::<K::Plan>().ok())
            .collect()
    }

    /// The spawn column. The engine rejects this plan if its footprint
    /// comes within the reader's clearance of it.
    pub fn spawn(&mut self, _r: &SpawnReader) -> (i32, i32) {
        self.land.spawn()
    }

    /// This solve's work meter.
    pub fn meter(&mut self) -> &mut WorkMeter {
        &mut self.meter
    }

    /// Map `f` over `items` on scoped native threads, each item with its
    /// own meter and its own budget `per_item` (every work kind): an item
    /// that exceeds it ends with `Err(Reject::Budget)`. Results come back
    /// in index order; the item counts are summed into this solve's meter
    /// in index order, and `Err(Reject::Budget)` is returned if that
    /// exceeds the plan budget. Never calls rayon.
    pub fn par_map<T: Sync, R: Send>(
        &mut self,
        items: &[T],
        per_item: u64,
        f: impl Fn(&T, &mut ItemCtx<'_>) -> Result<R, Reject> + Sync,
    ) -> Result<Vec<Result<R, Reject>>, Reject> {
        let threads = Ord::max(1, Ord::min(self.land.planner_threads, items.len()));
        let land = self.land;
        let run = |item: &T| -> (Result<R, Reject>, WorkMeter) {
            let mut cx = ItemCtx {
                land,
                meter: WorkMeter::new([per_item; 3]),
            };
            let r = f(item, &mut cx);
            let r = if cx.meter.exceeded() {
                Err(Reject::Budget)
            } else {
                r
            };
            (r, cx.meter)
        };
        let mut slots: Vec<Option<(Result<R, Reject>, WorkMeter)>> =
            (0..items.len()).map(|_| None).collect();
        if threads == 1 {
            for (i, item) in items.iter().enumerate() {
                slots[i] = Some(run(item));
            }
        } else {
            let next = std::sync::atomic::AtomicUsize::new(0);
            let parts: Vec<Vec<(usize, (Result<R, Reject>, WorkMeter))>> =
                std::thread::scope(|s| {
                    let handles: Vec<_> = (0..threads)
                        .map(|_| {
                            s.spawn(|| {
                                let mut out = Vec::new();
                                loop {
                                    let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                    let Some(item) = items.get(i) else { break };
                                    out.push((i, run(item)));
                                }
                                out
                            })
                        })
                        .collect();
                    handles
                        .into_iter()
                        .map(|h| h.join().expect("a planner thread"))
                        .collect()
                });
            for part in parts {
                for (i, v) in part {
                    slots[i] = Some(v);
                }
            }
        }
        let mut out = Vec::with_capacity(items.len());
        for slot in slots {
            let (r, m) = slot.expect("every item ran");
            self.meter.absorb(&m);
            out.push(r);
        }
        if self.meter.exceeded() {
            return Err(Reject::Budget);
        }
        Ok(out)
    }
}

/// What one item of [`PlanCtx::par_map`] may read.
pub struct ItemCtx<'a> {
    land: &'a Landscape,
    meter: WorkMeter,
}

impl ItemCtx<'_> {
    /// A named field at the column holding `(x, z)`.
    pub fn field(&mut self, f: FieldRef, x: f64, z: f64) -> f64 {
        self.land.field_at(f, x.floor() as i32, z.floor() as i32)
    }

    /// Composed ground upstream at the column holding `(x, z)`; counts one
    /// probe call against this item's budget.
    pub fn probe_exact(&mut self, p: &ProbeReader, x: f64, z: f64) -> f64 {
        let _ = self.meter.step(Work::ProbeCalls, 1);
        self.land
            .probe_ground(p.0, x.floor() as i32, z.floor() as i32)
    }

    /// This item's meter.
    pub fn meter(&mut self) -> &mut WorkMeter {
        &mut self.meter
    }
}

/// Whether two footprints may overlap: bounding boxes, exact for two
/// discs.
pub(crate) fn overlaps(a: &Footprint, b: &Footprint) -> bool {
    if let (
        Footprint::Disc {
            center: ca,
            radius: ra,
        },
        Footprint::Disc {
            center: cb,
            radius: rb,
        },
    ) = (a, b)
    {
        let (dx, dz) = (ca.0 - cb.0, ca.1 - cb.1);
        let r = ra + rb;
        return dx * dx + dz * dz < r * r;
    }
    a.bounds().intersects(&b.bounds())
}
