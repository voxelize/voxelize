//! The five plugin kinds: [`Landform`], [`RegionSolver`], [`Province`],
//! [`Surfacer`](super::surface::Surfacer) and [`SiteSet`].
//!
//! All five share one shape: typed `Params` (deserialized with unknown
//! fields refused, validated with path-qualified errors, re-serialized
//! typed for the identity hash), a `KIND` key and a `VERSION` that stamps
//! identity, and a `build` that acquires every input as a typed handle from
//! [`BuildCtx`]. The planner DAG is recorded from those handles, so it is
//! always the code's own dependency graph: a plugin holding no handle to a
//! thing cannot read it.
//!
//! Built-in kinds register exactly as a game's kinds do
//! ([`KindRegistry`](super::KindRegistry)); the engine erases the types
//! behind one adapter per node that owns the node's plan cache and fact
//! store, so game code never touches the erasure.
//!
//! **Where each kind runs.**
//! - A **landform** is a planned or position-pure feature: its instances
//!   are dispatched once per chunk with a masked [`ColumnBatch`] and
//!   compose ground by contract (docs/landscape.md, section 2.8).
//! - A **region solver** solves tiles with an apron (drainage, basins) and
//!   writes columns from the tiles around a chunk.
//! - A **province** is a 3D refine, add or carve owned by a landform: the
//!   landform writes per-column entries, the volume pass evaluates them.
//! - A **surfacer** paints after composition.
//! - A **site set** places structures (siting, fits and pieces arrive with
//!   the structure system; this build validates its handles).

use std::marker::PhantomData;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::build::{BuildCtx, FieldRef};
use super::compose::{Claims, ColumnBatch};
use super::geometry::FadedFootprint;
use super::lattice::LatticeSpec;
use super::plan::PlanCtx;
use super::spec::{SpecError, Validate};
use crate::stream::mix64;

/// A plugin's per-column record: plain data, copied in and out of the
/// chunk facts (`FactKey<T>` reads it). `()` when a kind keeps none.
pub trait Fact: Copy + Default + Send + Sync + 'static {}

impl Fact for () {}

/// The composition layers, in order. The base fields precede them all.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Layer {
    /// Ranges, volcanoes, tablelands: ground raised over the base relief.
    Uplift,
    /// Canyons, sinkholes: ground cut into the uplifted relief.
    Incise,
    /// Coasts, shelves, cliffs.
    Shore,
    /// Drainage, basins and the other water writers.
    Water,
    /// Tors, dunes, small forms read against final hydrology.
    Detail,
    /// Structure fits.
    Fit,
}

impl Layer {
    /// Every layer, in composition order.
    pub const ALL: [Layer; 6] = [
        Layer::Uplift,
        Layer::Incise,
        Layer::Shore,
        Layer::Water,
        Layer::Detail,
        Layer::Fit,
    ];

    /// The layer's name as written in reports.
    pub fn name(self) -> &'static str {
        match self {
            Layer::Uplift => "Uplift",
            Layer::Incise => "Incise",
            Layer::Shore => "Shore",
            Layer::Water => "Water",
            Layer::Detail => "Detail",
            Layer::Fit => "Fit",
        }
    }
}

/// How a landform's instances are laid out over the world.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Layout {
    /// One jittered site per `cell` (blocks); `roll` (0..=1) is the share
    /// of cells that plan at all, decided by one hash before any other
    /// work; every footprint stays within `reach` blocks of its cell.
    Cells {
        /// Cell size, blocks.
        cell: i32,
        /// Share of cells that try to plan.
        roll: f64,
        /// How far a footprint may reach past its cell, blocks.
        reach: i32,
    },
    /// A continuous, position-pure landform. `tile` is a dispatch tile
    /// (a cost device, never a fade): a tile is dispatched when a
    /// conservative bound of `gate` over it is above zero, and the engine
    /// fades the landform by `edge = smootherstep(0, fade, gate)`. Its only
    /// plan is the world-constant [`Landform::field_plan`].
    Field {
        /// Dispatch tile size, blocks.
        tile: i32,
        /// The gate field: the landform lives where it is positive.
        gate: FieldRef,
        /// Gate value over which the edge rises from 0 to 1.
        fade: f64,
    },
    /// One world-scale plan (spawn-relative hero placements), solved once.
    Once {
        /// How far the footprint may reach from the world origin, blocks.
        reach: i32,
    },
}

