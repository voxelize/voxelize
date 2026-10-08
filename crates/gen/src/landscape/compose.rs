//! Composition: `ColumnBatch` is the only way to write columns.
//!
//! **Order.** Composition is a total order independent of the planner
//! DAG: by [`Layer`](super::plugin::Layer), then within a layer a
//! topological order of the explicit `over`/`under` edges (ties by
//! built-in rank, then game nodes, then node id; see the DAG), then by
//! instance cell.
//!
//! **Ground ops are one-sided soft clamps** ([`GroundOp`]): each is the
//! identity, bit for bit, wherever its target equals the current ground,
//! monotone and C1 in the current ground and the target. Every op is
//! applied as `cur ← cur + t·(op(cur) − cur)` with `t` the instance's
//! weight at the column, `edge · exclusion`: `edge` is computed by the
//! engine from the plan's faded footprint (or a Field layout's gate), so a
//! landform is C0 at its bound by construction, and the fade ring and every
//! flank where a landform's delta is zero are untouched.
//!
//! **Two passes.** An exclusive instance suppresses every instance composed
//! after it: their weights carry `exclusion = Π(1 − e_h)` over the
//! exclusive instances `h` composed before them, `e_h` being `h`'s edge.
//! Edges and exclusions come from footprints alone, before any `columns()`
//! call, so the result never depends on evaluation order. (Exclusion flows
//! forward only, so the state after a layer depends on nothing composed
//! later: tiers and probes equal the full pipeline's intermediate state.)
//!
//! **Channels** combine as follows: ground folds in order; claims keep the
//! largest weight per bit (owner: the argmax, ties to the later instance);
//! zone and classify go to the writer with the largest weight (ties to the
//! later instance); the cave ceiling is the minimum; spans union; province
//! entries are all kept, each with its weight; cells are per landform.

use std::any::Any;
use std::cell::{OnceCell, RefCell};
use std::marker::PhantomData;
use std::ops::{BitAnd, BitOr};
use std::sync::Arc;

use smallvec::SmallVec;

use super::build::{FactKey, FieldRef, ProvinceHandle, RoleId};
use super::fields::{Area, CompiledFields, FieldGrid, MacroTiles};
use super::math::{soft_down, soft_up, MinMax};
use super::plugin::Fact;
use super::surface::ZoneKey;

/// Claim bits: engine bits 0..16, game claim keys 16..32 (declared in
/// `spec.claim_keys`, acquired with `BuildCtx::claim_key`).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default, Debug, PartialOrd, Ord)]
pub struct Claims(pub u32);

impl Claims {
    /// No claim.
    pub const NONE: Self = Self(0);
    /// Bare rock: soil and cover yield; foreign carves fade out.
    pub const ROCK: Self = Self(1 << 0);
    /// Drainage and basins keep out; the owner supplies its water.
    pub const HYDRO: Self = Self(1 << 1);
    /// Carve provinces fade out.
    pub const NO_CAVES: Self = Self(1 << 2);
    /// Lower-ranked refine deviations fade out.
    pub const NO_BANDS: Self = Self(1 << 3);
    /// Site constraints reject footprints here.
    pub const NO_SITES: Self = Self(1 << 4);
    /// Flora placement probability falls with the weight.
    pub const NO_FLORA: Self = Self(1 << 5);
    /// Drainage may form a knickpoint fall here.
    pub const FALLS_OK: Self = Self(1 << 6);

    /// Whether every bit of `other` is set.
    pub fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    /// Whether any bit of `other` is set.
    pub fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }

    /// Whether no bit is set.
    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// The set bits' indices, ascending.
    pub fn bits(self) -> impl Iterator<Item = u8> {
        (0..32u8).filter(move |b| self.0 & (1 << b) != 0)
    }

    /// The engine name of bit `b`, or `game.<b>` for a game bit.
    pub fn bit_name(b: u8) -> String {
        match b {
            0 => "ROCK".into(),
            1 => "HYDRO".into(),
            2 => "NO_CAVES".into(),
            3 => "NO_BANDS".into(),
            4 => "NO_SITES".into(),
            5 => "NO_FLORA".into(),
            6 => "FALLS_OK".into(),
            b => format!("bit{b}"),
        }
    }
}

