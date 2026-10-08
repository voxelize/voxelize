//! `KindRegistry`: the factories compile builds a spec's kinds from.
//!
//! Built-in kinds register exactly as a game's kinds do; a spec names a
//! kind by its key and hands it params as JSON. The factory deserializes
//! the params into the kind's typed `Params` (unknown fields refused,
//! errors path-qualified), validates them, builds the kind, and returns the
//! params re-serialized from their typed form, which is what the identity
//! hash covers: an absent `Option` and an explicit `null`, or `1` and
//! `1.0` for an `f64` field, hash alike.
//!
//! It registers the five plugin kinds: surfacers (paint), and landforms,
//! region solvers and site sets (the nodes of `spec.nodes`; provinces are
//! acquired by their landform through `BuildCtx::province`). A kind key
//! registers once across all node kinds: a second registration under the
//! same key is a programming error and panics, unless it says it replaces
//! (`replace_surfacer`, `replace_landform`). Built-in landforms carry a
//! rank in the engine's default composition order; a game landform with no
//! `over`/`under` edge composes after every built-in of its layer. (Named
//! apart from `voxelize::Registry`, which appears in the same compile
//! call.)
//!
//! Behind each node sits one type-erased adapter that owns nothing but the
//! typed kind; plan caches, fact stores and the DAG record live in the
//! compiled landscape, so game code never touches the erasure.

use std::any::{Any, TypeId};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::marker::PhantomData;
use std::sync::Arc;

use serde_json::Value;

use super::build::{BuildCtx, FieldRef};
use super::compose::Claims;
use super::compose::{BatchCtx, ColumnBatch, ComposeState};
use super::geometry::FadedFootprint;
use super::json;
use super::plan::PlanCtx;
use super::plugin::{
    Landform, Layer, Layout, RegionSolver, Site, SiteSet, TileId, TileLattice, TileSet,
};
use super::spec::{SpecError, Validate, Validator};
use super::surface::{DynSurfacer, PaintCtx, Surfacer};

type SurfacerFactory =
    fn(Value, &mut PaintCtx<'_>) -> Result<(Box<dyn DynSurfacer>, Value), SpecError>;

struct SurfacerEntry {
    version: u32,
    build: SurfacerFactory,
}

/// Which plugin kind a node kind is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NodeClass {
    Landform,
    Region,
    SiteSet,
}

/// A planned or position-pure landform's layout, resolved.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum LayoutRt {
    Cells {
        cell: i32,
        roll: f64,
        reach: i32,
    },
    Field {
        tile: i32,
        gate: FieldRef,
        fade: f64,
    },
    Once {
        reach: i32,
    },
    Region(TileLattice),
    Inert,
}

/// A solved plan, erased.
pub(crate) struct PlannedErased {
    pub plan: Arc<dyn Any + Send + Sync>,
    pub footprint: Option<FadedFootprint>,
    pub claims: Claims,
    pub exclusive: bool,
}

/// A landform behind a pointer.
pub(crate) trait DynLandform: Send + Sync {
    fn plan(&self, site: Site, cx: &mut PlanCtx<'_>) -> Option<PlannedErased>;
    fn field_plan(&self) -> Option<Arc<dyn Any + Send + Sync>>;
    fn columns(
        &self,
        plan: &(dyn Any + Send + Sync),
        st: &RefCell<ComposeState>,
        ctx: &BatchCtx<'_>,
        cols: &[(u32, f64, f64)],
    );
}

struct LandformNode<L: Landform>(L);

impl<L: Landform> DynLandform for LandformNode<L> {
    fn plan(&self, site: Site, cx: &mut PlanCtx<'_>) -> Option<PlannedErased> {
        self.0.plan(site, cx).map(|p| PlannedErased {
            plan: Arc::new(p.plan),
            footprint: p.footprint,
            claims: p.claims,
            exclusive: p.exclusive,
        })
    }

