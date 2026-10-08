//! Test-only plugin kinds for the DAG, composition and spawn suites, and
//! the helpers that compile specs with them.
//!
//! - `test.probe`: a landform that acquires whatever its params name
//!   (plans, facts, occupancy, probes, roles, zones, claim keys, spawn) and
//!   never plans; or, with a Field layout, a gate and optionally a plan;
//! - `test.disc`: a Once-layout disc at fixed coordinates that raises the
//!   ground, optionally exclusive, with claims, a solid span, or as a spawn
//!   reader;
//! - `test.region`: a region solver raising the ground by a smooth function
//!   of position, its amplitude solved per tile;
//! - `test.sites`: a site set reading occupancy;
//! - `test.budget`: a landform whose plans spend probes under `par_map`
//!   with a per-item budget.

#![allow(dead_code)]

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use voxelize_gen::landscape::kit::{self, MesaCell, TestMesa};
use voxelize_gen::landscape::math::psin;
use voxelize_gen::landscape::plan::Work;
use voxelize_gen::landscape::prelude::*;
use voxelize_gen::landscape::presets::{Knobs, RoleBinding};
use voxelize_gen::landscape::spec::NodeSpec;
use voxelize_gen::landscape::{compile_with, CompileOptions, Landscape, Reject};

use crate::land::{config, demo_registry};

