//! A game adds a landform in one file: a karst sinkhole.
//!
//! Everything a game writes to add a landform to `landscape` is in this
//! file, and nothing in voxelize changes: the typed params with their
//! validation, a per-column record later nodes can read, a carve province
//! (a notch into the bowl wall), the landform itself (what it reads, its
//! layer, its layout, its plan and its columns), its registration, and
//! the spec edits that place it in a world (docs/landscape.md, section 9).
//!
//! The sinkhole is a worn bowl: a `Wall` profile written as a `Carve`
//! soft clamp, `h = cur − profile·(cur − floor + k/2)`, so the floor lands
//! exactly where planned and the op is the identity wherever the profile
//! is zero (the rim and the engine's fade ring). It reads the game's
//! `karst` field to choose its country, composed ground through the
//! Uplift layer (it sits on mesas and plain alike), and the plan-time
//! footprints of the mesas to keep off their rock. It claims HYDRO at plan
//! level and NO_SITES in the bowl, writes its own zone (painted with a
//! game role), lowers the cave ceiling under its floor, and records its
//! normalised distance per column.
//!
//! Its pond (a still water declaration on the floor) and its rim anchor for
//! a lookout structure join when water declarations and the structure
//! system land; the code for them is the only part of the walkthrough
//! missing here.
//!
//! Run it to see the DAG and the provenance of a sinkhole's columns:
//!
//! ```text
//! cargo run -p voxelize-gen --release --features unstable-landscape,kit --example sinkhole -- [--seed 7]
//! ```
//!
//! The tests, the offline renderer and the showcase include this same file
//! (`#[path = "sinkhole.rs"]`), so the landform proven there is this one.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use voxelize_gen::landscape::prelude::*;
use voxelize_gen::landscape::profile::{Monotone, Profile};
use voxelize_gen::landscape::spec::{NodeSpec, ZoneDecl};

/// The sinkhole's params, as the spec writes them.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SinkholeParams {
    /// Plan cell (a `Span`: follows the scale knob).
    pub cell: Size,
    /// Share of cells that try to plan.
    pub roll: f64,
    /// Bowl radius, low and high (`Span`s).
    pub radius: (Size, Size),
    /// Depth below the local ground, low and high (amounts).
    pub depth: (Height, Height),
    /// Soft-clamp rounding width, blocks.
    pub round: f64,
    /// Depth of the notch cut into the bowl wall, blocks; `None` for no
    /// overhang.
    pub notch: Option<f64>,
    /// The game field that marks karst country, and its threshold.
    pub karst: (String, f64),
}

impl Validate for SinkholeParams {
    fn validate(&self, v: &mut Validator) {
        v.span("cell", self.cell, 256.0..=8192.0);
        v.unit("roll", self.roll);
        v.ordered_span("radius", self.radius, 8.0..=128.0);
        v.check(
            "radius",
            v.size(self.radius.1) * 1.6 * 2.0 <= v.size(self.cell),
            "plan and fade must fit the cell",
        );
        v.ordered("depth", (self.depth.0.raw(), self.depth.1.raw()));
        v.range("round", self.round, 1.0..=6.0);
        if let Some(n) = self.notch {
            v.range("notch", n, 1.0..=6.0);
        }
    }
}

/// The sinkhole's per-column record: distance from the centre over the
/// bowl radius (1 at the rim). Later nodes read it with
/// `BuildCtx::fact::<SinkholeCell>("sinkholes")`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SinkholeCell {
    /// Normalised distance.
    pub d: f32,
}

impl Fact for SinkholeCell {}

/// The notch's per-column params.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NotchParams {
    /// Centre x.
    pub cx: f32,
    /// Centre z.
    pub cz: f32,
    /// Radius of the groove's centre ring.
    pub ring: f32,
    /// Half width of the groove.
    pub half: f32,
    /// Height of the groove's waist.
    pub waist: f32,
}

