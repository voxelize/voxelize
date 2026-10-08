//! The spatial plan index and chunk-granular dispatch.
//!
//! Every enabled landform and region solver is a runtime node with its own
//! caches: plans per cell (`get_or_solve`, so a plan solves once while
//! resident), Field-layout dispatch tiles (admitted or not), and region
//! tiles. The **feature index** maps 512-block index cells to the
//! instances whose footprints meet them, so a chunk asks one or a few
//! cache entries what touches it: a chunk with no feature pays about a
//! microsecond.
//!
//! **Dispatch.** Each instance touching a chunk (or a point query's single
//! column) is called once with a masked [`ColumnBatch`]: the columns
//! inside its footprint (Cells, Once), or where its gate is positive
//! (Field), or every column (region solvers). A Field node's dispatch
//! tiles are admitted by a conservative bound of the gate (the maximum of
//! samples at stride 16 over the tile and a one-sample ring, plus the
//! gate's Lipschitz bound times `16/√2`), so admission never misses a
//! column where the gate is positive; tiles never fade anything.
//!
//! **Filtered composition.** Probes, tiers and the spawn search compose a
//! subset of the nodes. They look instances up node by node (never through
//! the all-node index, which would solve nodes outside the subset), so a
//! plan solve never waits on a node it does not depend on.
//!
//! [`ColumnBatch`]: super::compose::ColumnBatch

use std::any::Any;
use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use super::cache::ClockCache;
use super::compose::{BatchCtx, Claims, ComposeLog, ComposeState, InstanceLog, LazyFields};
use super::counters::{bump, Counter};
use super::fields::Area;
use super::geometry::{tile_gate_bound, Aabb2, FadedFootprint};
use super::math::smootherstep;
use super::plan::{cell_key, solve_allowed, PlanCtx};
use super::plugin::{Layer, Reject, Site, TileId};
use super::registry::{LayoutRt, NodeImp};
use super::{Landscape, SeedLane, SeedPhase};
use crate::stream::mix64;

/// Size of a feature-index cell, blocks.
pub const INDEX_CELL: i32 = 512;
/// Stride of the gate samples that admit a Field dispatch tile, blocks.
pub const GATE_STRIDE: i32 = 16;

/// A solved instance of a Cells or Once landform.
pub(crate) struct Instance {
    pub node: u16,
    pub rank: u16,
    pub cell: (i32, i32),
    pub footprint: Option<FadedFootprint>,
    pub bounds: Aabb2,
    pub claims: Claims,
    pub exclusive: bool,
    pub plan: Arc<dyn Any + Send + Sync>,
}

/// Plan outcomes of one node (cost and diagnostics; never output).
#[derive(Default)]
pub(crate) struct PlanCounts {
    pub solved: AtomicU64,
    pub planned: AtomicU64,
    pub budget: AtomicU64,
    pub bounds: AtomicU64,
    pub spawn: AtomicU64,
    pub no_footprint: AtomicU64,
}

/// One node's plan outcomes so far.
#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct PlanStats {
    /// Node id.
    pub node: String,
    /// Sites solved (cells that passed the roll).
    pub solved: u64,
    /// Solves that produced an instance.
    pub planned: u64,
    /// Plans rejected for exceeding a work budget.
    pub rejected_budget: u64,
    /// Plans rejected for leaving their cell plus reach.
    pub rejected_bounds: u64,
    /// Spawn readers' plans rejected for coming too close to spawn.
    pub rejected_spawn: u64,
    /// Plans rejected for declaring no footprint.
    pub rejected_no_footprint: u64,
}

type PlanCell = Arc<OnceLock<Option<Arc<Instance>>>>;
type TileCell = Arc<OnceLock<Arc<dyn Any + Send + Sync>>>;

/// One enabled ground writer (or inert site set), at run time.
pub(crate) struct NodeRt {
    pub idx: u16,
    pub id: String,
    pub kind: String,
    pub salt: String,
    pub layer: Layer,
    /// Composition rank (`u16::MAX` for nodes that write no ground).
    pub rank: u16,
    pub layout: LayoutRt,
    pub imp: NodeImp,
    pub field_plan: Option<Arc<dyn Any + Send + Sync>>,
    /// Field layouts: the gate's slot among the acquired fields (its
    /// `FieldRef` index) and its Lipschitz bound.
    pub gate: Option<(usize, f64)>,
    pub spawn_clear: Option<i32>,
    /// The landform's record type, when it keeps one.
    pub cell_type: Option<std::any::TypeId>,
    pub plans: ClockCache<(i32, i32), PlanCell>,
    pub admit: ClockCache<(i32, i32), bool>,
    pub tiles: ClockCache<(i32, i32), TileCell>,
    pub counts: PlanCounts,
}