    fn field_plan(&self) -> Option<Arc<dyn Any + Send + Sync>> {
        self.0
            .field_plan()
            .map(|p| Arc::new(p) as Arc<dyn Any + Send + Sync>)
    }

    fn columns(
        &self,
        plan: &(dyn Any + Send + Sync),
        st: &RefCell<ComposeState>,
        ctx: &BatchCtx<'_>,
        cols: &[(u32, f64, f64)],
    ) {
        let plan = plan
            .downcast_ref::<L::Plan>()
            .expect("an instance's plan has its landform's plan type");
        let mut batch = ColumnBatch::<L::Cell> {
            st,
            ctx,
            cols,
            _c: PhantomData,
        };
        self.0.columns(plan, &mut batch);
    }
}

/// A region solver behind a pointer.
pub(crate) trait DynRegion: Send + Sync {
    fn solve(&self, tile: TileId, cx: &mut PlanCtx<'_>) -> Arc<dyn Any + Send + Sync>;
    fn columns(
        &self,
        tiles: &[(TileId, Arc<dyn Any + Send + Sync>)],
        size: i32,
        st: &RefCell<ComposeState>,
        ctx: &BatchCtx<'_>,
        cols: &[(u32, f64, f64)],
    );
}

struct RegionNode<R: RegionSolver>(R);

impl<R: RegionSolver> DynRegion for RegionNode<R> {
    fn solve(&self, tile: TileId, cx: &mut PlanCtx<'_>) -> Arc<dyn Any + Send + Sync> {
        Arc::new(self.0.solve(tile, cx))
    }

