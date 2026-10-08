//! The landform suite (feature `kit`) and the test landforms.
//!
//! **Test landforms.** Two small engine kinds exercise the plugin system
//! end to end, registered as built-ins by [`register_test_kinds`] (they
//! stand in for the library's landforms in tests and in the `proving`
//! preset; no shipped preset uses them):
//!
//! - [`TestMesa`] (`test.mesa`, Uplift, Cells layout): a disc tableland.
//!   Its flank is a [`Wall`] profile
//!   written as a `Build` soft clamp, `h = cur + profile·(top + k/2 − cur)`,
//!   so the top lands exactly on its target and the op is the identity
//!   wherever the profile is zero. Its footprint reaches a ring past the
//!   flank's foot, so the engine's fade ring holds columns whose ground is
//!   untouched bit for bit. Plan-level claim ROCK, per-column zones and a
//!   [`MesaCell`] record.
//! - [`TestSwell`] (`test.swell`, Detail, Field layout): a broad swell
//!   raised where a gate field (a local field of the node) is positive,
//!   faded by the engine from the gate.
//!
//! **The suite.** [`landform_suite!`](crate::landscape::kit::landform_suite)
//! generates, for one node of a spec:
//!
//! 1. `rare_and_within_reach`: an instance within reach of spawn;
//! 2. `deterministic_any_order_and_threads`, `caches_cost_only`,
//!    `grid_equals_point`, `height_map_matches_rescan` and
//!    `two_process_identical`: the determinism suite over the chunks of
//!    the nearest instance;
//! 3. `seamless`: neighbouring chunks agree on every shared column;
//! 4. `costs_nothing_elsewhere`: disabling the node leaves every chunk
//!    byte-identical outside its affected set, computed from the DAG (the
//!    node's footprints and, recursively, the instances of every node that
//!    reads it, in both variants);
//! 5. `edge_continuous`: the node's contribution is zero outside its
//!    footprints and jumps across their bounds by no more than its own
//!    steepest step inside; for a Field layout, across every dispatch-tile
//!    boundary too, and a dense check that tile gating never misses a
//!    column where the gate is positive;
//! 6. `lean_tiers_equal_full`: each tier's ground equals the full fold's
//!    ground after that tier's last layer, bit for bit;
//! 7. `ground_ops_identity`: every ground op is the identity, bit for bit,
//!    wherever its target asks no change, alone and through the fold;
//! 8. `plan_budget_rejections_zero`: no plan of the node was rejected for
//!    exceeding a work budget.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use voxelize::{Registry, Vec2, WorldConfig};

use crate::landscape::build::{BuildCtx, FieldRef, Noise, NoiseSpec, ProbeReader, Through};
use crate::landscape::compose::{Claims, ColumnBatch, GroundOp};
use crate::landscape::facts::Tier;
use crate::landscape::fields::nodes::fx;
use crate::landscape::geometry::{Aabb2, Footprint};
use crate::landscape::kit::determinism::{self, Case};
use crate::landscape::math::{clamp01, smootherstep, MinMax};
use crate::landscape::plan::PlanCtx;
use crate::landscape::plugin::{Fact, Landform, Layer, Layout, Planned, Site};
use crate::landscape::presets::{plain_landscape, Knobs};
use crate::landscape::profile::{Profile, Wall};
use crate::landscape::registry::KindRegistry;
use crate::landscape::spec::{
    FieldDef, Height, LandscapeSpec, NodeSpec, Size, SpecError, Validate, Validator,
};
use crate::landscape::surface::ZoneKey;
use crate::landscape::{CompileOptions, InstanceInfo, Landscape};
use crate::stream::HashStream;

/// [`TestMesa`]'s params.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestMesaParams {
    /// Cell size (a `Span`).
    pub cell: Size,
    /// Share of cells that try to plan.
    pub roll: f64,
    /// Radius of the flat top, low and high (`Span`s).
    pub radius: (Size, Size),
    /// Run of the flank from rim to foot, low and high (`Span`s).
    pub flank: (Size, Size),
    /// Rise of the top above the ground at the centre (amounts).
    pub rise: (Height, Height),
    /// Soft-clamp rounding width, blocks.
    pub round: f64,
    /// The named field that gates where mesas stand, and its minimum.
    pub country: (String, f64),
}