/// A set of nodes (by index); `all` when it holds every ground writer.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub(crate) struct NodeSet {
    bits: Vec<u64>,
    pub all: bool,
}

impl NodeSet {
    pub fn from_nodes(nodes: &[u16], all: bool) -> Self {
        let mut s = NodeSet {
            bits: Vec::new(),
            all,
        };
        for &n in nodes {
            let w = n as usize / 64;
            if s.bits.len() <= w {
                s.bits.resize(w + 1, 0);
            }
            s.bits[w] |= 1 << (n % 64);
        }
        s
    }

    #[inline]
    pub fn contains(&self, n: u16) -> bool {
        self.bits
            .get(n as usize / 64)
            .is_some_and(|w| w & (1 << (n % 64)) != 0)
    }

    pub fn is_empty(&self) -> bool {
        self.bits.iter().all(|w| *w == 0)
    }
}

/// What the feature index holds per index cell.
#[derive(Clone)]
pub(crate) enum IndexEntry {
    Planned(Arc<Instance>),
    /// A Field node and its admitted dispatch tiles in the index cell.
    Field(u16, Vec<(i32, i32)>),
}

/// One call of composition: an instance, a Field node or a region solver.
#[derive(Clone)]
pub(crate) enum Dispatch {
    Planned(Arc<Instance>),
    Field(u16),
    Region(u16),
}

impl Dispatch {
    fn key(&self, land: &Landscape) -> (u16, i32, i32) {
        match self {
            Dispatch::Planned(i) => (i.rank, i.cell.0, i.cell.1),
            Dispatch::Field(n) | Dispatch::Region(n) => (
                land.nodes[*n as usize].as_ref().unwrap().rank,
                i32::MIN,
                i32::MIN,
            ),
        }
    }
}

/// Public facts about one instance.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct InstanceInfo {
    /// Node id.
    pub node: String,
    /// Kind key.
    pub kind: String,
    /// Layer name.
    pub layer: String,
    /// The plan cell (`(0, 0)` for a Once plan).
    pub cell: (i32, i32),
    /// Footprint bounds `(min_x, min_z, max_x, max_z)`.
    pub bounds: (f64, f64, f64, f64),
    /// The footprint bounds' centre.
    pub center: (f64, f64),
    /// Plan-level claims.
    pub claims: u32,
    /// Whether it is exclusive.
    pub exclusive: bool,
}

/// The columns of `area` as a box over their centres.
pub(crate) fn area_box(area: Area) -> Aabb2 {
    Aabb2 {
        min_x: area.x0 as f64,
        min_z: area.z0 as f64,
        max_x: (area.x0 + area.w as i32) as f64,
        max_z: (area.z0 + area.d as i32) as f64,
    }
}

fn cell_range(lo: f64, hi: f64, size: i32) -> (i32, i32) {
    (
        (lo / size as f64).floor() as i32,
        (hi / size as f64).floor() as i32,
    )
}

impl Landscape {
    pub(crate) fn node(&self, n: u16) -> &NodeRt {
        self.nodes[n as usize].as_ref().expect("an enabled node")
    }

    /// The instance of Cells or Once node `n` at `cell`, solved once while
    /// resident.
    pub(crate) fn node_instance(&self, n: u16, cell: (i32, i32)) -> Option<Arc<Instance>> {
        let node = self.node(n);
        node.plans
            .get_or_solve(cell, || self.solve_cell(node, cell))
    }