    fn columns(
        &self,
        tiles: &[(TileId, Arc<dyn Any + Send + Sync>)],
        size: i32,
        st: &RefCell<ComposeState>,
        ctx: &BatchCtx<'_>,
        cols: &[(u32, f64, f64)],
    ) {
        let typed: Vec<(TileId, Arc<R::Tile>)> = tiles
            .iter()
            .map(|(id, t)| {
                (
                    *id,
                    t.clone()
                        .downcast::<R::Tile>()
                        .unwrap_or_else(|_| panic!("a tile has its solver's tile type")),
                )
            })
            .collect();
        let set = TileSet {
            tiles: &typed,
            size,
        };
        let mut batch = ColumnBatch::<()> {
            st,
            ctx,
            cols,
            _c: PhantomData,
        };
        self.0.columns(&set, &mut batch);
    }
}

/// A built node's implementation.
pub(crate) enum NodeImp {
    Landform(Box<dyn DynLandform>),
    Region(Box<dyn DynRegion>),
    SiteSet,
}

/// What a node factory returns.
pub(crate) struct BuiltNode {
    pub imp: NodeImp,
    pub layer: Layer,
    pub layout: LayoutRt,
    pub typed: Value,
}

type NodeFactory = fn(Value, &mut BuildCtx<'_>) -> Result<BuiltNode, SpecError>;
type ParamsTyper = fn(Value, &str) -> Result<Value, SpecError>;

struct NodeEntry {
    class: NodeClass,
    version: u32,
    builtin: Option<u32>,
    type_id: TypeId,
    cell_type: Option<TypeId>,
    build: NodeFactory,
    typed: ParamsTyper,
}

/// The kinds a spec may name.
#[derive(Default)]
pub struct KindRegistry {
    surfacers: BTreeMap<&'static str, SurfacerEntry>,
    nodes: BTreeMap<&'static str, NodeEntry>,
}

fn typed_params<P: serde::de::DeserializeOwned + serde::Serialize + Validate>(
    params: Value,
    path: &str,
) -> Result<(P, Value), SpecError> {
    let typed: P = json::from_value(params).map_err(|e| SpecError {
        path: if e.at.is_empty() {
            path.to_string()
        } else {
            format!("{path}.{}", e.at)
        },
        message: e.message,
    })?;
    let mut v = Validator::new(path.to_string());
    typed.validate(&mut v);
    v.finish()?;
    let canonical = serde_json::to_value(&typed)
        .map_err(|e| SpecError::new(path, format!("params do not serialize: {e}")))?;
    Ok((typed, canonical))
}

fn build_surfacer<S: Surfacer>(
    params: Value,
    cx: &mut PaintCtx<'_>,
) -> Result<(Box<dyn DynSurfacer>, Value), SpecError> {
    let path = cx.path().to_string();
    let (typed, canonical) = typed_params::<S::Params>(params, &path)?;
    let built = S::build(typed, cx)?;
    Ok((Box::new(built), canonical))
}

/// The largest reach (and Field tile) a layout may declare, blocks: plans
/// are found by scanning the cells within reach, so an unbounded reach is
/// an unbounded scan.
pub const MAX_REACH: i32 = 8192;

fn layout_rt(layout: Layout, path: &str) -> Result<LayoutRt, SpecError> {
    let reach = match layout {
        Layout::Cells { reach, .. } | Layout::Once { reach } => reach,
        Layout::Field { tile, .. } => tile,
    };
    if reach > MAX_REACH {
        return Err(SpecError::new(
            path,
            format!("a layout's reach (or tile) of {reach} blocks is above the cap {MAX_REACH}"),
        ));
    }
    Ok(match layout {
        Layout::Cells { cell, roll, reach } => {
            if !(cell >= 16 && reach >= 0 && (0.0..=1.0).contains(&roll)) {
                return Err(SpecError::new(
                    path,
                    format!("a Cells layout needs cell >= 16, reach >= 0 and roll in 0..=1 (got cell {cell}, roll {roll}, reach {reach})"),
                ));
            }
            LayoutRt::Cells { cell, roll, reach }
        }
        Layout::Field { tile, gate, fade } => {
            if !(tile >= 16 && fade > 0.0 && fade.is_finite()) {
                return Err(SpecError::new(
                    path,
                    format!("a Field layout needs tile >= 16 and a positive fade (got tile {tile}, fade {fade})"),
                ));
            }
            LayoutRt::Field { tile, gate, fade }
        }
        Layout::Once { reach } => {
            if reach < 0 {
                return Err(SpecError::new(path, "a Once layout needs reach >= 0"));
            }
            LayoutRt::Once { reach }
        }
    })
}

fn build_landform<L: Landform>(
    params: Value,
    cx: &mut BuildCtx<'_>,
) -> Result<BuiltNode, SpecError> {
    let path = cx.path().to_string();
    let (typed, canonical) = typed_params::<L::Params>(params, &path)?;
    let built = L::build(typed, cx)?;
    let layer = built.layer();
    let layout = layout_rt(built.layout(), &format!("nodes.{}", cx.id()))?;
    Ok(BuiltNode {
        imp: NodeImp::Landform(Box::new(LandformNode(built))),
        layer,
        layout,
        typed: canonical,
    })
}

fn build_region<R: RegionSolver>(
    params: Value,
    cx: &mut BuildCtx<'_>,
) -> Result<BuiltNode, SpecError> {
    let path = cx.path().to_string();
    let (typed, canonical) = typed_params::<R::Params>(params, &path)?;
    let built = R::build(typed, cx)?;
    let layer = built.layer();
    let tiles = built.tiles();
    if !(tiles.size >= 16 && tiles.apron >= 0) {
        return Err(SpecError::new(
            format!("nodes.{}", cx.id()),
            format!(
                "a region solver needs tiles of at least 16 blocks and a non-negative apron (got {} and {})",
                tiles.size, tiles.apron
            ),
        ));
    }
    Ok(BuiltNode {
        imp: NodeImp::Region(Box::new(RegionNode(built))),
        layer,
        layout: LayoutRt::Region(tiles),
        typed: canonical,
    })
}

fn build_site_set<S: SiteSet>(
    params: Value,
    cx: &mut BuildCtx<'_>,
) -> Result<BuiltNode, SpecError> {
    let path = cx.path().to_string();
    let (typed, canonical) = typed_params::<S::Params>(params, &path)?;
    let _built = S::build(typed, cx)?;
    Ok(BuiltNode {
        imp: NodeImp::SiteSet,
        layer: Layer::Fit,
        layout: LayoutRt::Inert,
        typed: canonical,
    })
}

fn type_only<P: serde::de::DeserializeOwned + serde::Serialize + Validate>(
    params: Value,
    path: &str,
) -> Result<Value, SpecError> {
    typed_params::<P>(params, path).map(|(_, v)| v)
}

impl KindRegistry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Every built-in kind.
    pub fn with_builtins() -> Self {
        let mut r = Self::new();
        r.surfacer::<super::library::SurfaceRules>()
            .surfacer::<super::library::Ecotones>()
            .surfacer::<super::library::Zones>();
        r
    }

    /// Register surfacer `S` under `S::KIND`.
    ///
    /// # Panics
    ///
    /// When a surfacer is already registered under `S::KIND` (a built-in
    /// or an earlier game kind): replacing one is `replace_surfacer`.
    pub fn surfacer<S: Surfacer>(&mut self) -> &mut Self {
        assert!(
            !self.surfacers.contains_key(S::KIND),
            "surfacer kind {:?} is already registered; use replace_surfacer to replace it on purpose",
            S::KIND
        );
        self.replace_surfacer::<S>()
    }

    /// Register surfacer `S` under `S::KIND`, replacing any earlier kind
    /// with that key (its version stamps identity, so saved worlds see the
    /// change).
    pub fn replace_surfacer<S: Surfacer>(&mut self) -> &mut Self {
        self.surfacers.insert(
            S::KIND,
            SurfacerEntry {
                version: S::VERSION,
                build: build_surfacer::<S>,
            },
        );
        self
    }

    /// The version of a registered surfacer kind.
    pub fn surfacer_version(&self, kind: &str) -> Option<u32> {
        self.surfacers.get(kind).map(|e| e.version)
    }

    fn insert_node(&mut self, kind: &'static str, entry: NodeEntry, replace: bool) {
        if !replace {
            assert!(
                !self.nodes.contains_key(kind),
                "node kind {kind:?} is already registered; use replace_landform to replace a landform on purpose"
            );
        }
        self.nodes.insert(kind, entry);
    }

    /// Register landform `L` under `L::KIND` (a game kind: with no
    /// `over`/`under` edge it composes after every built-in of its layer).
    ///
    /// # Panics
    ///
    /// When a node kind is already registered under `L::KIND`.
    pub fn landform<L: Landform>(&mut self) -> &mut Self {
        self.insert_node(L::KIND, Self::landform_entry::<L>(None), false);
        self
    }

    /// Register landform `L`, replacing any earlier node kind with that key.
    pub fn replace_landform<L: Landform>(&mut self) -> &mut Self {
        self.insert_node(L::KIND, Self::landform_entry::<L>(None), true);
        self
    }

    /// Register landform `L` as an engine built-in with `rank` in the
    /// default composition order of its layer.
    pub(crate) fn builtin_landform<L: Landform>(&mut self, rank: u32) -> &mut Self {
        self.insert_node(L::KIND, Self::landform_entry::<L>(Some(rank)), false);
        self
    }

    fn landform_entry<L: Landform>(builtin: Option<u32>) -> NodeEntry {
        NodeEntry {
            class: NodeClass::Landform,
            version: L::VERSION,
            builtin,
            type_id: TypeId::of::<L>(),
            cell_type: Some(TypeId::of::<L::Cell>()),
            build: build_landform::<L>,
            typed: type_only::<L::Params>,
        }
    }

    /// Register region solver `R` under `R::KIND`.
    ///
    /// # Panics
    ///
    /// When a node kind is already registered under `R::KIND`.
    pub fn region_solver<R: RegionSolver>(&mut self) -> &mut Self {
        self.insert_node(
            R::KIND,
            NodeEntry {
                class: NodeClass::Region,
                version: R::VERSION,
                builtin: None,
                type_id: TypeId::of::<R>(),
                cell_type: None,
                build: build_region::<R>,
                typed: type_only::<R::Params>,
            },
            false,
        );
        self
    }

    /// Register site set `S` under `S::KIND`.
    ///
    /// # Panics
    ///
    /// When a node kind is already registered under `S::KIND`.
    pub fn site_set<S: SiteSet>(&mut self) -> &mut Self {
        self.insert_node(
            S::KIND,
            NodeEntry {
                class: NodeClass::SiteSet,
                version: S::VERSION,
                builtin: None,
                type_id: TypeId::of::<S>(),
                cell_type: None,
                build: build_site_set::<S>,
                typed: type_only::<S::Params>,
            },
            false,
        );
        self
    }

    /// The version of a registered node kind (landform, region solver or
    /// site set).
    pub fn node_version(&self, kind: &str) -> Option<u32> {
        self.nodes.get(kind).map(|e| e.version)
    }

    /// Registered node kinds, sorted.
    pub fn node_kinds(&self) -> Vec<&'static str> {
        self.nodes.keys().copied().collect()
    }