impl Fact for NotchParams {}

/// A carve province: a rounded groove cut into the bowl wall, centred on a
/// ring just behind the wall's face at mid height.
pub struct Notch;

impl Province for Notch {
    const KIND: &'static str = "game.sinkhole.notch";
    const VERSION: u32 = 1;
    type Params = NotchParams;
    const EFFECT: Effect = Effect::Carve;

    fn density(&self, p: &NotchParams, at: VoxelAt, _: &LatticeView<'_>) -> f64 {
        let (dx, dz) = (at.xf - p.cx as f64, at.zf - p.cz as f64);
        // Distance from the groove's centre ring.
        let radial = ((dx * dx + dz * dz).sqrt() - p.ring as f64).abs();
        // Closes 3 blocks above and below its waist.
        let v = (at.yf - p.waist as f64) / 3.0;
        p.half as f64 * (1.0 - v * v) - radial
    }
}

/// The landform.
pub struct Sinkhole {
    p: SinkholeParams,
    cell: i32,
    radius: (f64, f64),
    depth: (f64, f64),
    sea: f64,
    karst: FieldRef,
    probe: ProbeReader,
    avoid: ClaimReader,
    outline: Noise,
    notch: ProvinceHandle<NotchParams>,
    wall_zone: ZoneKey,
    bowl: profile::Wall,
}

/// One sinkhole.
#[derive(Clone, Debug, PartialEq)]
pub struct SinkholePlan {
    /// Centre.
    pub c: (f64, f64),
    /// Bowl radius.
    pub r: f64,
    /// Floor height.
    pub floor: f64,
    /// Ground at the centre before the bowl.
    pub lip: f64,
}

/// Where the notch sits up the wall: the share of the bowl's depth below
/// the lip.
const NOTCH_SHARE: f64 = 0.45;

/// The share of the radius the wall spans, rim inward; the rest is a
/// rounded floor.
const WALL_SHARE: f64 = 0.65;

impl Landform for Sinkhole {
    const KIND: &'static str = "game.sinkhole";
    const VERSION: u32 = 1;
    type Params = SinkholeParams;
    type Plan = SinkholePlan;
    type Cell = SinkholeCell;

    fn build(p: SinkholeParams, cx: &mut BuildCtx<'_>) -> Result<Self, SpecError> {
        let f = *cx.frame();
        Ok(Self {
            cell: f.span(p.cell).round() as i32,
            radius: (f.span(p.radius.0), f.span(p.radius.1)),
            depth: (f.amount(p.depth.0), f.amount(p.depth.1)),
            sea: f.sea as f64,
            // Edge: field karst -> sinkholes.
            karst: cx.field(&p.karst.0)?,
            // Edges: every Uplift writer -> sinkholes.
            probe: cx.probe(Through::Layer(Layer::Incise))?,
            // Edge: mesas -> sinkholes (plan-time footprints, any layer).
            avoid: cx.occupancy(&["mesas"])?,
            outline: cx.noise("outline", NoiseSpec::fbm(Size::Blocks(40.0), 2))?,
            notch: cx.province(Notch)?,
            // Declared in spec.zones.
            wall_zone: cx.zone("game.sinkhole_wall")?,
            // C1: a rounded floor and a level rim.
            bowl: profile::Wall::new(2.2, 0.1, 0.15).expect("a valid bowl"),
            p,
        })
    }

    fn layer(&self) -> Layer {
        Layer::Incise
    }

    fn layout(&self) -> Layout {
        Layout::Cells {
            cell: self.cell,
            roll: self.p.roll,
            reach: (self.radius.1 * 1.6).ceil() as i32,
        }
    }