impl BitOr for Claims {
    type Output = Self;
    fn bitor(self, o: Self) -> Self {
        Self(self.0 | o.0)
    }
}

impl BitAnd for Claims {
    type Output = Self;
    fn bitand(self, o: Self) -> Self {
        Self(self.0 & o.0)
    }
}

/// Claims a landform writes at one column. Any `Claims` converts into
/// one; there is no exclusive bit (exclusivity is plan-level only,
/// [`Planned::exclusive`](super::plugin::Planned::exclusive)).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ColumnClaims(pub(crate) Claims);

impl From<Claims> for ColumnClaims {
    fn from(c: Claims) -> Self {
        Self(c)
    }
}

/// A ground operation: what an instance asks of one column.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum GroundOp {
    /// `cur + w·(h − cur)`.
    Set {
        /// Target.
        h: f64,
        /// Blend, 0..=1.
        w: f64,
    },
    /// One-sided soft clamp down, `cur − r_k(cur − h)`: lands at exactly
    /// `h + k/2` when fully engaged.
    Carve {
        /// Target floor.
        h: f64,
        /// Rounding width, blocks.
        k: f64,
    },
    /// One-sided soft clamp up, `cur + r_k(h − cur)`: lands at exactly
    /// `h − k/2` when fully engaged.
    Build {
        /// Target top.
        h: f64,
        /// Rounding width, blocks.
        k: f64,
    },
    /// `cur + dh`.
    Raise {
        /// Lift, blocks.
        dh: f64,
    },
}

impl GroundOp {
    /// The op's target value for current ground `cur`: `cur` bit for bit
    /// wherever the target asks no change (`Carve` with `h ≥ cur`, `Build`
    /// with `h ≤ cur`, `Set` with `h == cur` or `w == 0`, `Raise` with
    /// `dh == 0`).
    #[inline]
    pub fn apply(self, cur: f64) -> f64 {
        match self {
            GroundOp::Set { h, w } => {
                if h == cur || w == 0.0 {
                    cur
                } else {
                    cur + w * (h - cur)
                }
            }
            GroundOp::Carve { h, k } => soft_down(cur, h, k.fmax(0.0)),
            GroundOp::Build { h, k } => soft_up(cur, h, k.fmax(0.0)),
            GroundOp::Raise { dh } => {
                if dh == 0.0 {
                    cur
                } else {
                    cur + dh
                }
            }
        }
    }

    /// `cur + t·(op(cur) − cur)`: `cur` bit for bit wherever the op is the
    /// identity or `t` is zero. A non-finite result leaves `cur`.
    #[inline]
    pub fn fold(self, cur: f64, t: f64) -> f64 {
        let d = self.apply(cur) - cur;
        if d == 0.0 || t == 0.0 || !d.is_finite() {
            return cur;
        }
        let out = cur + t * d;
        if out.is_finite() {
            out
        } else {
            cur
        }
    }
}

/// One claim at one column: a bit, its weight and its owner (the
/// composition rank of the node that wrote the largest weight).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClaimEntry {
    /// The bit index (0..32).
    pub bit: u8,
    /// Weight, 0..=1.
    pub weight: f32,
    /// Owner's composition rank.
    pub owner: u16,
}

/// An analytic solid interval in one column.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SolidSpan {
    /// Lowest solid voxel.
    pub lo: i32,
    /// Highest solid voxel.
    pub hi: i32,
    /// Its block.
    pub block: u32,
}

/// One province entry at one column.
#[derive(Clone)]
pub struct ProvinceEntry {
    /// The province's slot.
    pub slot: u16,
    /// The province's kind.
    pub kind: &'static str,
    /// Band floor (voxel y).
    pub lo: i32,
    /// Band ceiling (voxel y).
    pub hi: i32,
    /// The owning instance's weight here.
    pub weight: f32,
    /// The owner's composition rank.
    pub owner: u16,
    pub(crate) params: Arc<dyn Any + Send + Sync>,
}