    pub(crate) fn landform_type(&self, kind: &str) -> Option<TypeId> {
        self.nodes
            .get(kind)
            .filter(|e| e.class == NodeClass::Landform)
            .map(|e| e.type_id)
    }

    pub(crate) fn landform_cell_type(&self, kind: &str) -> Option<TypeId> {
        self.nodes
            .get(kind)
            .filter(|e| e.class == NodeClass::Landform)
            .and_then(|e| e.cell_type)
    }

    /// Whether `kind` is a landform (it has plan-time footprints).
    pub(crate) fn is_planned(&self, kind: &str) -> bool {
        self.nodes
            .get(kind)
            .is_some_and(|e| e.class == NodeClass::Landform)
    }

    pub(crate) fn node_class(&self, kind: &str) -> Option<NodeClass> {
        self.nodes.get(kind).map(|e| e.class)
    }

    pub(crate) fn builtin_rank(&self, kind: &str) -> Option<u32> {
        self.nodes.get(kind).and_then(|e| e.builtin)
    }

    fn node_entry(&self, kind_path: &str, kind: &str) -> Result<&NodeEntry, SpecError> {
        self.nodes.get(kind).ok_or_else(|| {
            SpecError::new(
                kind_path,
                format!(
                    "unknown kind {kind:?} (registered: {})",
                    if self.nodes.is_empty() {
                        "none".to_string()
                    } else {
                        self.nodes.keys().copied().collect::<Vec<_>>().join(", ")
                    }
                ),
            )
        })
    }