    fn solve_cell(&self, node: &NodeRt, cell: (i32, i32)) -> Option<Arc<Instance>> {
        let (size, roll, reach) = match node.layout {
            LayoutRt::Cells { cell, roll, reach } => (cell, roll, reach),
            LayoutRt::Once { reach } => (0, 1.0, reach),
            _ => return None,
        };
        let seed = SeedLane::Landforms.seed(
            SeedPhase::Plan,
            self.identity.world_seed,
            &self.identity.dimension,
            node.salt.as_bytes(),
            cell_key(cell),
        );
        // One hash before any other work.
        let r = (mix64(seed ^ 0x5851_F42D_4C95_7F2D) >> 11) as f64 / (1u64 << 53) as f64;
        if !(r < roll) {
            return None;
        }
        solve_allowed(&|| format!("nodes.{} cell {cell:?}", node.id));
        bump(Counter::PlanSolves, 1);
        node.counts.solved.fetch_add(1, Ordering::Relaxed);
        let NodeImp::Landform(imp) = &node.imp else {
            return None;
        };
        let site = Site { cell, size, seed };
        let mut cx = PlanCtx::new(self, node.idx, site);
        let planned = imp.plan(site, &mut cx);
        let reject = |why: Reject| -> Option<Arc<Instance>> {
            let c = match why {
                Reject::Budget => &node.counts.budget,
                Reject::Bounds => &node.counts.bounds,
                Reject::Spawn => &node.counts.spawn,
                Reject::NoFootprint => &node.counts.no_footprint,
            };
            c.fetch_add(1, Ordering::Relaxed);
            None
        };
        // A plan past its budget is rejected whatever it returned.
        if cx.meter.exceeded() {
            return reject(Reject::Budget);
        }
        let planned = planned?;
        let Some(fp) = planned.footprint else {
            debug_assert!(false, "nodes.{}: a plan declared no footprint", node.id);
            return reject(Reject::NoFootprint);
        };
        let bounds = fp.bounds();
        let (lo, hi) = (
            cell.0 as f64 * size as f64 - reach as f64,
            (cell.0 + 1) as f64 * size as f64 + reach as f64,
        );
        let (lo_z, hi_z) = (
            cell.1 as f64 * size as f64 - reach as f64,
            (cell.1 + 1) as f64 * size as f64 + reach as f64,
        );
        let inside = bounds.min_x >= lo
            && bounds.max_x <= hi
            && bounds.min_z >= lo_z
            && bounds.max_z <= hi_z
            && bounds.min_x.is_finite()
            && bounds.max_z.is_finite();
        if !inside {
            debug_assert!(
                false,
                "nodes.{}: a footprint {bounds:?} leaves cell {cell:?} plus reach {reach}",
                node.id
            );
            return reject(Reject::Bounds);
        }
        if let Some(clear) = node.spawn_clear {
            let (sx, sz) = self.spawn();
            if fp.footprint.sdf_inside(sx as f64 + 0.5, sz as f64 + 0.5) > -(clear as f64) {
                return reject(Reject::Spawn);
            }
        }
        node.counts.planned.fetch_add(1, Ordering::Relaxed);
        Some(Arc::new(Instance {
            node: node.idx,
            rank: node.rank,
            cell,
            footprint: Some(fp),
            bounds,
            claims: planned.claims,
            exclusive: planned.exclusive,
            plan: planned.plan,
        }))
    }

    /// Instances of Cells or Once node `n` whose footprints meet `area`, in
    /// cell order.
    pub(crate) fn node_instances(&self, n: u16, area: Aabb2) -> Vec<Arc<Instance>> {
        let node = self.node(n);
        let mut out = Vec::new();
        match node.layout {
            LayoutRt::Cells { cell, reach, .. } => {
                let (i0, i1) =
                    cell_range(area.min_x - reach as f64, area.max_x + reach as f64, cell);
                let (j0, j1) =
                    cell_range(area.min_z - reach as f64, area.max_z + reach as f64, cell);
                for i in i0..=i1 {
                    for j in j0..=j1 {
                        if let Some(inst) = self.node_instance(n, (i, j)) {
                            if inst.bounds.intersects(&area) {
                                out.push(inst);
                            }
                        }
                    }
                }
            }
            LayoutRt::Once { .. } => {
                if let Some(inst) = self.node_instance(n, (0, 0)) {
                    if inst.bounds.intersects(&area) {
                        out.push(inst);
                    }
                }
            }
            _ => {}
        }
        out
    }

    /// Whether Field node `n`'s dispatch tile `tile` is admitted: a
    /// conservative bound of its gate over the tile is above zero.
    pub(crate) fn field_admitted(&self, n: u16, tile: (i32, i32)) -> bool {
        let node = self.node(n);
        let LayoutRt::Field {
            tile: size, gate, ..
        } = node.layout
        else {
            return false;
        };
        let (_, lipschitz) = node.gate.expect("a Field node has a gate");
        node.admit.get_or_insert_with(tile, || {
            bump(Counter::GateTiles, 1);
            let stride = Ord::min(GATE_STRIDE, size) as f64;
            let bound = tile_gate_bound(
                |x, z| self.field_at(gate, x as i32, z as i32),
                tile.0 as f64 * size as f64,
                tile.1 as f64 * size as f64,
                size as f64,
                stride,
                lipschitz,
            );
            bound > 0.0
        })
    }

    /// Field node `n`'s admitted tiles meeting `area`.
    pub(crate) fn field_tiles(&self, n: u16, area: Aabb2) -> Vec<(i32, i32)> {
        let LayoutRt::Field { tile, .. } = self.node(n).layout else {
            return Vec::new();
        };
        let (i0, i1) = cell_range(area.min_x, area.max_x, tile);
        let (j0, j1) = cell_range(area.min_z, area.max_z, tile);
        let mut out = Vec::new();
        for i in i0..=i1 {
            for j in j0..=j1 {
                if self.field_admitted(n, (i, j)) {
                    out.push((i, j));
                }
            }
        }
        out
    }