impl std::fmt::Debug for ProvinceEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProvinceEntry")
            .field("slot", &self.slot)
            .field("kind", &self.kind)
            .field("lo", &self.lo)
            .field("hi", &self.hi)
            .field("weight", &self.weight)
            .field("owner", &self.owner)
            .finish()
    }
}

/// A landform's cells over an area, erased.
pub(crate) trait CellAny: Send + Sync {
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
    fn crop(&self, from: Area, to: Area) -> Box<dyn CellAny>;
    fn clone_box(&self) -> Box<dyn CellAny>;
    fn bytes(&self) -> usize;
}

pub(crate) struct CellStore<C: Fact> {
    pub vals: Vec<C>,
    pub set: Vec<bool>,
}

impl<C: Fact> CellAny for CellStore<C> {
    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn crop(&self, from: Area, to: Area) -> Box<dyn CellAny> {
        let mut vals = vec![C::default(); to.len()];
        let mut set = vec![false; to.len()];
        for dz in 0..to.d {
            for dx in 0..to.w {
                let (x, z) = (to.x0 + dx as i32, to.z0 + dz as i32);
                let i = from.index(x, z);
                vals[dz * to.w + dx] = self.vals[i];
                set[dz * to.w + dx] = self.set[i];
            }
        }
        Box::new(CellStore { vals, set })
    }
    fn clone_box(&self) -> Box<dyn CellAny> {
        Box::new(CellStore {
            vals: self.vals.clone(),
            set: self.set.clone(),
        })
    }
    fn bytes(&self) -> usize {
        self.vals.len() * (std::mem::size_of::<C>() + 1)
    }
}

/// Per-landform cell stores, by node.
pub(crate) struct CellStores(pub Vec<(u16, Box<dyn CellAny>)>);

impl Clone for CellStores {
    fn clone(&self) -> Self {
        Self(self.0.iter().map(|(n, s)| (*n, s.clone_box())).collect())
    }
}

impl std::fmt::Debug for CellStores {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list()
            .entries(self.0.iter().map(|(n, _)| n))
            .finish()
    }
}

impl CellStores {
    pub fn read<T: Fact>(&self, node: u16, i: usize) -> Option<T> {
        let (_, s) = self.0.iter().find(|(n, _)| *n == node)?;
        let s = s.as_any().downcast_ref::<CellStore<T>>()?;
        if s.set[i] {
            Some(s.vals[i])
        } else {
            None
        }
    }
}

/// One instance's line in a column's provenance.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct InstanceLog {
    /// Node id.
    pub node: String,
    /// Kind.
    pub kind: String,
    /// Layer.
    pub layer: String,
    /// Composition rank.
    pub rank: u16,
    /// The instance's cell (`None` for Field and region nodes).
    pub cell: Option<(i32, i32)>,
    /// The engine fade at the column.
    pub edge: f64,
    /// The product of `1 − edge` over earlier exclusive instances.
    pub exclusion: f64,
    /// `edge · exclusion`, the `t` its ops are applied with.
    pub weight: f64,
    /// Whether the instance is exclusive.
    pub exclusive: bool,
}

/// One ground op's line in a column's provenance.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct OpLog {
    /// Node id.
    pub node: String,
    /// The op as written.
    pub op: String,
    /// Ground before.
    pub before: f64,
    /// Ground after.
    pub after: f64,
    /// The weight it was applied with.
    pub t: f64,
}

/// What composition recorded for one column (the explain path).
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct ComposeLog {
    /// Instances touching the column, in composition order.
    pub instances: Vec<InstanceLog>,
    /// Ground ops in fold order.
    pub ops: Vec<OpLog>,
    /// Ground after each layer that holds an instance here.
    pub layers: Vec<(String, f64)>,
}