/// How `test.probe` reads composed ground.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum ThroughP {
    Macro,
    Layer(Layer),
    With(Vec<String>),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FieldLayoutP {
    pub gate: String,
    pub with_plan: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct ProbeParams {
    pub layer: Option<Layer>,
    pub plans_of: Option<String>,
    pub optional_plans_of: Option<String>,
    pub mesa_plans_of: Option<String>,
    pub facts_of: Option<String>,
    pub occupancy_of: Vec<String>,
    pub through: Option<ThroughP>,
    pub role: Option<String>,
    pub zone: Option<String>,
    pub claim_key: Option<String>,
    pub spawn: Option<i32>,
    pub noise: Option<String>,
    pub field_layout: Option<FieldLayoutP>,
}

impl Validate for ProbeParams {
    fn validate(&self, _: &mut Validator) {}
}

pub struct TestProbe {
    layer: Layer,
    gate: Option<(FieldRef, bool)>,
}

impl Landform for TestProbe {
    const KIND: &'static str = "test.probe";
    const VERSION: u32 = 1;
    type Params = ProbeParams;
    type Plan = ();
    type Cell = ();

    fn build(p: ProbeParams, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError> {
        if let Some(id) = &p.plans_of {
            cx.plans::<TestProbe>(id)?;
        }
        if let Some(id) = &p.optional_plans_of {
            cx.optional_plans::<TestProbe>(id)?;
        }
        if let Some(id) = &p.mesa_plans_of {
            cx.plans::<TestMesa>(id)?;
        }
        if let Some(id) = &p.facts_of {
            cx.fact::<MesaCell>(id)?;
        }
        if !p.occupancy_of.is_empty() {
            let ids: Vec<&str> = p.occupancy_of.iter().map(|s| s.as_str()).collect();
            cx.occupancy(&ids)?;
        }
        match &p.through {
            Some(ThroughP::Macro) => {
                cx.probe(Through::Macro)?;
            }
            Some(ThroughP::Layer(l)) => {
                cx.probe(Through::Layer(*l))?;
            }
            Some(ThroughP::With(ids)) => {
                let ids: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
                cx.probe(Through::With(&ids))?;
            }
            None => {}
        }
        if let Some(r) = &p.role {
            cx.role(r)?;
        }
        if let Some(z) = &p.zone {
            cx.zone(z)?;
        }
        if let Some(k) = &p.claim_key {
            cx.claim_key(k)?;
        }
        if let Some(c) = p.spawn {
            cx.spawn(c)?;
        }
        if let Some(n) = &p.noise {
            cx.noise(n, NoiseSpec::fbm(Size::Blocks(64.0), 1))?;
        }
        let gate = match &p.field_layout {
            Some(f) => Some((cx.field(&f.gate)?, f.with_plan)),
            None => None,
        };
        Ok(Self {
            layer: p.layer.unwrap_or(Layer::Uplift),
            gate,
        })
    }

    fn layer(&self) -> Layer {
        self.layer
    }

    fn layout(&self) -> Layout {
        match self.gate {
            Some((gate, _)) => Layout::Field {
                tile: 64,
                gate,
                fade: 0.1,
            },
            None => Layout::Cells {
                cell: 1024,
                roll: 0.0,
                reach: 0,
            },
        }
    }

    fn field_plan(&self) -> Option<()> {
        match self.gate {
            Some((_, true)) => Some(()),
            _ => None,
        }
    }

    fn columns(&self, _: &(), _: &mut ColumnBatch<'_, ()>) {}
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscParams {
    pub layer: Layer,
    pub center: (f64, f64),
    pub radius: f64,
    pub fade: f64,
    pub lift: f64,
    pub exclusive: bool,
    pub claims: u32,
    pub span: Option<(i32, i32)>,
    pub spawn_clear: Option<i32>,
}

impl Validate for DiscParams {
    fn validate(&self, v: &mut Validator) {
        v.check("radius", self.radius > 0.0, "positive");
        v.check("fade", self.fade > 0.0, "positive");
    }
}

pub struct TestDisc {
    p: DiscParams,
    spawn: Option<SpawnReader>,
    role: RoleId,
}

#[derive(Clone, Debug)]
pub struct DiscPlan {
    pub center: (f64, f64),
}

impl Landform for TestDisc {
    const KIND: &'static str = "test.disc";
    const VERSION: u32 = 1;
    type Params = DiscParams;
    type Plan = DiscPlan;
    type Cell = ();

    fn build(p: DiscParams, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError> {
        let spawn = match p.spawn_clear {
            Some(c) => Some(cx.spawn(c)?),
            None => None,
        };
        Ok(Self {
            role: cx.role("rock.hard")?,
            spawn,
            p,
        })
    }

    fn layer(&self) -> Layer {
        self.p.layer
    }

    fn layout(&self) -> Layout {
        let far = self.p.center.0.abs().fmax(self.p.center.1.abs());
        Layout::Once {
            reach: (far + self.p.radius + 2.0).ceil() as i32,
        }
    }

    fn plan(&self, _site: Site, cx: &mut PlanCtx<'_>) -> Option<Planned<DiscPlan>> {
        if let Some(r) = &self.spawn {
            let _ = cx.spawn(r);
        }
        let mut p = Planned::new(DiscPlan {
            center: self.p.center,
        })
        .footprint(Footprint::disc(self.p.center, self.p.radius).fade(self.p.fade))
        .claims(Claims(self.p.claims));
        if self.p.exclusive {
            p = p.exclusive();
        }
        Some(p)
    }

    fn columns(&self, _: &DiscPlan, batch: &mut ColumnBatch<'_, ()>) {
        for mut col in batch.iter() {
            col.ground_op(GroundOp::Raise { dh: self.p.lift });
            if let Some((lo, hi)) = self.p.span {
                let base = col.ground().floor() as i32;
                col.solid_span(base + lo, base + hi, self.role);
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionParams {
    pub amp: f64,
    pub size: i32,
    pub apron: i32,
}

impl Validate for RegionParams {
    fn validate(&self, _: &mut Validator) {}
}

pub struct TestRegion {
    p: RegionParams,
}

pub struct RegionTile {
    pub amp: f64,
    pub id: TileId,
}

impl RegionSolver for TestRegion {
    const KIND: &'static str = "test.region";
    const VERSION: u32 = 1;
    type Params = RegionParams;
    type Tile = RegionTile;

    fn build(p: RegionParams, _cx: &mut BuildCtx<'_>) -> Result<Self, SpecError> {
        Ok(Self { p })
    }

    fn tiles(&self) -> TileLattice {
        TileLattice {
            size: self.p.size,
            apron: self.p.apron,
        }
    }

    fn solve(&self, tile: TileId, cx: &mut PlanCtx<'_>) -> RegionTile {
        let _ = cx.meter().step(Work::FloodCells, 10);
        RegionTile {
            amp: self.p.amp,
            id: tile,
        }
    }

    fn columns(&self, tiles: &TileSet<'_, RegionTile>, batch: &mut ColumnBatch<'_, ()>) {
        for mut col in batch.iter() {
            let (_, t) = tiles
                .at(col.x(), col.z())
                .expect("the column's tile is solved");
            let dh = t.amp * 0.5 * (1.0 + psin(col.xf() / 40.0) * psin(col.zf() / 52.0));
            col.ground_op(GroundOp::Raise { dh });
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SitesParams {
    pub avoid: Vec<String>,
}

impl Validate for SitesParams {
    fn validate(&self, _: &mut Validator) {}
}

pub struct TestSites;

impl SiteSet for TestSites {
    const KIND: &'static str = "test.sites";
    const VERSION: u32 = 1;
    type Params = SitesParams;

    fn build(p: SitesParams, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError> {
        let ids: Vec<&str> = p.avoid.iter().map(|s| s.as_str()).collect();
        cx.occupancy(&ids)?;
        Ok(TestSites)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BudgetParams {
    pub per_item: u64,
    pub items: usize,
}

impl Validate for BudgetParams {
    fn validate(&self, _: &mut Validator) {}
}

pub struct TestBudget {
    p: BudgetParams,
    base: ProbeReader,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BudgetPlan {
    pub c: (f64, f64),
    pub r: f64,
    pub ok: usize,
    pub probes: u64,
}

impl Landform for TestBudget {
    const KIND: &'static str = "test.budget";
    const VERSION: u32 = 1;
    type Params = BudgetParams;
    type Plan = BudgetPlan;
    type Cell = ();

    fn build(p: BudgetParams, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError> {
        Ok(Self {
            base: cx.probe(Through::Macro)?,
            p,
        })
    }

    fn layer(&self) -> Layer {
        Layer::Detail
    }

    fn layout(&self) -> Layout {
        Layout::Cells {
            cell: 256,
            roll: 1.0,
            reach: 40,
        }
    }

    fn plan(&self, site: Site, cx: &mut PlanCtx<'_>) -> Option<Planned<BudgetPlan>> {
        let c = site.center();
        let mut s = cx.stream("items");
        let items: Vec<(f64, f64, u64)> = (0..self.p.items)
            .map(|i| {
                let k = 1 + (s.raw() % 4);
                (c.0 + i as f64 * 3.0, c.1, k)
            })
            .collect();
        let base = self.base;
        let out = cx.par_map(&items, self.p.per_item, |&(x, z, k), item| {
            let mut sum = 0.0;
            for j in 0..k {
                sum += item.probe_exact(&base, x + j as f64, z);
            }
            if item.meter().exceeded() {
                return Err(Reject::Budget);
            }
            Ok(sum)
        });
        let probes = cx.meter().count(Work::ProbeCalls);
        let ok = match out {
            Ok(v) => v.iter().filter(|r| r.is_ok()).count(),
            Err(_) => return None,
        };
        let r = 8.0 + 2.0 * ok as f64;
        Some(
            Planned::new(BudgetPlan { c, r, ok, probes })
                .footprint(Footprint::disc(c, r).fade(r * 0.5)),
        )
    }

    fn columns(&self, p: &BudgetPlan, batch: &mut ColumnBatch<'_, ()>) {
        for mut col in batch.iter() {
            col.ground_op(GroundOp::Raise {
                dh: 0.25 * p.ok as f64,
            });
        }
    }
}

/// Every built-in, the kit's test landforms, the sinkhole and the kinds
/// above.
pub fn kinds() -> KindRegistry {
    let mut r = kit::test_kinds();
    r.landform::<TestProbe>()
        .landform::<TestDisc>()
        .region_solver::<TestRegion>()
        .site_set::<TestSites>()
        .landform::<TestBudget>();
    crate::sinkhole::register(&mut r);
    r
}

/// The proving preset at `height` with the sinkholes.
pub fn proving_spec(height: u32) -> LandscapeSpec {
    crate::sinkhole::with_sinkholes(kit::proving_landscape(&Knobs {
        height,
        ..Knobs::default()
    }))
}

/// A probe node.
pub fn probe(salt: &str, p: ProbeParams) -> NodeSpec {
    NodeSpec::new(TestProbe::KIND, salt).params(p).unwrap()
}

/// A disc node.
pub fn disc(salt: &str, p: DiscParams) -> NodeSpec {
    NodeSpec::new(TestDisc::KIND, salt).params(p).unwrap()
}

/// Compile `spec` with every test kind, or the refusal.
pub fn try_compile(
    spec: &LandscapeSpec,
    seed: u32,
    options: &CompileOptions,
) -> Result<Arc<Landscape>, SpecError> {
    compile_with(
        spec,
        &kinds(),
        &RoleBinding::demo(),
        &demo_registry(),
        &config(seed, spec.frame.height as usize),
        options,
    )
}

/// Compile `spec` with every test kind.
pub fn compile(spec: &LandscapeSpec, seed: u32, options: &CompileOptions) -> Arc<Landscape> {
    try_compile(spec, seed, options).unwrap_or_else(|e| panic!("the spec compiles: {e}"))
}

/// The refusal of `spec`.
pub fn refusal(spec: &LandscapeSpec) -> SpecError {
    match try_compile(spec, 7, &CompileOptions::default()) {
        Ok(_) => panic!("the spec compiled, but it should be refused"),
        Err(e) => e,
    }
}