    pub(crate) fn build_node(
        &self,
        kind_path: &str,
        kind: &str,
        params: Value,
        cx: &mut BuildCtx<'_>,
    ) -> Result<(BuiltNode, u32), SpecError> {
        let entry = self.node_entry(kind_path, kind)?;
        let built = (entry.build)(params, cx)?;
        Ok((built, entry.version))
    }

    /// Type and validate a (disabled) node's params without building it.
    pub(crate) fn type_node_params(
        &self,
        kind_path: &str,
        kind: &str,
        params: Value,
        path: &str,
    ) -> Result<(Value, u32), SpecError> {
        let entry = self.node_entry(kind_path, kind)?;
        Ok(((entry.typed)(params, path)?, entry.version))
    }

    pub(crate) fn build_surfacer(
        &self,
        kind_path: &str,
        kind: &str,
        params: Value,
        cx: &mut PaintCtx<'_>,
    ) -> Result<(Box<dyn DynSurfacer>, Value, u32), SpecError> {
        let entry = self.surfacers.get(kind).ok_or_else(|| {
            SpecError::new(
                kind_path,
                format!(
                    "unknown surfacer kind {kind:?} (registered: {})",
                    self.surfacers
                        .keys()
                        .copied()
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
        })?;
        let (s, v) = (entry.build)(params, cx)?;
        Ok((s, v, entry.version))
    }
}