/// The running state of one composition over an area.
pub(crate) struct ComposeState {
    pub area: Area,
    pub ground: Vec<f64>,
    pub claims: Option<Vec<SmallVec<[ClaimEntry; 2]>>>,
    /// (zone, weight, rank + 1); rank 0 = no writer.
    pub zone: Option<Vec<(ZoneKey, f64, u16)>>,
    /// (height, weight, rank + 1).
    pub classify: Option<Vec<(f64, f64, u16)>>,
    pub cave_ceiling: Option<Vec<i32>>,
    /// NaN where no hint stands.
    pub slope_hint: Option<Vec<f64>>,
    pub spans: Vec<(u32, SolidSpan)>,
    pub provinces: Vec<(u32, ProvinceEntry)>,
    pub cells: CellStores,
    pub log: Option<(usize, ComposeLog)>,
}

impl ComposeState {
    pub fn new(area: Area, ground: Vec<f64>) -> Self {
        Self {
            area,
            ground,
            claims: None,
            zone: None,
            classify: None,
            cave_ceiling: None,
            slope_hint: None,
            spans: Vec::new(),
            provinces: Vec::new(),
            cells: CellStores(Vec::new()),
            log: None,
        }
    }

    /// Record (or raise) claim bits at column `i` with weight `t` by `rank`.
    pub fn claim(&mut self, i: usize, c: Claims, t: f64, rank: u16) {
        if c.is_empty() || !(t > 0.0) {
            return;
        }
        let n = self.area.len();
        let claims = self.claims.get_or_insert_with(|| vec![SmallVec::new(); n]);
        for b in c.bits() {
            let w = t.fclamp(0.0, 1.0) as f32;
            match claims[i].iter_mut().find(|e| e.bit == b) {
                Some(e) => {
                    // Largest weight wins; ties go to the later instance.
                    if w >= e.weight {
                        e.weight = w;
                        e.owner = rank;
                    }
                }
                None => claims[i].push(ClaimEntry {
                    bit: b,
                    weight: w,
                    owner: rank,
                }),
            }
        }
    }

    /// The largest weight so far at column `i` over the bits of `c`.
    pub fn claim_weight(&self, i: usize, c: Claims) -> f64 {
        let Some(claims) = &self.claims else {
            return 0.0;
        };
        let mut w = 0.0f64;
        for e in &claims[i] {
            if c.0 & (1 << e.bit) != 0 {
                w = w.fmax(e.weight as f64);
            }
        }
        w
    }
}

/// The acquired fields over one composition area, each evaluated on its
/// first read: a chunk whose instances read no field evaluates none, and a
/// read evaluates that field's cone alone.
pub(crate) struct LazyFields<'a> {
    progs: &'a [CompiledFields],
    tiles: &'a [MacroTiles],
    area: Area,
    grids: Vec<OnceCell<FieldGrid>>,
}

impl<'a> LazyFields<'a> {
    pub fn new(progs: &'a [CompiledFields], tiles: &'a [MacroTiles], area: Area) -> Self {
        Self {
            progs,
            tiles,
            area,
            grids: progs.iter().map(|_| OnceCell::new()).collect(),
        }
    }

    /// Acquired field `slot` (a `FieldRef`'s index) at a column of the area.
    pub fn get(&self, slot: usize, x: i32, z: i32) -> f64 {
        self.grids[slot]
            .get_or_init(|| self.progs[slot].evaluate(self.area, 0, &self.tiles[slot]))
            .output(0, x, z)
    }
}

/// What every column of one batch shares.
pub(crate) struct BatchCtx<'a> {
    pub area: Area,
    pub fields: &'a LazyFields<'a>,
    pub provinces: &'a [super::volume::ProvinceRt],
    pub node: u16,
    pub rank: u16,
    pub node_id: &'a str,
}

/// One instance's masked columns in one chunk (or one point query): the
/// only way to write columns.
pub struct ColumnBatch<'a, C: Fact> {
    pub(crate) st: &'a RefCell<ComposeState>,
    pub(crate) ctx: &'a BatchCtx<'a>,
    /// (column index in the area, edge, weight), row-major.
    pub(crate) cols: &'a [(u32, f64, f64)],
    pub(crate) _c: PhantomData<C>,
}