    /// Region node `n`'s tile `t`, solved once while resident.
    pub(crate) fn region_tile(&self, n: u16, t: TileId) -> Arc<dyn Any + Send + Sync> {
        let node = self.node(n);
        node.tiles.get_or_solve((t.tx, t.tz), || {
            solve_allowed(&|| format!("nodes.{} tile {t:?}", node.id));
            bump(Counter::PlanSolves, 1);
            node.counts.solved.fetch_add(1, Ordering::Relaxed);
            let NodeImp::Region(imp) = &node.imp else {
                unreachable!("region tiles of a region node")
            };
            let LayoutRt::Region(lat) = node.layout else {
                unreachable!()
            };
            let seed = SeedLane::Water.seed(
                SeedPhase::Plan,
                self.identity.world_seed,
                &self.identity.dimension,
                node.salt.as_bytes(),
                cell_key((t.tx, t.tz)),
            );
            let site = Site {
                cell: (t.tx, t.tz),
                size: lat.size,
                seed,
            };
            let mut cx = PlanCtx::new(self, node.idx, site);
            imp.solve(t, &mut cx)
        })
    }

    /// The index cell `ic`: every planned instance meeting it, and every
    /// Field node's admitted tiles in it, in composition order.
    fn index_cell(&self, ic: (i32, i32)) -> Arc<Vec<IndexEntry>> {
        self.index.get_or_solve(ic, || {
            bump(Counter::IndexCells, 1);
            let b = Aabb2 {
                min_x: ic.0 as f64 * INDEX_CELL as f64,
                min_z: ic.1 as f64 * INDEX_CELL as f64,
                max_x: (ic.0 + 1) as f64 * INDEX_CELL as f64,
                max_z: (ic.1 + 1) as f64 * INDEX_CELL as f64,
            };
            let mut out = Vec::new();
            for &n in &self.order {
                match self.node(n).layout {
                    LayoutRt::Cells { .. } | LayoutRt::Once { .. } => {
                        for inst in self.node_instances(n, b) {
                            out.push(IndexEntry::Planned(inst));
                        }
                    }
                    LayoutRt::Field { .. } => {
                        let tiles = self.field_tiles(n, b);
                        if !tiles.is_empty() {
                            out.push(IndexEntry::Field(n, tiles));
                        }
                    }
                    _ => {}
                }
            }
            Arc::new(out)
        })
    }

    /// What composes over `area` for node set `set`, in composition order.
    pub(crate) fn dispatch(&self, area: Area, set: &NodeSet) -> Vec<Dispatch> {
        if self.order.is_empty() || set.is_empty() {
            return Vec::new();
        }
        let b = area_box(area);
        let mut out: Vec<Dispatch> = Vec::new();
        if set.all {
            let (i0, i1) = cell_range(b.min_x, b.max_x, INDEX_CELL);
            let (j0, j1) = cell_range(b.min_z, b.max_z, INDEX_CELL);
            let mut field_nodes: Vec<u16> = Vec::new();
            for i in i0..=i1 {
                for j in j0..=j1 {
                    for e in self.index_cell((i, j)).iter() {
                        match e {
                            IndexEntry::Planned(inst) => {
                                // The same instance may sit in several index
                                // cells, as one allocation or (after an
                                // eviction and a re-solve) as two equal ones:
                                // it is keyed by (node, cell).
                                if inst.bounds.intersects(&b)
                                    && !out.iter().any(|d| match d {
                                        Dispatch::Planned(o) => {
                                            o.node == inst.node && o.cell == inst.cell
                                        }
                                        _ => false,
                                    })
                                {
                                    out.push(Dispatch::Planned(inst.clone()));
                                }
                            }
                            IndexEntry::Field(n, tiles) => {
                                let LayoutRt::Field { tile, .. } = self.node(*n).layout else {
                                    continue;
                                };
                                let meets = tiles.iter().any(|t| {
                                    Aabb2 {
                                        min_x: t.0 as f64 * tile as f64,
                                        min_z: t.1 as f64 * tile as f64,
                                        max_x: (t.0 + 1) as f64 * tile as f64,
                                        max_z: (t.1 + 1) as f64 * tile as f64,
                                    }
                                    .intersects(&b)
                                });
                                if meets && !field_nodes.contains(n) {
                                    field_nodes.push(*n);
                                }
                            }
                        }
                    }
                }
            }
            out.extend(field_nodes.into_iter().map(Dispatch::Field));
            for &n in &self.order {
                if let LayoutRt::Region(_) = self.node(n).layout {
                    out.push(Dispatch::Region(n));
                }
            }
        } else {
            for &n in &self.order {
                if !set.contains(n) {
                    continue;
                }
                match self.node(n).layout {
                    LayoutRt::Cells { .. } | LayoutRt::Once { .. } => {
                        out.extend(self.node_instances(n, b).into_iter().map(Dispatch::Planned));
                    }
                    LayoutRt::Field { .. } => {
                        if !self.field_tiles(n, b).is_empty() {
                            out.push(Dispatch::Field(n));
                        }
                    }
                    LayoutRt::Region(_) => out.push(Dispatch::Region(n)),
                    LayoutRt::Inert => {}
                }
            }
        }
        out.sort_by_key(|d| d.key(self));
        bump(Counter::InstancesDispatched, out.len() as u64);
        out
    }