impl Validate for TestMesaParams {
    fn validate(&self, v: &mut Validator) {
        v.check(
            "cell",
            self.cell.raw() >= 128.0,
            "a mesa cell is at least 128 blocks",
        );
        v.unit("roll", self.roll);
        v.ordered("radius", (self.radius.0.raw(), self.radius.1.raw()));
        v.ordered("flank", (self.flank.0.raw(), self.flank.1.raw()));
        v.check(
            "radius",
            self.radius.0.raw() >= 8.0,
            "a mesa top is at least 8 blocks across",
        );
        v.check(
            "flank",
            self.flank.0.raw() >= 8.0,
            "a mesa flank runs at least 8 blocks",
        );
        v.ordered("rise", (self.rise.0.raw(), self.rise.1.raw()));
        v.range("round", self.round, 1.0..=8.0);
        v.check(
            "cell",
            (1.3 * (self.radius.1.raw() + self.flank.1.raw()) + 0.3 * self.flank.1.raw()) * 2.0
                <= self.cell.raw(),
            "the mesa and its fade must fit the cell",
        );
    }
}

/// A [`TestMesa`]'s per-column record.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MesaCell {
    /// Position up the flank: 0 at and beyond the foot, 1 on the top.
    pub u: f32,
}

impl Fact for MesaCell {}

/// A disc tableland (see the module docs).
pub struct TestMesa {
    p: TestMesaParams,
    cell: i32,
    radius: (f64, f64),
    flank: (f64, f64),
    rise: (f64, f64),
    sea: f64,
    country: FieldRef,
    base: ProbeReader,
    outline: Noise,
    crown: Noise,
    wall: ZoneKey,
    flat: ZoneKey,
    profile: Wall,
}

/// One mesa.
#[derive(Clone, Debug, PartialEq)]
pub struct MesaPlan {
    /// Centre.
    pub c: (f64, f64),
    /// Radius of the top.
    pub r: f64,
    /// Run of the flank.
    pub flank: f64,
    /// The top's height at the centre.
    pub top: f64,
    /// The rise above the ground at the centre.
    pub rise: f64,
}

impl Landform for TestMesa {
    const KIND: &'static str = "test.mesa";
    const VERSION: u32 = 1;
    type Params = TestMesaParams;
    type Plan = MesaPlan;
    type Cell = MesaCell;

    fn build(p: TestMesaParams, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError> {
        let f = *cx.frame();
        Ok(Self {
            cell: f.span(p.cell).round() as i32,
            radius: (f.span(p.radius.0), f.span(p.radius.1)),
            flank: (f.span(p.flank.0), f.span(p.flank.1)),
            rise: (f.amount(p.rise.0), f.amount(p.rise.1)),
            sea: f.sea as f64,
            country: cx.field(&p.country.0)?,
            base: cx.probe(Through::Macro)?,
            outline: cx.noise("outline", NoiseSpec::fbm(Size::Span(110.0), 3))?,
            crown: cx.noise("crown", NoiseSpec::fbm(Size::Span(90.0), 2))?,
            wall: cx.zone("wall")?,
            flat: cx.zone("flat")?,
            profile: Wall::new(1.6, 0.2, 0.2).expect("a valid flank"),
            p,
        })
    }

    fn layer(&self) -> Layer {
        Layer::Uplift
    }

    fn layout(&self) -> Layout {
        Layout::Cells {
            cell: self.cell,
            roll: self.p.roll,
            reach: (1.3 * (self.radius.1 + self.flank.1) + 0.3 * self.flank.1).ceil() as i32,
        }
    }

    fn plan(&self, site: Site, cx: &mut PlanCtx<'_>) -> Option<Planned<MesaPlan>> {
        let c = site.jittered(0.5);
        if cx.field(self.country, c.0, c.1) < self.p.country.1 {
            return None;
        }
        let mut s: HashStream = cx.stream("shape");
        let r = s.range_f(self.radius);
        let flank = s.range_f(self.flank);
        let rise = s.range_f(self.rise);
        let lip = cx.probe_exact(&self.base, c.0, c.1);
        if lip < self.sea + 4.0 {
            return None;
        }
        // The outline wobbles by up to 30%; the footprint holds it.
        let outer = 1.3 * (r + flank);
        let ring = 0.3 * flank;
        Some(
            Planned::new(MesaPlan {
                c,
                r,
                flank,
                top: lip + rise,
                rise,
            })
            .footprint(Footprint::disc(c, outer + ring).fade(0.5 * flank + ring))
            .claims(Claims::ROCK),
        )
    }

    fn columns(&self, p: &MesaPlan, batch: &mut ColumnBatch<'_, MesaCell>) {
        let k = self.p.round;
        let foot = p.r + p.flank;
        for mut col in batch.iter() {
            let (dx, dz) = (col.xf() - p.c.0, col.zf() - p.c.1);
            // Lobes and bays: the outline read on a ring 1.5 radii out.
            let wob = 1.0 + 0.3 * self.outline.ring(p.c, (col.xf(), col.zf()), 1.5 * p.r);
            let dist = (dx * dx + dz * dz).sqrt() / wob.fclamp(0.7, 1.3);
            let u = clamp01((foot - dist) / p.flank);
            let prof = self.profile.height(u);
            let cur = col.ground();
            // A crown that rolls a little, never a table-flat top.
            let top = p.top + 0.07 * p.rise * self.crown.at(col.xf(), col.zf());
            // Engaged, the clamp lands on the top; where the profile is
            // zero h == cur, so the op is the identity there.
            let h = if prof > 0.0 {
                cur + prof * (top + 0.5 * k - cur).fmax(0.0)
            } else {
                cur
            };
            col.ground_op(GroundOp::Build { h, k });
            if u >= 1.0 {
                col.zone(self.flat);
            } else if u > 0.0 {
                col.zone(self.wall);
            }
            col.cell(MesaCell { u: u as f32 });
        }
    }
}

/// [`TestSwell`]'s params.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestSwellParams {
    /// Wavelength of the gate's noise (a `Span`).
    pub wavelength: Size,
    /// The swell lives where the gate noise exceeds this.
    pub threshold: f64,
    /// Lift at the swell's heart (an amount).
    pub lift: Height,
    /// Gate value over which the engine fades the swell in.
    pub fade: f64,
    /// Dispatch tile, blocks.
    pub tile: i32,
}