    fn plan(&self, site: Site, cx: &mut PlanCtx<'_>) -> Option<Planned<SinkholePlan>> {
        let (x, z) = site.jittered(0.6);
        // Country gate.
        if cx.field(self.karst, x, z) < self.p.karst.1 {
            return None;
        }
        let mut s = cx.stream("shape");
        let r = s.range_f(self.radius);
        if cx.claimed(
            &self.avoid,
            &Footprint::disc((x, z), r * 1.6),
            Claims::ROCK | Claims::HYDRO,
        ) {
            return None;
        }
        let lip = cx.probe_exact(&self.probe, x, z);
        if lip < self.sea + 6.0 {
            return None;
        }
        // The floor stays above the sea: a flooded bowl is a pond, which
        // arrives with water declarations.
        let floor = (lip - s.range_f(self.depth)).fmax(self.sea + 3.0);
        if lip - floor < 6.0 {
            return None;
        }
        Some(
            Planned::new(SinkholePlan {
                c: (x, z),
                r,
                floor,
                lip,
            })
            // edge(): 0 at 1.6 r, 1 inside 1.0 r.
            .footprint(Footprint::disc((x, z), r * 1.6).fade(r * 0.6))
            // Drainage keeps out, faded by the edge.
            .claims(Claims::HYDRO),
        )
    }

    fn columns(&self, p: &SinkholePlan, batch: &mut ColumnBatch<'_, SinkholeCell>) {
        let k = self.p.round;
        // Where the wall passes the notch's waist: the profile (0 at the
        // rim, 1 where the floor begins, as a function of
        // u = (1 − d) / WALL_SHARE) stands at the notch's share of the depth.
        let d_notch = 1.0 - WALL_SHARE * self.bowl.inverse(NOTCH_SHARE);
        let waist = p.lip - NOTCH_SHARE * (p.lip - p.floor);
        for mut col in batch.iter() {
            let wob = 1.0 + 0.08 * self.outline.ring(p.c, (col.xf(), col.zf()), 4.0 * p.r);
            let (dx, dz) = (col.xf() - p.c.0, col.zf() - p.c.1);
            let dist = (dx * dx + dz * dz).sqrt();
            let d = dist / (p.r * wob);
            // 1 on the floor, 0 at and beyond the rim.
            let prof = self.bowl.height(clamp01((1.0 - d) / WALL_SHARE));
            let cur = col.ground();
            // Engaged, the soft clamp lands on the floor; where the profile
            // is zero (rim, fade ring) h == cur, so the op is the identity
            // there and the bowl leaves no ring outside itself.
            let h = if prof > 0.0 {
                cur - prof * (cur - p.floor + 0.5 * k).fmax(0.0)
            } else {
                cur
            };
            // The engine multiplies the op by col.weight().
            col.ground_op(GroundOp::Carve { h, k });
            // The bowl, not the rim.
            col.claim_scaled(Claims::NO_SITES.into(), 1.0 - smoothstep(0.9, 1.05, d));
            if prof > 0.0 {
                col.zone(self.wall_zone);
            }
            col.cell(SinkholeCell { d: d as f32 });
            if let Some(reach) = self.p.notch {
                // The groove's centre ring sits half its depth behind the
                // wall's face at the waist, so it cuts into the wall.
                let ring = p.r * wob * d_notch + 0.5 * reach;
                if (dist - ring).abs() < 0.5 * reach + 1.0 {
                    // Density < 0 on this bound: no cut edge.
                    col.province(
                        &self.notch,
                        waist as i32 - 3,
                        waist as i32 + 3,
                        NotchParams {
                            cx: p.c.0 as f32,
                            cz: p.c.1 as f32,
                            ring: ring as f32,
                            half: (0.5 * reach) as f32,
                            waist: waist as f32,
                        },
                    );
                } else if dist < ring - 0.5 * reach - 1.0 {
                    // Caves stay below the floor, inside the notch's ring.
                    col.cave_ceiling(p.floor as i32 - 6);
                }
            } else if d < 1.0 {
                col.cave_ceiling(p.floor as i32 - 6);
            }
        }
    }
}