/// The site a Cells or Once plan is solved for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Site {
    /// The cell `(i, j)`: it covers `[i·size, (i+1)·size)` on x and the same
    /// on z. `(0, 0)` for a Once plan.
    pub cell: (i32, i32),
    /// Cell size, blocks (0 for a Once plan).
    pub size: i32,
    pub(crate) seed: u64,
}

impl Site {
    /// The cell's corner with the smallest x and z.
    pub fn origin(&self) -> (f64, f64) {
        (
            self.cell.0 as f64 * self.size as f64,
            self.cell.1 as f64 * self.size as f64,
        )
    }

    /// The cell's centre.
    pub fn center(&self) -> (f64, f64) {
        let (x, z) = self.origin();
        let h = 0.5 * self.size as f64;
        (x + h, z + h)
    }

    /// A point jittered about the centre by up to `share / 2` of the cell
    /// on each axis (`share` in 0..=1), the same for every caller.
    pub fn jittered(&self, share: f64) -> (f64, f64) {
        let (cx, cz) = self.center();
        let a = mix64(self.seed ^ 0x6A09_E667_F3BC_C909);
        let b = mix64(self.seed ^ 0xBB67_AE85_84CA_A73B);
        let u = (a >> 11) as f64 / (1u64 << 53) as f64 - 0.5;
        let v = (b >> 11) as f64 / (1u64 << 53) as f64 - 0.5;
        let s = share * self.size as f64;
        (cx + u * s, cz + v * s)
    }

    /// This site's seed (the cell's plan stream, before any sub-stream).
    pub fn seed(&self) -> u64 {
        self.seed
    }
}

/// A solved plan with what the engine needs to dispatch it: its faded
/// footprint (the engine computes every column's edge from it), the claims
/// every footprint column gets at its weight, and whether the instance is
/// exclusive (it suppresses every instance composed after it, faded by its
/// edge).
pub struct Planned<P> {
    pub(crate) plan: P,
    pub(crate) footprint: Option<FadedFootprint>,
    pub(crate) claims: Claims,
    pub(crate) exclusive: bool,
}

impl<P> Planned<P> {
    /// A plan; it still needs a footprint.
    pub fn new(plan: P) -> Self {
        Self {
            plan,
            footprint: None,
            claims: Claims::NONE,
            exclusive: false,
        }
    }

    /// Its footprint with the fade (`Footprint::disc(..).fade(w)`): columns
    /// outside are never called, and the edge is 0 on the bound.
    pub fn footprint(mut self, f: FadedFootprint) -> Self {
        self.footprint = Some(f);
        self
    }

    /// Claims written to every footprint column at the column's weight.
    pub fn claims(mut self, c: Claims) -> Self {
        self.claims = self.claims | c;
        self
    }

    /// Mark the instance exclusive: every instance composed after it is
    /// multiplied by `1 − edge` of this one where they overlap.
    pub fn exclusive(mut self) -> Self {
        self.exclusive = true;
        self
    }

    /// The plan.
    pub fn plan(&self) -> &P {
        &self.plan
    }
}

/// Why a plan was rejected.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Reject {
    /// A deterministic work budget ran out (the budget is part of the spec).
    Budget,
    /// The footprint left the cell plus its reach.
    Bounds,
    /// A spawn reader's footprint came within its clearance of spawn.
    Spawn,
    /// The plan declared no footprint.
    NoFootprint,
}