impl Validate for TestSwellParams {
    fn validate(&self, v: &mut Validator) {
        v.check(
            "wavelength",
            self.wavelength.raw() >= 256.0,
            "a swell is at least 256 blocks long",
        );
        v.range("threshold", self.threshold, -0.9..=0.9);
        v.range("fade", self.fade, 0.01..=1.0);
        v.check(
            "tile",
            (16..=512).contains(&self.tile),
            "tiles are 16..=512 blocks",
        );
    }
}

/// A broad swell over a gate field (see the module docs).
pub struct TestSwell {
    p: TestSwellParams,
    gate: FieldRef,
    lift: f64,
}

/// The swell's world-constant plan.
#[derive(Clone, Debug, PartialEq)]
pub struct SwellPlan {
    /// Lift at the heart, blocks.
    pub lift: f64,
    /// Gate value where the lift is full.
    pub full: f64,
}

impl Landform for TestSwell {
    const KIND: &'static str = "test.swell";
    const VERSION: u32 = 1;
    type Params = TestSwellParams;
    type Plan = SwellPlan;
    type Cell = ();

    fn build(p: TestSwellParams, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError> {
        let salt = format!("{}.gate.noise", cx.salt());
        let gate = cx.local_field(
            "gate",
            FieldDef::detail(fx::affine(
                fx::noise(&salt, p.wavelength, 2, 1.0),
                1.0,
                -p.threshold,
            ))
            .strided(16),
        )?;
        Ok(Self {
            lift: cx.frame().amount(p.lift),
            gate,
            p,
        })
    }

    fn layer(&self) -> Layer {
        Layer::Detail
    }

    fn layout(&self) -> Layout {
        Layout::Field {
            tile: self.p.tile,
            gate: self.gate,
            fade: self.p.fade,
        }
    }

    fn field_plan(&self) -> Option<SwellPlan> {
        Some(SwellPlan {
            lift: self.lift,
            full: (0.6 - self.p.threshold).fmax(0.1),
        })
    }

    fn columns(&self, p: &SwellPlan, batch: &mut ColumnBatch<'_, ()>) {
        for mut col in batch.iter() {
            let g = col.field(self.gate);
            col.ground_op(GroundOp::Raise {
                dh: p.lift * smootherstep(0.0, p.full, g),
            });
        }
    }
}

/// Register the test landforms as built-ins (`test.mesa` with rank 100 in
/// Uplift, `test.swell` with rank 100 in Detail).
pub fn register_test_kinds(reg: &mut KindRegistry) -> &mut KindRegistry {
    reg.builtin_landform::<TestMesa>(100)
        .builtin_landform::<TestSwell>(100)
}

/// The built-in kinds plus the test landforms.
pub fn test_kinds() -> KindRegistry {
    let mut r = KindRegistry::with_builtins();
    register_test_kinds(&mut r);
    r
}

/// The mesa node of the `proving` preset.
pub fn mesa_node() -> NodeSpec {
    NodeSpec::new(TestMesa::KIND, "proving.mesas")
        .params(TestMesaParams {
            cell: Size::Span(768.0),
            roll: 0.55,
            radius: (Size::Span(40.0), Size::Span(80.0)),
            flank: (Size::Span(30.0), Size::Span(48.0)),
            rise: (Height::ShareOfRelief(0.06), Height::ShareOfRelief(0.11)),
            round: 4.0,
            country: ("land".to_string(), 0.9),
        })
        .expect("mesa params serialize")
}

/// The swell node of the `proving` preset.
pub fn swell_node() -> NodeSpec {
    NodeSpec::new(TestSwell::KIND, "proving.swells")
        .params(TestSwellParams {
            wavelength: Size::Span(900.0),
            threshold: 0.3,
            lift: Height::ShareOfRelief(0.03),
            fade: 0.15,
            tile: 64,
        })
        .expect("swell params serialize")
}

/// `kit.proving`: the plain preset with the test landforms (mesas in
/// Uplift, swells in Detail), for the suites, the renders and the
/// showcase.
pub fn proving_landscape(knobs: &Knobs) -> LandscapeSpec {
    let mut spec = plain_landscape(knobs)
        .with_node("mesas", mesa_node())
        .with_node("swells", swell_node());
    spec.preset = "kit.proving".to_string();
    paint_zone(&mut spec, "wall", "rock.layer.0", 3);
    spec
}

/// Paint zone `key` with `role` to `depth` voxels through the spec's
/// `zones` surfacer.
pub fn paint_zone(spec: &mut LandscapeSpec, key: &str, role: &str, depth: u16) {
    use crate::landscape::library::{ZonePaintParams, ZonesParams};
    let node = spec
        .paint
        .iter_mut()
        .find(|p| p.kind == "zones")
        .expect("the spec has a zones surfacer");
    let mut params: ZonesParams =
        serde_json::from_value(node.params.clone()).expect("zones params read back");
    params.zones.insert(
        key.to_string(),
        ZonePaintParams {
            role: role.to_string(),
            depth,
        },
    );
    node.params = serde_json::to_value(params).expect("zones params serialize");
}

// ---------------------------------------------------------------------
// The suite.

/// One landform suite case.
pub struct LandformCase<'a> {
    /// A name (printed in failures).
    pub name: &'a str,
    /// The node under test.
    pub node: &'a str,
    /// Compiles the landscape with the node enabled (`true`) or disabled,
    /// with the given options.
    pub build: &'a (dyn Fn(bool, &CompileOptions) -> Arc<Landscape> + Sync),
    /// The block registry.
    pub registry: &'a Registry,
    /// The world config.
    pub config: &'a WorldConfig,
    /// An instance must stand within this many blocks of spawn.
    pub within: f64,
}