    /// Compose `dispatch` over `area` onto `ground` (the spine's values
    /// over `area`), recording the column `log_at` when given.
    pub(crate) fn compose(
        &self,
        area: Area,
        ground: Vec<f64>,
        dispatch: &[Dispatch],
        log_at: Option<(i32, i32)>,
    ) -> ComposeState {
        let mut state = ComposeState::new(area, ground);
        let log_i = log_at.and_then(|(x, z)| {
            let (dx, dz) = (x - area.x0, z - area.z0);
            (dx >= 0 && dz >= 0 && (dx as usize) < area.w && (dz as usize) < area.d)
                .then(|| dz as usize * area.w + dx as usize)
        });
        if let Some(i) = log_i {
            state.log = Some((i, ComposeLog::default()));
        }
        let st = RefCell::new(state);
        let fields = LazyFields::new(&self.point_fields, &self.point_tiles, area);
        let mut excl: Option<Vec<f64>> = None;
        let mut cols: Vec<(u32, f64, f64)> = Vec::new();
        let mut last_layer: Option<Layer> = None;
        let b = area_box(area);
        for d in dispatch {
            let (n, inst) = match d {
                Dispatch::Planned(i) => (i.node, Some(i)),
                Dispatch::Field(n) | Dispatch::Region(n) => (*n, None),
            };
            let node = self.node(n);
            if let (Some(i), Some(prev)) = (log_i, last_layer) {
                if prev != node.layer {
                    let g = st.borrow().ground[i];
                    if let Some((_, log)) = &mut st.borrow_mut().log {
                        log.layers.push((prev.name().to_string(), g));
                    }
                }
            }
            last_layer = Some(node.layer);
            cols.clear();
            let ex = |i: usize| excl.as_ref().map_or(1.0, |e| e[i]);
            match d {
                Dispatch::Planned(inst) => {
                    let fp = inst
                        .footprint
                        .as_ref()
                        .expect("planned instances have footprints");
                    let x0 = Ord::max(area.x0, (inst.bounds.min_x - 1.0).floor() as i32);
                    let x1 = Ord::min(
                        area.x0 + area.w as i32 - 1,
                        (inst.bounds.max_x + 1.0).ceil() as i32,
                    );
                    let z0 = Ord::max(area.z0, (inst.bounds.min_z - 1.0).floor() as i32);
                    let z1 = Ord::min(
                        area.z0 + area.d as i32 - 1,
                        (inst.bounds.max_z + 1.0).ceil() as i32,
                    );
                    for z in z0..=z1 {
                        for x in x0..=x1 {
                            let edge = fp.edge(x as f64 + 0.5, z as f64 + 0.5);
                            if edge > 0.0 {
                                let i = area.index(x, z);
                                let w = edge * ex(i);
                                if w > 0.0 {
                                    cols.push((i as u32, edge, w));
                                }
                            }
                        }
                    }
                }
                Dispatch::Field(_) => {
                    let LayoutRt::Field { fade, .. } = node.layout else {
                        unreachable!()
                    };
                    let (slot, _) = node.gate.expect("a Field node has a gate");
                    for dz in 0..area.d {
                        for dx in 0..area.w {
                            let (x, z) = (area.x0 + dx as i32, area.z0 + dz as i32);
                            let g = fields.get(slot, x, z);
                            let edge = smootherstep(0.0, fade, g);
                            if edge > 0.0 {
                                let i = dz * area.w + dx;
                                let w = edge * ex(i);
                                if w > 0.0 {
                                    cols.push((i as u32, edge, w));
                                }
                            }
                        }
                    }
                }
                Dispatch::Region(_) => {
                    for i in 0..area.len() {
                        let w = ex(i);
                        if w > 0.0 {
                            cols.push((i as u32, 1.0, w));
                        }
                    }
                }
            }
            if let Some(i) = log_i {
                if let Some(&(_, edge, w)) = cols.iter().find(|c| c.0 as usize == i) {
                    if let Some((_, log)) = &mut st.borrow_mut().log {
                        log.instances.push(InstanceLog {
                            node: node.id.clone(),
                            kind: node.kind.clone(),
                            layer: node.layer.name().to_string(),
                            rank: node.rank,
                            cell: inst.map(|i| i.cell),
                            edge,
                            exclusion: ex(i),
                            weight: w,
                            exclusive: inst.is_some_and(|i| i.exclusive),
                        });
                    }
                }
            }
            if cols.is_empty() {
                continue;
            }
            bump(Counter::ComposedColumns, cols.len() as u64);
            if let Some(inst) = inst {
                if !inst.claims.is_empty() {
                    let mut s = st.borrow_mut();
                    for &(i, _, w) in &cols {
                        s.claim(i as usize, inst.claims, w, inst.rank);
                    }
                }
            }
            let ctx = BatchCtx {
                area,
                fields: &fields,
                provinces: &self.provinces,
                node: n,
                rank: node.rank,
                node_id: &node.id,
            };
            match (&node.imp, d) {
                (NodeImp::Landform(imp), Dispatch::Planned(inst)) => {
                    imp.columns(&*inst.plan, &st, &ctx, &cols);
                }
                (NodeImp::Landform(imp), Dispatch::Field(_)) => {
                    let plan = node.field_plan.as_ref().expect("a Field node has its plan");
                    imp.columns(&**plan, &st, &ctx, &cols);
                }
                (NodeImp::Region(imp), Dispatch::Region(_)) => {
                    let LayoutRt::Region(lat) = node.layout else {
                        unreachable!()
                    };
                    let grown = b.grow(lat.apron as f64);
                    let (i0, i1) = cell_range(grown.min_x, grown.max_x, lat.size);
                    let (j0, j1) = cell_range(grown.min_z, grown.max_z, lat.size);
                    let mut tiles = Vec::new();
                    for tx in i0..=i1 {
                        for tz in j0..=j1 {
                            let t = TileId { tx, tz };
                            tiles.push((t, self.region_tile(n, t)));
                        }
                    }
                    imp.columns(&tiles, lat.size, &st, &ctx, &cols);
                }
                _ => {}
            }
            if let Some(inst) = inst {
                if inst.exclusive {
                    let e = excl.get_or_insert_with(|| vec![1.0; area.len()]);
                    for &(i, edge, _) in &cols {
                        e[i as usize] *= 1.0 - edge;
                    }
                }
            }
        }
        if let (Some(i), Some(prev)) = (log_i, last_layer) {
            let g = st.borrow().ground[i];
            if let Some((_, log)) = &mut st.borrow_mut().log {
                log.layers.push((prev.name().to_string(), g));
            }
        }
        st.into_inner()
    }