/// A landform: a planned or position-pure feature that composes ground.
pub trait Landform: Sized + Send + Sync + 'static {
    /// Registry key (`"game.sinkhole"`).
    const KIND: &'static str;
    /// Bumped whenever the landform's output changes; covers every
    /// province it owns (identity also records each province's own
    /// version under this landform's stamp).
    const VERSION: u32;
    /// Typed params: no struct-level default, `Option` for optional
    /// fields, unknown fields refused.
    type Params: DeserializeOwned + Serialize + Validate + Clone + Send + Sync;
    /// One instance's plan.
    type Plan: Send + Sync + 'static;
    /// The per-column record later nodes read through `FactKey<Self::Cell>`
    /// (`()` if none).
    type Cell: Fact;

    /// Acquire everything the landform reads.
    fn build(params: Self::Params, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError>;
    /// The composition layer.
    fn layer(&self) -> Layer;
    /// How instances are laid out.
    fn layout(&self) -> Layout;
    /// Cells and Once layouts: one plan per site (`None` when the site
    /// holds no instance). Never called for Field layouts.
    fn plan(&self, _site: Site, _cx: &mut PlanCtx<'_>) -> Option<Planned<Self::Plan>> {
        None
    }
    /// Field layouts: the one world-constant plan, computed once at
    /// compile. It takes no position, so a Field landform holds no
    /// position-varying plan state (compile refuses a Field layout without
    /// it).
    fn field_plan(&self) -> Option<Self::Plan> {
        None
    }
    /// Called once per (instance, chunk) with the instance's masked
    /// columns. Every column's result must depend only on that column
    /// (point queries run the same code over one column).
    fn columns(&self, plan: &Self::Plan, batch: &mut ColumnBatch<'_, Self::Cell>);
}

/// A region solver's tile lattice: tiles of `size` blocks, each solved
/// with `apron` blocks of context and influencing columns up to `apron`
/// blocks outside itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TileLattice {
    /// Tile size, blocks.
    pub size: i32,
    /// Context and influence beyond the tile, blocks.
    pub apron: i32,
}

/// One tile of a region solver: it covers `[tx·size, (tx+1)·size)` on x
/// and the same on z.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TileId {
    /// Tile index on x.
    pub tx: i32,
    /// Tile index on z.
    pub tz: i32,
}

/// The solved tiles around one chunk, in `TileId` order.
pub struct TileSet<'a, T> {
    pub(crate) tiles: &'a [(TileId, std::sync::Arc<T>)],
    pub(crate) size: i32,
}

impl<T> TileSet<'_, T> {
    /// The tile `id`, if it was solved for this chunk.
    pub fn get(&self, id: TileId) -> Option<&T> {
        self.tiles
            .binary_search_by(|(t, _)| t.cmp(&id))
            .ok()
            .map(|i| &*self.tiles[i].1)
    }

    /// The tile holding column `(x, z)`, if solved.
    pub fn at(&self, x: i32, z: i32) -> Option<(TileId, &T)> {
        let id = TileId {
            tx: x.div_euclid(self.size),
            tz: z.div_euclid(self.size),
        };
        self.get(id).map(|t| (id, t))
    }

    /// Every solved tile, in `TileId` order.
    pub fn iter(&self) -> impl Iterator<Item = (TileId, &T)> {
        self.tiles.iter().map(|(id, t)| (*id, &**t))
    }

    /// Tile size, blocks.
    pub fn size(&self) -> i32 {
        self.size
    }
}