fn on(case: &LandformCase<'_>) -> Arc<Landscape> {
    (case.build)(true, &CompileOptions::default())
}

/// The node's instance nearest to spawn within the case's reach.
pub fn nearest_instance(land: &Landscape, node: &str, within: f64) -> Option<InstanceInfo> {
    let (sx, sz) = land.spawn();
    let (sx, sz) = (sx as f64, sz as f64);
    let area = Aabb2::around(sx, sz, within);
    land.instances_in(area)
        .into_iter()
        .filter(|i| i.node == node)
        .min_by(|a, b| {
            let sq = |c: (f64, f64)| (c.0 - sx) * (c.0 - sx) + (c.1 - sz) * (c.1 - sz);
            let (da, db) = (sq(a.center), sq(b.center));
            da.total_cmp(&db).then(a.cell.cmp(&b.cell))
        })
}

fn chunk_of(land: &Landscape, x: f64, z: f64) -> (i32, i32) {
    let s = land.chunk_size() as f64;
    ((x / s).floor() as i32, (z / s).floor() as i32)
}

/// Where the case looks: the nearest instance's box (Cells and Once), or
/// for a Field node the box around the nearest admitted column found on a
/// coarse search.
fn case_box(case: &LandformCase<'_>, land: &Landscape) -> Aabb2 {
    if let Some(i) = nearest_instance(land, case.node, case.within) {
        return Aabb2 {
            min_x: i.bounds.0,
            min_z: i.bounds.1,
            max_x: i.bounds.2,
            max_z: i.bounds.3,
        };
    }
    let (sx, sz) = land.spawn();
    let step = 32;
    let r = case.within as i32;
    let mut k = 0;
    while k * step <= r {
        for dz in -k..=k {
            for dx in -k..=k {
                if dx.abs() != k && dz.abs() != k {
                    continue;
                }
                let (x, z) = (sx + dx * step, sz + dz * step);
                if land.node_gate_at(case.node, x, z).is_some_and(|g| g > 0.0) {
                    return Aabb2::around(x as f64, z as f64, 48.0);
                }
            }
        }
        k += 1;
    }
    panic!(
        "{}: node {:?} has no instance within {} of spawn",
        case.name, case.node, case.within
    );
}