    /// An acquired field at one column, through its own program: only its
    /// cone is evaluated (a stride-16 gate is a lattice lookup), and
    /// dead-code elimination never changes bits, so the value equals any
    /// program's at the same column.
    pub(crate) fn field_at(&self, f: super::build::FieldRef, x: i32, z: i32) -> f64 {
        let area = Area {
            x0: x,
            z0: z,
            w: 1,
            d: 1,
        };
        let i = f.0 as usize;
        self.point_fields[i]
            .evaluate(area, 0, &self.point_tiles[i])
            .output(0, x, z)
    }

    /// Composed ground (before the floor and ceiling) at one column through
    /// node set `set`.
    pub(crate) fn compose_point(&self, set: &NodeSet, x: i32, z: i32) -> f64 {
        let area = Area {
            x0: x,
            z0: z,
            w: 1,
            d: 1,
        };
        let grid = self.fields.evaluate(area, 0, &self.tiles);
        let base = grid.output(self.slots.ground, x, z);
        let d = self.dispatch(area, set);
        if d.is_empty() {
            return base;
        }
        self.compose(area, vec![base], &d, None).ground[0]
    }

    /// Probe `p` at one column (cached).
    pub(crate) fn probe_ground(&self, p: u16, x: i32, z: i32) -> f64 {
        let key = (p, x, z);
        if let Some(g) = self.probes.get(&key) {
            return g;
        }
        bump(Counter::ProbeColumns, 1);
        let g = self.compose_point(&self.probe_sets[p as usize], x, z);
        self.probes.insert(key, g)
    }

    /// Every planned instance (Cells and Once landforms) whose footprint
    /// meets `area`, in composition order. Solves plans as needed.
    pub fn instances_in(&self, area: Aabb2) -> Vec<InstanceInfo> {
        let mut out = Vec::new();
        for &n in &self.order {
            let node = self.node(n);
            for inst in self.node_instances(n, area) {
                let b = inst.bounds;
                out.push(InstanceInfo {
                    node: node.id.clone(),
                    kind: node.kind.clone(),
                    layer: node.layer.name().to_string(),
                    cell: inst.cell,
                    bounds: (b.min_x, b.min_z, b.max_x, b.max_z),
                    center: (0.5 * (b.min_x + b.max_x), 0.5 * (b.min_z + b.max_z)),
                    claims: inst.claims.0,
                    exclusive: inst.exclusive,
                });
            }
        }
        out
    }