/// Register the sinkhole with a kind registry.
pub fn register(reg: &mut KindRegistry) -> &mut KindRegistry {
    reg.landform::<Sinkhole>()
}

/// The sinkhole node with the walkthrough's numbers.
pub fn sinkhole_node() -> NodeSpec {
    NodeSpec::new(Sinkhole::KIND, "game.sinkholes")
        .params(SinkholeParams {
            cell: Size::Span(448.0),
            roll: 0.6,
            radius: (Size::Span(14.0), Size::Span(30.0)),
            depth: (Height::ShareOfRelief(0.04), Height::ShareOfRelief(0.09)),
            round: 3.0,
            notch: Some(3.0),
            karst: ("karst".to_string(), 0.15),
        })
        .expect("sinkhole params serialize")
}

/// Place sinkholes in `spec`: the game's karst field, its zone (painted
/// with a game-chosen role), and the node. `spec` must hold a `mesas` node
/// (the sinkhole reads its occupancy); it may be disabled.
pub fn with_sinkholes(spec: LandscapeSpec) -> LandscapeSpec {
    let mut spec = spec
        .with_field(
            "karst",
            FieldDef::detail(fx::noise("game.karst", Size::Span(1800.0), 3, 1.0)).strided(16),
        )
        .with_zone(
            "game.sinkhole_wall",
            ZoneDecl::doc("the worn wall of a sinkhole bowl"),
        )
        .with_node("sinkholes", sinkhole_node());
    voxelize_gen::landscape::kit::paint_zone(&mut spec, "game.sinkhole_wall", "rock.soft", 2);
    spec
}

fn main() {
    use voxelize::{Registry, WorldConfig};
    use voxelize_gen::landscape::presets::{demo_blocks, Knobs, RoleBinding};
    use voxelize_gen::landscape::{compile, kit, Tier};

    let mut seed = 7u32;
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(i) = args.iter().position(|a| a == "--seed") {
        seed = args[i + 1].parse().expect("seed");
    }
    let binding = RoleBinding::demo();
    let mut blocks = Registry::new();
    blocks.register_blocks(&demo_blocks(1, &binding));
    let config = WorldConfig::new()
        .seed(seed)
        .chunk_size(16)
        .max_height(512)
        .build();

    let mut kinds = kit::test_kinds();
    register(&mut kinds);
    let spec = with_sinkholes(kit::proving_landscape(&Knobs::default()));
    // Refuses on any problem, with the spec path at fault.
    let land = compile(&spec, &kinds, &binding, &blocks, &config)
        .unwrap_or_else(|e| panic!("compile: {e}"));
    print!("{}", land.dag().to_text());
    let (sx, sz) = land.spawn();
    println!("spawn ({sx}, {sz})");
    let near = land
        .instances_in(Aabb2::around(sx as f64, sz as f64, 3000.0))
        .into_iter()
        .filter(|i| i.node == "sinkholes")
        .min_by(|a, b| {
            let da = (a.center.0 - sx as f64).abs() + (a.center.1 - sz as f64).abs();
            let db = (b.center.0 - sx as f64).abs() + (b.center.1 - sz as f64).abs();
            da.total_cmp(&db)
        })
        .expect("a sinkhole within 3 km of spawn");
    let (cx, cz) = (near.center.0.floor() as i32, near.center.1.floor() as i32);
    println!(
        "nearest sinkhole: cell {:?}, centre ({cx}, {cz})",
        near.cell
    );
    print!("{}", land.explain(cx, cz).to_text());
    let rim = cx + ((near.bounds.2 - near.bounds.0) * 0.5 / 1.6).round() as i32;
    print!("{}", land.explain(rim, cz).to_text());
    println!(
        "centre ground {:.2} at Tier::Shaped, {:.2} at Tier::Macro",
        land.column_ground(cx, cz, Tier::Shaped),
        land.column_ground(cx, cz, Tier::Macro)
    );
}