/// The chunks the case generates: those covering the instance's box when
/// there are at most 16, else up to 9 chunks spaced along each axis of a
/// cross through its centre (bounds, fade ring and heart included).
pub fn case_chunks(case: &LandformCase<'_>, land: &Landscape) -> Vec<(i32, i32)> {
    let b = case_box(case, land);
    let (c0, c1) = (
        chunk_of(land, b.min_x, b.min_z),
        chunk_of(land, b.max_x, b.max_z),
    );
    let mut out = Vec::new();
    let n = (c1.0 - c0.0 + 1) * (c1.1 - c0.1 + 1);
    if n <= 16 {
        for cz in c0.1..=c1.1 {
            for cx in c0.0..=c1.0 {
                out.push((cx, cz));
            }
        }
    } else {
        let mid = chunk_of(land, 0.5 * (b.min_x + b.max_x), 0.5 * (b.min_z + b.max_z));
        let spaced = |lo: i32, hi: i32| -> Vec<i32> {
            let n = hi - lo;
            let mut v: Vec<i32> = (0..=8).map(|k| lo + n * k / 8).collect();
            v.dedup();
            v
        };
        for cx in spaced(c0.0, c1.0) {
            out.push((cx, mid.1));
        }
        for cz in spaced(c0.1, c1.1) {
            if !out.contains(&(mid.0, cz)) {
                out.push((mid.0, cz));
            }
        }
    }
    out
}

fn with_determinism<R>(case: &LandformCase<'_>, f: impl FnOnce(&Case<'_>) -> R) -> R {
    let land = on(case);
    let chunks = case_chunks(case, &land);
    let build = |o: &CompileOptions| (case.build)(true, o);
    f(&Case {
        name: case.name,
        build: &build,
        registry: case.registry,
        config: case.config,
        chunks: &chunks,
    })
}

/// An instance stands within reach of spawn.
pub fn assert_rare_and_within_reach(case: &LandformCase<'_>) {
    let land = on(case);
    let _ = case_box(case, &land);
}

/// Order and thread shuffles give the same digests.
pub fn assert_deterministic(case: &LandformCase<'_>) {
    with_determinism(case, determinism::assert_order_and_threads);
}

/// Caches at capacity one give the same digests.
pub fn assert_caches_cost_only(case: &LandformCase<'_>) {
    with_determinism(case, determinism::assert_caches_cost_only);
}

/// Every stored column of every chunk equals its point query.
pub fn assert_grid_equals_point(case: &LandformCase<'_>) {
    with_determinism(case, determinism::assert_grid_equals_point);
}

/// The writer's height map equals a rescan.
pub fn assert_height_map_matches_rescan(case: &LandformCase<'_>) {
    with_determinism(case, determinism::assert_height_map_matches_rescan);
}

/// A fresh process gives the same digests.
pub fn assert_two_process(case: &LandformCase<'_>, test_path: &str) {
    with_determinism(case, |c| determinism::assert_two_process(c, test_path));
}

/// Neighbouring chunks agree on every column they share.
pub fn assert_seamless(case: &LandformCase<'_>) {
    let land = on(case);
    let chunks = case_chunks(case, &land);
    for &(cx, cz) in &chunks {
        let a = land.chunk_facts(Vec2(cx, cz));
        for (nx, nz) in [(cx + 1, cz), (cx, cz + 1)] {
            let b = land.chunk_facts(Vec2(nx, nz));
            let area = a.area();
            for dz in 0..area.d {
                for dx in 0..area.w {
                    let (x, z) = (area.x0 + dx as i32, area.z0 + dz as i32);
                    if let Some(cb) = b.column(x, z, land.sea()) {
                        let ca = a.column(x, z, land.sea()).unwrap();
                        assert!(
                            ca == cb,
                            "{}: chunks ({cx}, {cz}) and ({nx}, {nz}) disagree at ({x}, {z}): {ca:?} vs {cb:?}",
                            case.name
                        );
                    }
                }
            }
        }
    }
}