    /// How many calls compose over chunk `coords` (index lookup only):
    /// the dispatch cost a chunk pays before any column work.
    pub fn chunk_dispatch_len(&self, coords: (i32, i32)) -> usize {
        let s = self.chunk_size;
        let h = self.halo + 1;
        let area = Area {
            x0: coords.0 * s - h,
            z0: coords.1 * s - h,
            w: (s + 2 * h) as usize,
            d: (s + 2 * h) as usize,
        };
        self.dispatch(area, &self.all_nodes).len()
    }

    fn node_by_id(&self, id: &str) -> Option<u16> {
        self.nodes
            .iter()
            .flatten()
            .find(|n| n.id == id)
            .map(|n| n.idx)
    }

    /// Every node that reads node `id`, directly or through other readers,
    /// in composition order (empty for an unknown or disabled node).
    pub fn readers_of(&self, id: &str) -> Vec<String> {
        let Some(n) = self.node_by_id(id) else {
            return Vec::new();
        };
        let mut set = std::collections::BTreeSet::from([n]);
        loop {
            let before = set.len();
            for (r, ds) in &self.deps {
                if ds.iter().any(|d| set.contains(d)) {
                    set.insert(*r);
                }
            }
            if set.len() == before {
                break;
            }
        }
        set.remove(&n);
        let mut out: Vec<u16> = set.into_iter().collect();
        out.sort_by_key(|&i| (self.node(i).rank, i));
        out.into_iter().map(|i| self.node(i).id.clone()).collect()
    }

    /// The boxes node `id` can affect within `area`: its instances' faded
    /// footprints (Cells, Once), its admitted dispatch tiles (Field), or
    /// its tiles with their apron (region solvers).
    pub fn node_instance_bounds(&self, id: &str, area: Aabb2) -> Vec<Aabb2> {
        let Some(n) = self.node_by_id(id) else {
            return Vec::new();
        };
        match self.node(n).layout {
            LayoutRt::Cells { .. } | LayoutRt::Once { .. } => self
                .node_instances(n, area)
                .iter()
                .map(|i| i.bounds)
                .collect(),
            LayoutRt::Field { tile, .. } => self
                .field_tiles(n, area)
                .into_iter()
                .map(|t| Aabb2 {
                    min_x: t.0 as f64 * tile as f64,
                    min_z: t.1 as f64 * tile as f64,
                    max_x: (t.0 + 1) as f64 * tile as f64,
                    max_z: (t.1 + 1) as f64 * tile as f64,
                })
                .collect(),
            LayoutRt::Region(lat) => {
                let grown = area.grow(lat.apron as f64);
                let (i0, i1) = cell_range(grown.min_x, grown.max_x, lat.size);
                let (j0, j1) = cell_range(grown.min_z, grown.max_z, lat.size);
                let mut out = Vec::new();
                for i in i0..=i1 {
                    for j in j0..=j1 {
                        out.push(
                            Aabb2 {
                                min_x: i as f64 * lat.size as f64,
                                min_z: j as f64 * lat.size as f64,
                                max_x: (i + 1) as f64 * lat.size as f64,
                                max_z: (j + 1) as f64 * lat.size as f64,
                            }
                            .grow(lat.apron as f64),
                        );
                    }
                }
                out
            }
            LayoutRt::Inert => Vec::new(),
        }
    }

    /// The affected set of node `id` within `window`, as boxes: what the
    /// node can affect, and recursively, every box of a node that reads it
    /// meeting the set (docs/landscape.md, section 7.5, test 7). Disabling
    /// the node leaves every chunk outside these boxes (and their halo and
    /// tree reach) byte-identical.
    pub fn affected_by(&self, id: &str, window: Aabb2) -> Vec<Aabb2> {
        let mut boxes = self.node_instance_bounds(id, window);
        let readers = self.readers_of(id);
        loop {
            let before = boxes.len();
            for r in &readers {
                for b in self.node_instance_bounds(r, window.grow(512.0)) {
                    if boxes.iter().any(|x| x.intersects(&b)) && !boxes.contains(&b) {
                        boxes.push(b);
                    }
                }
            }
            if boxes.len() == before {
                break;
            }
        }
        boxes
    }

    /// The faded footprints of node `id`'s instances meeting `area`.
    pub fn node_footprints(&self, id: &str, area: Aabb2) -> Vec<FadedFootprint> {
        let Some(n) = self.node_by_id(id) else {
            return Vec::new();
        };
        self.node_instances(n, area)
            .iter()
            .filter_map(|i| i.footprint.clone())
            .collect()
    }