/// A region solver: tiles solved with an apron (drainage, basins, lava
/// pools), columns written from the tiles around each chunk.
pub trait RegionSolver: Sized + Send + Sync + 'static {
    /// Registry key.
    const KIND: &'static str;
    /// Bumped whenever the solver's output changes.
    const VERSION: u32;
    /// Typed params.
    type Params: DeserializeOwned + Serialize + Validate + Clone + Send + Sync;
    /// One solved tile.
    type Tile: Send + Sync + 'static;
    /// Acquire everything the solver reads.
    fn build(params: Self::Params, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError>;
    /// The composition layer.
    fn layer(&self) -> Layer {
        Layer::Water
    }
    /// The tile lattice (`apron` at least the solver's influence).
    fn tiles(&self) -> TileLattice;
    /// Solve one tile. Pure: the same tile always solves the same.
    fn solve(&self, tile: TileId, cx: &mut PlanCtx<'_>) -> Self::Tile;
    /// Write the columns of one chunk from the tiles around it.
    fn columns(&self, tiles: &TileSet<'_, Self::Tile>, batch: &mut ColumnBatch<'_, ()>);
}

/// What a province does to the volume.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Effect {
    /// Ground-attached deviation from the heightfield (crests, shelves,
    /// notches into a wall).
    Refine,
    /// A detached solid.
    Add,
    /// A void.
    Carve,
}

/// A voxel a province density is evaluated at: integer coordinates and
/// the voxel's centre.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoxelAt {
    /// World x.
    pub x: i32,
    /// World y.
    pub y: i32,
    /// World z.
    pub z: i32,
    /// `x + 0.5`.
    pub xf: f64,
    /// `y + 0.5`.
    pub yf: f64,
    /// `z + 0.5`.
    pub zf: f64,
}

impl VoxelAt {
    /// The voxel `(x, y, z)`.
    pub fn new(x: i32, y: i32, z: i32) -> Self {
        Self {
            x,
            y,
            z,
            xf: x as f64 + 0.5,
            yf: y as f64 + 0.5,
            zf: z as f64 + 0.5,
        }
    }
}

/// A province's view of its lattices at one voxel. The world-aligned band
/// lattices arrive with the volume pass's lattice set; until then a
/// province declaring a lattice is refused, every province is evaluated
/// directly, and the view is empty.
#[derive(Clone, Copy, Debug)]
pub struct LatticeView<'a> {
    _p: PhantomData<&'a ()>,
}

impl LatticeView<'_> {
    pub(crate) fn empty() -> Self {
        Self { _p: PhantomData }
    }
}

/// A 3D province owned by a landform (acquired with
/// [`BuildCtx::province`]): the landform writes per-column entries
/// (`Col::province`) and the volume pass evaluates them, faded at the
/// band's floor and ceiling and by the entry's weight.
pub trait Province: Send + Sync + 'static {
    /// Registry key, folded into the owner's identity stamp.
    const KIND: &'static str;
    /// Bumped whenever the province's output changes.
    const VERSION: u32;
    /// Typed per-column params.
    type Params: Fact;
    /// Refine, add or carve.
    const EFFECT: Effect;
    /// Extra 3D lattices, stride at least 3 (refused until the lattice set
    /// lands).
    fn lattices(&self) -> &[LatticeSpec] {
        &[]
    }
    /// Refine: solid > 0, and with every amplitude at zero it must equal
    /// the heightfield density `ground + 0.5 − y` (strict refinement). Add:
    /// a detached solid, solid > 0. Carve: remove > 0.
    fn density(&self, p: &Self::Params, at: VoxelAt, lat: &LatticeView<'_>) -> f64;
    /// Density depth over which the engine fades this province by its
    /// weight.
    fn fade_depth(&self) -> f64 {
        2.0
    }
}

/// A site set: structure placement. This build registers site sets and
/// validates their handles (the DAG records what they read); siting,
/// fits, pieces and markers arrive with the structure system, and until
/// then compile refuses an enabled site-set node rather than placing
/// nothing silently.
pub trait SiteSet: Sized + Send + Sync + 'static {
    /// Registry key.
    const KIND: &'static str;
    /// Bumped whenever the site set's output changes.
    const VERSION: u32;
    /// Typed params.
    type Params: DeserializeOwned + Serialize + Validate + Clone + Send + Sync;
    /// Acquire everything the site set reads.
    fn build(params: Self::Params, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError>;
}