/// Disabling the node leaves every chunk byte-identical outside its
/// affected set.
pub fn assert_costs_nothing_elsewhere(case: &LandformCase<'_>) {
    let a = on(case);
    let b = (case.build)(false, &CompileOptions::default());
    let core = case_box(case, &a);
    let window = core.grow(160.0);
    let mut boxes = a.affected_by(case.node, window);
    // Readers may plan differently once the node is gone: their instances
    // meeting the set join it, in either variant, until it stops growing.
    let readers = a.readers_of(case.node);
    loop {
        let before = boxes.len();
        for r in &readers {
            for land in [&a, &b] {
                for bb in land.node_instance_bounds(r, window.grow(512.0)) {
                    if boxes.iter().any(|x| x.intersects(&bb)) && !boxes.contains(&bb) {
                        boxes.push(bb);
                    }
                }
            }
        }
        if boxes.len() == before {
            break;
        }
    }
    let margin = (a.halo() + 1 + crate::landscape::flora::MAX_CANOPY) as f64;
    let (c0, c1) = (
        chunk_of(&a, window.min_x, window.min_z),
        chunk_of(&a, window.max_x, window.max_z),
    );
    let s = a.chunk_size() as f64;
    let mut compared = 0;
    let mut affected = 0;
    for cz in c0.1..=c1.1 {
        for cx in c0.0..=c1.0 {
            let reach = Aabb2 {
                min_x: cx as f64 * s - margin,
                min_z: cz as f64 * s - margin,
                max_x: (cx + 1) as f64 * s + margin,
                max_z: (cz + 1) as f64 * s + margin,
            };
            if boxes.iter().any(|bb| bb.intersects(&reach)) {
                affected += 1;
                continue;
            }
            let va = determinism::chunk_digest(&determinism::generate(
                &a,
                case.registry,
                case.config,
                cx,
                cz,
            ));
            let vb = determinism::chunk_digest(&determinism::generate(
                &b,
                case.registry,
                case.config,
                cx,
                cz,
            ));
            let fa = a.chunk_facts(Vec2(cx, cz)).digest();
            let fb = b.chunk_facts(Vec2(cx, cz)).digest();
            assert!(
                va == vb && fa == fb,
                "{}: chunk ({cx}, {cz}) lies outside the affected set of {:?} but changed when it was disabled",
                case.name,
                case.node
            );
            compared += 1;
        }
    }
    assert!(
        compared > 0 && affected > 0,
        "{}: costs_nothing_elsewhere compared {compared} chunk(s) outside and found {affected} inside the affected set",
        case.name
    );
}