    /// The engine edge of node `id` at one column: the largest over its
    /// instances' faded footprints (Cells, Once), the gate's fade (Field),
    /// 1 for a region solver, 0 elsewhere. Solves plans as needed.
    pub fn node_edge_at(&self, id: &str, x: i32, z: i32) -> f64 {
        let Some(n) = self.node_by_id(id) else {
            return 0.0;
        };
        let (xf, zf) = (x as f64 + 0.5, z as f64 + 0.5);
        match self.node(n).layout {
            LayoutRt::Cells { .. } | LayoutRt::Once { .. } => {
                let b = Aabb2::around(xf, zf, 0.5);
                self.node_instances(n, b)
                    .iter()
                    .filter_map(|i| i.footprint.as_ref())
                    .map(|f| f.edge(xf, zf))
                    .fold(0.0, |a: f64, e| if e > a { e } else { a })
            }
            LayoutRt::Field { tile, fade, gate } => {
                if !self.field_admitted(n, (x.div_euclid(tile), z.div_euclid(tile))) {
                    return 0.0;
                }
                smootherstep(0.0, fade, self.field_at(gate, x, z))
            }
            LayoutRt::Region(_) => 1.0,
            LayoutRt::Inert => 0.0,
        }
    }

    /// A Field node's gate at one column (`None` for other nodes).
    pub fn node_gate_at(&self, id: &str, x: i32, z: i32) -> Option<f64> {
        let n = self.node_by_id(id)?;
        match self.node(n).layout {
            LayoutRt::Field { gate, .. } => Some(self.field_at(gate, x, z)),
            _ => None,
        }
    }

    /// A Field node's dispatch tile size (`None` for other nodes).
    pub fn node_tile(&self, id: &str) -> Option<i32> {
        let n = self.node_by_id(id)?;
        match self.node(n).layout {
            LayoutRt::Field { tile, .. } => Some(tile),
            _ => None,
        }
    }

    /// Whether a Field node's dispatch tile is admitted.
    pub fn node_tile_admitted(&self, id: &str, tile: (i32, i32)) -> bool {
        self.node_by_id(id)
            .is_some_and(|n| self.field_admitted(n, tile))
    }

    /// Typed plans of landform node `id` (of kind `K`) whose footprints
    /// meet `area`, in cell order; `None` when the node is not an enabled
    /// `K`.
    pub fn plans_of<K: crate::landscape::plugin::Landform>(
        &self,
        id: &str,
        area: Aabb2,
    ) -> Option<Vec<Arc<K::Plan>>> {
        let n = self.node_by_id(id)?;
        if self.node(n).kind != K::KIND {
            return None;
        }
        Some(
            self.node_instances(n, area)
                .into_iter()
                .filter_map(|i| i.plan.clone().downcast::<K::Plan>().ok())
                .collect(),
        )
    }

    /// The key to landform node `id`'s per-column record, when it keeps
    /// records of type `T`.
    pub fn fact_key<T: crate::landscape::plugin::Fact>(
        &self,
        id: &str,
    ) -> Option<super::build::FactKey<T>> {
        let n = self.node_by_id(id)?;
        (self.node(n).cell_type == Some(std::any::TypeId::of::<T>())
            && std::any::TypeId::of::<T>() != std::any::TypeId::of::<()>())
        .then(|| super::build::FactKey::of(n))
    }

    /// A landform's record at one column (from the chunk's facts), `None`
    /// where it wrote none.
    pub fn fact<T: crate::landscape::plugin::Fact>(
        &self,
        key: super::build::FactKey<T>,
        x: i32,
        z: i32,
    ) -> Option<T> {
        let s = self.chunk_size;
        let facts = self.chunk_facts(voxelize::Vec2(x.div_euclid(s), z.div_euclid(s)));
        let i = facts.index(x, z)?;
        facts.cells.read::<T>(key.node, i)
    }

    /// Every node's plan outcomes so far, in composition order.
    pub fn plan_stats(&self) -> Vec<PlanStats> {
        self.order
            .iter()
            .map(|&n| {
                let node = self.node(n);
                let c = &node.counts;
                PlanStats {
                    node: node.id.clone(),
                    solved: c.solved.load(Ordering::Relaxed),
                    planned: c.planned.load(Ordering::Relaxed),
                    rejected_budget: c.budget.load(Ordering::Relaxed),
                    rejected_bounds: c.bounds.load(Ordering::Relaxed),
                    rejected_spawn: c.spawn.load(Ordering::Relaxed),
                    rejected_no_footprint: c.no_footprint.load(Ordering::Relaxed),
                }
            })
            .collect()
    }
}