impl<'a, C: Fact> ColumnBatch<'a, C> {
    /// The masked columns, row-major (x fastest).
    pub fn iter(&mut self) -> impl Iterator<Item = Col<'_, C>> + '_ {
        let st = self.st;
        let ctx = self.ctx;
        self.cols.iter().map(move |&(i, edge, weight)| {
            let area = ctx.area;
            let i = i as usize;
            Col {
                st,
                ctx,
                i,
                x: area.x0 + (i % area.w) as i32,
                z: area.z0 + (i / area.w) as i32,
                edge,
                weight,
                _c: PhantomData,
            }
        })
    }

    /// Masked columns in this batch.
    pub fn len(&self) -> usize {
        self.cols.len()
    }

    /// Whether no column is masked.
    pub fn is_empty(&self) -> bool {
        self.cols.is_empty()
    }
}

/// One masked column of a [`ColumnBatch`].
pub struct Col<'b, C: Fact> {
    st: &'b RefCell<ComposeState>,
    ctx: &'b BatchCtx<'b>,
    i: usize,
    x: i32,
    z: i32,
    edge: f64,
    weight: f64,
    _c: PhantomData<C>,
}

impl<C: Fact> Col<'_, C> {
    /// World x.
    pub fn x(&self) -> i32 {
        self.x
    }

    /// World z.
    pub fn z(&self) -> i32 {
        self.z
    }

    /// The column centre's x (`x + 0.5`).
    pub fn xf(&self) -> f64 {
        self.x as f64 + 0.5
    }

    /// The column centre's z (`z + 0.5`).
    pub fn zf(&self) -> f64 {
        self.z as f64 + 0.5
    }

    /// The engine fade in (0, 1]: footprint (Cells, Once) or gate (Field).
    pub fn edge(&self) -> f64 {
        self.edge
    }

    /// `edge · exclusion`: the `t` this instance's ops are applied with.
    pub fn weight(&self) -> f64 {
        self.weight
    }

    /// Ground composed so far (lower layers and earlier instances).
    pub fn ground(&self) -> f64 {
        self.st.borrow().ground[self.i]
    }

    /// A named field here.
    pub fn field(&self, f: FieldRef) -> f64 {
        self.ctx.fields.get(f.0 as usize, self.x, self.z)
    }

    /// Apply a ground op at this instance's weight.
    pub fn ground_op(&mut self, op: GroundOp) {
        let mut st = self.st.borrow_mut();
        let before = st.ground[self.i];
        let after = op.fold(before, self.weight);
        if after.to_bits() != before.to_bits() {
            st.ground[self.i] = after;
            // A later op that moves the ground voids an earlier hint.
            if let Some(h) = &mut st.slope_hint {
                h[self.i] = f64::NAN;
            }
        }
        if let Some((li, log)) = &mut st.log {
            if *li == self.i {
                log.ops.push(OpLog {
                    node: self.ctx.node_id.to_string(),
                    op: format!("{op:?}"),
                    before,
                    after,
                    t: self.weight,
                });
            }
        }
    }

    /// An analytic slope where this instance dominates (`t ≥ 0.999`): it
    /// replaces the stencil slope unless a later op moves the ground.
    pub fn slope_hint(&mut self, s: f64) {
        if !(self.weight >= 0.999) || !s.is_finite() {
            return;
        }
        let mut st = self.st.borrow_mut();
        let n = st.area.len();
        st.slope_hint.get_or_insert_with(|| vec![f64::NAN; n])[self.i] = s.fmax(0.0);
    }

    /// Claim bits at this instance's weight.
    pub fn claim(&mut self, c: ColumnClaims) {
        let w = self.weight;
        self.st.borrow_mut().claim(self.i, c.0, w, self.ctx.rank);
    }

    /// Claim bits at weight `t·s` (`s` clamped to 0..=1): a claim faded
    /// inside a footprint.
    pub fn claim_scaled(&mut self, c: ColumnClaims, s: f64) {
        let w = self.weight * s.fclamp(0.0, 1.0);
        self.st.borrow_mut().claim(self.i, c.0, w, self.ctx.rank);
    }

    /// The largest claim weight so far here over the bits of `c`.
    pub fn claim_weight(&self, c: Claims) -> f64 {
        self.st.borrow().claim_weight(self.i, c)
    }

    /// Write this column's zone (kept if this instance's weight is the
    /// largest among zone writers here; ties to the later instance).
    pub fn zone(&mut self, z: ZoneKey) {
        let w = self.weight;
        let rank = self.ctx.rank + 1;
        let mut st = self.st.borrow_mut();
        let n = st.area.len();
        let zone = st
            .zone
            .get_or_insert_with(|| vec![(ZoneKey::NONE, 0.0, 0); n]);
        if w >= zone[self.i].1 {
            zone[self.i] = (z, w, rank);
        }
    }

    /// The height the biome classifier sees here (same owner rule as the
    /// zone).
    pub fn classify_as(&mut self, h: f64) {
        if !h.is_finite() {
            return;
        }
        let w = self.weight;
        let rank = self.ctx.rank + 1;
        let mut st = self.st.borrow_mut();
        let n = st.area.len();
        let c = st.classify.get_or_insert_with(|| vec![(0.0, 0.0, 0); n]);
        if w >= c[self.i].1 {
            c[self.i] = (h, w, rank);
        }
    }

    /// Lower this column's cave ceiling to `y` (the minimum wins).
    pub fn cave_ceiling(&mut self, y: i32) {
        let mut st = self.st.borrow_mut();
        let n = st.area.len();
        let c = st.cave_ceiling.get_or_insert_with(|| vec![i32::MAX; n]);
        c[self.i] = Ord::min(c[self.i], y);
    }

    /// An analytic solid interval `[lo, hi]` of `role` (union).
    pub fn solid_span(&mut self, lo: i32, hi: i32, role: RoleId) {
        if lo > hi {
            return;
        }
        let i = self.i as u32;
        self.st.borrow_mut().spans.push((
            i,
            SolidSpan {
                lo,
                hi,
                block: role.0,
            },
        ));
    }

    /// A province entry over `[lo, hi]` at this instance's weight.
    pub fn province<P: Fact>(&mut self, h: &ProvinceHandle<P>, lo: i32, hi: i32, p: P) {
        if lo > hi || !(self.weight > 0.0) {
            return;
        }
        let i = self.i as u32;
        self.st.borrow_mut().provinces.push((
            i,
            ProvinceEntry {
                slot: h.slot,
                kind: self.ctx.provinces[h.slot as usize].kind,
                lo,
                hi,
                weight: self.weight as f32,
                owner: self.ctx.rank,
                params: Arc::new(p),
            },
        ));
    }

    /// This landform's record here.
    pub fn cell(&mut self, c: C) {
        let node = self.ctx.node;
        let mut st = self.st.borrow_mut();
        let n = st.area.len();
        let i = self.i;
        let pos = match st.cells.0.iter().position(|(k, _)| *k == node) {
            Some(p) => p,
            None => {
                st.cells.0.push((
                    node,
                    Box::new(CellStore::<C> {
                        vals: vec![C::default(); n],
                        set: vec![false; n],
                    }),
                ));
                st.cells.0.len() - 1
            }
        };
        let store = st.cells.0[pos]
            .1
            .as_any_mut()
            .downcast_mut::<CellStore<C>>()
            .expect("one record type per landform");
        store.vals[i] = c;
        store.set[i] = true;
    }

    /// A strictly earlier landform's record here (keys of strictly earlier
    /// nodes only; `BuildCtx::fact` checks).
    pub fn read<T: Fact>(&self, k: FactKey<T>) -> Option<T> {
        self.st.borrow().cells.read::<T>(k.node, self.i)
    }
}