/// The node's contribution is continuous at its bounds (and across Field
/// dispatch tiles), and tile gating never misses.
pub fn assert_edge_continuous(case: &LandformCase<'_>) {
    let a = on(case);
    let b = (case.build)(false, &CompileOptions::default());
    let core = case_box(case, &a).grow(24.0);
    let (x0, z0) = (core.min_x.floor() as i32, core.min_z.floor() as i32);
    let (w, d) = (
        (core.max_x - core.min_x).ceil() as usize + 1,
        (core.max_z - core.min_z).ceil() as usize + 1,
    );
    let ga = a.ground_window(x0, z0, w, d, 1);
    let gb = b.ground_window(x0, z0, w, d, 1);
    let delta: Vec<f64> = ga.iter().zip(&gb).map(|(p, q)| p - q).collect();
    let fps = a.node_footprints(case.node, core.grow(64.0));
    let gate = |x: i32, z: i32| a.node_gate_at(case.node, x, z);
    let inside = |x: i32, z: i32| -> bool {
        let (xf, zf) = (x as f64 + 0.5, z as f64 + 0.5);
        if fps.iter().any(|f| f.footprint.sdf_inside(xf, zf) > 0.0) {
            return true;
        }
        gate(x, z).is_some_and(|g| g > 0.0)
    };
    // The node's own steepest step inside, over every adjacent pair.
    let mut steepest = 0.0f64;
    let mut max_delta = 0.0f64;
    for j in 0..d {
        for i in 0..w {
            let k = j * w + i;
            max_delta = max_delta.fmax(delta[k].abs());
            let (x, z) = (x0 + i as i32, z0 + j as i32);
            if !inside(x, z) {
                assert!(
                    delta[k] == 0.0,
                    "{}: column ({x}, {z}) lies outside every footprint of {:?} but moved by {}",
                    case.name,
                    case.node,
                    delta[k]
                );
                continue;
            }
            for (ni, nj) in [(i + 1, j), (i, j + 1)] {
                if ni < w && nj < d && inside(x0 + ni as i32, z0 + nj as i32) {
                    steepest = steepest.fmax((delta[nj * w + ni] - delta[k]).abs());
                }
            }
        }
    }
    assert!(
        max_delta > 0.0,
        "{}: the node changed nothing in its box",
        case.name
    );
    // Across every bound: no larger than the steepest step inside.
    let mut crossings = 0;
    for j in 0..d {
        for i in 0..w {
            let (x, z) = (x0 + i as i32, z0 + j as i32);
            for (ni, nj) in [(i + 1, j), (i, j + 1)] {
                if ni >= w || nj >= d {
                    continue;
                }
                let (nx, nz) = (x0 + ni as i32, z0 + nj as i32);
                if inside(x, z) != inside(nx, nz) {
                    crossings += 1;
                    let jump = (delta[nj * w + ni] - delta[j * w + i]).abs();
                    assert!(
                        jump <= steepest + 1e-9,
                        "{}: the contribution of {:?} jumps {jump} across its bound between ({x}, {z}) and ({nx}, {nz}) (steepest inside {steepest})",
                        case.name,
                        case.node
                    );
                }
            }
        }
    }
    assert!(
        crossings > 0,
        "{}: no footprint bound crossed the box",
        case.name
    );
    // Field layouts: across dispatch-tile boundaries, and a dense check.
    if let Some(tile) = a.node_tile(case.node) {
        for j in 0..d {
            for i in 0..w {
                let (x, z) = (x0 + i as i32, z0 + j as i32);
                if gate(x, z).is_some_and(|g| g > 0.0) {
                    let t = (x.div_euclid(tile), z.div_euclid(tile));
                    assert!(
                        a.node_tile_admitted(case.node, t),
                        "{}: column ({x}, {z}) has a positive gate but its dispatch tile {t:?} was not admitted",
                        case.name
                    );
                }
                if (x + 1).rem_euclid(tile) == 0 && i + 1 < w {
                    let jump = (delta[j * w + i + 1] - delta[j * w + i]).abs();
                    assert!(
                        jump <= steepest + 1e-9,
                        "{}: the contribution jumps {jump} across a dispatch-tile boundary at x = {}",
                        case.name,
                        x + 1
                    );
                }
                if (z + 1).rem_euclid(tile) == 0 && j + 1 < d {
                    let jump = (delta[(j + 1) * w + i] - delta[j * w + i]).abs();
                    assert!(
                        jump <= steepest + 1e-9,
                        "{}: the contribution jumps {jump} across a dispatch-tile boundary at z = {}",
                        case.name,
                        z + 1
                    );
                }
            }
        }
    }
}

/// Each tier's ground equals the full fold's ground after that tier's last
/// layer, bit for bit.
pub fn assert_lean_tiers_equal_full(case: &LandformCase<'_>) {
    let land = on(case);
    let core = case_box(case, &land);
    let cut = [
        (Tier::Shaped, Layer::Shore),
        (Tier::Hydro, Layer::Water),
        (Tier::PreFit, Layer::Detail),
        (Tier::Full, Layer::Fit),
    ];
    let mut checked = 0;
    let mut z = core.min_z.floor() as i32;
    while z as f64 <= core.max_z {
        let mut x = core.min_x.floor() as i32;
        while x as f64 <= core.max_x {
            let e = land.explain(x, z);
            for (tier, last) in cut {
                let mut raw = e.spine;
                for (layer, g) in &e.compose.layers {
                    let l = Layer::ALL
                        .iter()
                        .find(|l| l.name() == layer)
                        .copied()
                        .unwrap();
                    if l <= last {
                        raw = *g;
                    }
                }
                let want = land.final_ground(raw);
                let got = land.column_ground(x, z, tier);
                assert_eq!(
                    want.to_bits(),
                    got.to_bits(),
                    "{}: column ({x}, {z}) at {tier:?}: the fold says {want}, the tier {got}",
                    case.name
                );
                assert_eq!(
                    land.column(x, z, tier).ground.to_bits(),
                    got.to_bits(),
                    "{}: column ({x}, {z}) at {tier:?}: column() and column_ground() disagree",
                    case.name
                );
            }
            checked += 1;
            x += 7;
        }
        z += 7;
    }
    assert!(checked > 0);
}

/// Every ground op is the identity, bit for bit, wherever its target asks
/// no change: alone, at any weight, over random inputs (±0.0 included).
pub fn assert_ground_ops_identity() {
    let mut s = HashStream::new(0x6E0F_5EED);
    for n in 0..20_000 {
        let cur = match n % 50 {
            0 => 0.0,
            1 => -0.0,
            _ => (s.unit() - 0.5) * 1000.0,
        };
        let d = s.unit() * 50.0;
        let k = s.unit() * 8.0;
        let t = s.unit();
        for op in [
            GroundOp::Carve { h: cur + d, k },
            GroundOp::Carve { h: cur, k },
            GroundOp::Build { h: cur - d, k },
            GroundOp::Build { h: cur, k },
            GroundOp::Set { h: cur, w: t },
            GroundOp::Set { h: cur + d, w: 0.0 },
            GroundOp::Raise { dh: 0.0 },
        ] {
            assert_eq!(op.apply(cur).to_bits(), cur.to_bits(), "{op:?} at {cur}");
            assert_eq!(
                op.fold(cur, t).to_bits(),
                cur.to_bits(),
                "{op:?} at {cur}, t {t}"
            );
        }
        // Any op at weight zero.
        let op = GroundOp::Carve {
            h: cur - d - 1.0,
            k,
        };
        assert_eq!(op.fold(cur, 0.0).to_bits(), cur.to_bits());
        // Engaged offsets.
        if k > 0.0 {
            let deep = GroundOp::Carve { h: cur - k - d, k }.apply(cur);
            assert_eq!(deep, cur - k - d + 0.5 * k);
        }
    }
}

/// No plan of the node was rejected for exceeding a work budget.
pub fn assert_plan_budget_rejections_zero(case: &LandformCase<'_>) {
    let land = on(case);
    for (cx, cz) in case_chunks(case, &land) {
        let _ = land.chunk_facts(Vec2(cx, cz));
    }
    for s in land.plan_stats() {
        if s.node == case.node {
            assert_eq!(
                s.rejected_budget, 0,
                "{}: {} plan(s) of {:?} exceeded a work budget",
                case.name, s.rejected_budget, case.node
            );
        }
    }
}

/// Generate the landform suite for one node of a spec:
///
/// ```ignore
/// voxelize_gen::landscape::kit::landform_suite! {
///     sinkholes,
///     node = "sinkholes",
///     build = |enabled: bool, o: &CompileOptions| my_landscape(enabled, o),
///     registry = my_registry(),
///     config = my_config(),
///     within = 4000.0,
/// }
/// ```
#[doc(hidden)]
#[macro_export]
macro_rules! __landscape_landform_suite {
    ($name:ident, node = $node:expr, build = $build:expr, registry = $registry:expr, config = $config:expr, within = $within:expr $(,)?) => {
        mod $name {
            #[allow(unused_imports)]
            use super::*;
            use $crate::landscape::kit::landform as kit;

            fn with_case(f: impl FnOnce(&kit::LandformCase<'_>)) {
                let registry = $registry;
                let config = $config;
                let build = $build;
                let build_ref: &(dyn Fn(
                    bool,
                    &$crate::landscape::CompileOptions,
                ) -> ::std::sync::Arc<$crate::landscape::Landscape>
                      + Sync) = &build;
                f(&kit::LandformCase {
                    name: stringify!($name),
                    node: $node,
                    build: build_ref,
                    registry: &registry,
                    config: &config,
                    within: $within,
                });
            }

            #[test]
            fn rare_and_within_reach() {
                with_case(kit::assert_rare_and_within_reach);
            }

            #[test]
            fn deterministic_any_order_and_threads() {
                with_case(kit::assert_deterministic);
            }

            #[test]
            fn caches_cost_only() {
                with_case(kit::assert_caches_cost_only);
            }

            #[test]
            fn grid_equals_point() {
                with_case(kit::assert_grid_equals_point);
            }

            #[test]
            fn height_map_matches_rescan() {
                with_case(kit::assert_height_map_matches_rescan);
            }

            #[test]
            fn two_process_identical() {
                let path = module_path!();
                let inner = path.split_once("::").map_or(path, |(_, rest)| rest);
                let test = format!("{inner}::two_process_identical");
                with_case(|case| kit::assert_two_process(case, &test));
            }

            #[test]
            fn seamless() {
                with_case(kit::assert_seamless);
            }

            #[test]
            fn costs_nothing_elsewhere() {
                with_case(kit::assert_costs_nothing_elsewhere);
            }

            #[test]
            fn edge_continuous() {
                with_case(kit::assert_edge_continuous);
            }

            #[test]
            fn lean_tiers_equal_full() {
                with_case(kit::assert_lean_tiers_equal_full);
            }

            #[test]
            fn ground_ops_identity() {
                kit::assert_ground_ops_identity();
            }

            #[test]
            fn plan_budget_rejections_zero() {
                with_case(kit::assert_plan_budget_rejections_zero);
            }
        }
    };
}

pub use crate::__landscape_landform_suite as landform_suite;
