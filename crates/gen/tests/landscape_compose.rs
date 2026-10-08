//! The composition contract: ground ops are the identity through the fold
//! wherever their target asks no change, claims carry continuous weights,
//! exclusivity is plan-level and two-pass, region solvers compose from
//! their tiles, plans spend deterministic budgets (per index under
//! `par_map`), `forbid_solves` catches cold solves, provinces and spans
//! reach the voxels, and the landform suite runs over the three test
//! landforms: a Cells built-in (mesas), a Field built-in (swells) and a
//! game landform written in one file (sinkholes).

#[path = "fixtures/kinds.rs"]
mod kinds;
#[path = "fixtures/landscape.rs"]
mod land;
#[path = "../examples/sinkhole.rs"]
mod sinkhole;

use std::sync::Arc;

use kinds::*;
use voxelize::{Vec2, VoxelAccess};
use voxelize_gen::landscape::kit::determinism::{self, chunk_digest, generate};
use voxelize_gen::landscape::kit::{self, nearest_instance};
use voxelize_gen::landscape::prelude::*;
use voxelize_gen::landscape::spec::NodeSpec;
use voxelize_gen::landscape::{forbid_solves, CompileOptions, Landscape, Query};

const H: u32 = 256;

fn proving(seed: u32, o: &CompileOptions) -> Arc<Landscape> {
    compile(&proving_spec(H), seed, o)
}

fn with_node_enabled(id: &'static str) -> impl Fn(bool, &CompileOptions) -> Arc<Landscape> + Sync {
    move |enabled: bool, o: &CompileOptions| {
        let mut spec = proving_spec(H);
        spec.nodes.get_mut(id).unwrap().enabled = enabled;
        compile(&spec, 7, o)
    }
}

kit::landform_suite! {
    mesas,
    node = "mesas",
    build = crate::with_node_enabled("mesas"),
    registry = crate::land::demo_registry(),
    config = crate::land::config(7, crate::H as usize),
    within = 3000.0,
}

kit::landform_suite! {
    swells,
    node = "swells",
    build = crate::with_node_enabled("swells"),
    registry = crate::land::demo_registry(),
    config = crate::land::config(7, crate::H as usize),
    within = 3000.0,
}

kit::landform_suite! {
    sinkholes,
    node = "sinkholes",
    build = crate::with_node_enabled("sinkholes"),
    registry = crate::land::demo_registry(),
    config = crate::land::config(7, crate::H as usize),
    within = 3000.0,
}

fn mesa(land: &Landscape) -> voxelize_gen::landscape::InstanceInfo {
    nearest_instance(land, "mesas", 3000.0).expect("a mesa near spawn")
}

#[test]
fn ground_ops_are_the_identity_through_the_fold() {
    kit::landform::assert_ground_ops_identity();
    // In the mesa's fade ring the engine's edge is positive but the profile
    // is zero: the op is the identity and the ground is untouched, bit for
    // bit, against the same world without mesas.
    let on = proving(7, &CompileOptions::default());
    let off = with_node_enabled("mesas")(false, &CompileOptions::default());
    let m = mesa(&on);
    let (x0, z0, x1, z1) = m.bounds;
    let mut ring = 0;
    let mut moved = 0;
    for z in (z0.floor() as i32..=z1.ceil() as i32).step_by(3) {
        for x in (x0.floor() as i32..=x1.ceil() as i32).step_by(3) {
            let e = on.explain(x, z);
            let Some(inst) = e.compose.instances.iter().find(|i| i.node == "mesas") else {
                continue;
            };
            let ops: Vec<_> = e.compose.ops.iter().filter(|o| o.node == "mesas").collect();
            assert!(!ops.is_empty() && inst.edge > 0.0);
            let identity = ops.iter().all(|o| o.before.to_bits() == o.after.to_bits());
            if identity {
                ring += 1;
                assert_eq!(
                    on.column_ground(x, z, Tier::Full).to_bits(),
                    off.column_ground(x, z, Tier::Full).to_bits(),
                    "({x}, {z}): an identity op moved the ground"
                );
            } else {
                moved += 1;
            }
        }
    }
    assert!(ring > 10 && moved > 10, "fade ring {ring}, moved {moved}");
}

#[test]
fn claims_carry_the_instance_weight() {
    let land = proving(7, &CompileOptions::default());
    let m = mesa(&land);
    let (cx, cz) = (m.center.0.floor() as i32, m.center.1.floor() as i32);
    let r = 0.5 * (m.bounds.2 - m.bounds.0);
    let mut checked = 0;
    for k in 0..40 {
        let x = cx + (r * k as f64 / 40.0) as i32;
        let e = land.explain(x, cz);
        let Some(inst) = e.compose.instances.iter().find(|i| i.node == "mesas") else {
            continue;
        };
        let rock = e
            .claims
            .iter()
            .find(|c| c.0 == "ROCK")
            .expect("a ROCK claim");
        assert_eq!(rock.1, inst.weight as f32 as f64, "column ({x}, {cz})");
        assert_eq!(rock.2, "mesas");
        checked += 1;
    }
    assert!(checked > 20);
    // Weights fall continuously toward the bound: nothing switches on a
    // contour.
    let mut last = 1.0f64;
    for k in 0..=60 {
        let x = cx + (r * (0.7 + 0.3 * k as f64 / 60.0)) as i32;
        let w = land
            .explain(x, cz)
            .claims
            .iter()
            .find(|c| c.0 == "ROCK")
            .map_or(0.0, |c| c.1);
        assert!(
            w <= last + 0.15,
            "ROCK weight jumps from {last} to {w} at x = {x}"
        );
        last = w;
    }
}

fn discs(spec: LandscapeSpec, exclusive_last: bool) -> LandscapeSpec {
    let d =
        |layer: Layer, center: (f64, f64), lift: f64, exclusive: bool, claims: u32| DiscParams {
            layer,
            center,
            radius: 60.0,
            fade: 40.0,
            lift,
            exclusive,
            claims,
            span: None,
            spawn_clear: None,
        };
    let mut s = spec
        .with_node(
            "a",
            disc("t.a", d(Layer::Uplift, (900.0, 900.0), 10.0, true, 0)),
        )
        .with_node(
            "b",
            disc(
                "t.b",
                d(
                    Layer::Incise,
                    (950.0, 900.0),
                    5.0,
                    false,
                    Claims::NO_FLORA.0,
                ),
            ),
        );
    if exclusive_last {
        s = s.with_node(
            "c",
            disc("t.c", d(Layer::Detail, (900.0, 950.0), 3.0, true, 0)),
        );
    }
    s
}

#[test]
fn exclusion_is_plan_level_two_pass_and_forward_only() {
    let base = land::plain_spec(H);
    let land = compile(&discs(base.clone(), true), 7, &CompileOptions::default());
    let smooth = |s: f64| {
        let t = (s / 40.0).clamp(0.0, 1.0);
        t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
    };
    let mut overlap = 0;
    for z in (840..=1010).step_by(5) {
        for x in (840..=1010).step_by(5) {
            let e = land.explain(x, z);
            let get = |id: &str| e.compose.instances.iter().find(|i| i.node == id);
            let (xf, zf) = (x as f64 + 0.5, z as f64 + 0.5);
            let edge = |c: (f64, f64)| {
                let d = ((xf - c.0).powi(2) + (zf - c.1).powi(2)).sqrt();
                smooth(60.0 - d)
            };
            let (ea, eb) = (edge((900.0, 900.0)), edge((950.0, 900.0)));
            if let Some(b) = get("b") {
                // B composes after the exclusive A: its weight is its edge
                // times 1 − A's edge.
                assert!((b.edge - eb).abs() < 1e-12);
                assert!((b.exclusion - (1.0 - ea)).abs() < 1e-12, "({x}, {z})");
                assert!((b.weight - eb * (1.0 - ea)).abs() < 1e-12);
                if ea > 0.0 && ea < 1.0 {
                    overlap += 1;
                }
                // Its claim carries that weight.
                if b.weight > 0.0 {
                    let flora = e.claims.iter().find(|c| c.0 == "NO_FLORA").unwrap();
                    assert_eq!(flora.1, b.weight as f32 as f64);
                }
            }
            if let Some(a) = get("a") {
                // The later exclusive C never suppresses A or B.
                assert_eq!(a.exclusion, 1.0);
            }
            // Ground: base + 10·eA + 5·eB·(1 − eA) + C's lift, to rounding.
            let ec = edge((900.0, 950.0));
            let ex_c = (1.0 - ea) * (1.0 - 0.0);
            let want = e.spine + 10.0 * ea + 5.0 * eb * (1.0 - ea) + 3.0 * ec * ex_c;
            assert!(
                (e.composed - want).abs() < 1e-9,
                "({x}, {z}): composed {} want {want}",
                e.composed
            );
        }
    }
    assert!(
        overlap > 10,
        "the discs overlap at {overlap} sampled columns"
    );
    // Order independent: shuffles and threads give the same digests.
    let registry = land::demo_registry();
    let config = land::config(7, H as usize);
    let chunks: Vec<(i32, i32)> = (54..=62)
        .flat_map(|cz| (54..=62).map(move |cx| (cx, cz)))
        .collect();
    let build = |o: &CompileOptions| compile(&discs(base.clone(), true), 7, o);
    let case = determinism::Case {
        name: "discs",
        build: &build,
        registry: &registry,
        config: &config,
        chunks: &chunks,
    };
    determinism::assert_order_and_threads(&case);
    determinism::assert_caches_cost_only(&case);
    determinism::assert_grid_equals_point(&case);
}

#[test]
fn region_solvers_compose_from_their_tiles() {
    let spec = land::plain_spec(H).with_node(
        "terraces",
        NodeSpec::new("test.region", "t.region")
            .params(RegionParams {
                amp: 4.0,
                size: 128,
                apron: 16,
            })
            .unwrap(),
    );
    let land = compile(&spec, 7, &CompileOptions::default());
    assert_eq!(land.dag().order, vec!["terraces"]);
    // Continuous across tile boundaries: the amplitude is the same in
    // every tile.
    let g = land.ground_window(100, 100, 80, 1, 1);
    let base = land::plain(7, H, &CompileOptions::default()).ground_window(100, 100, 80, 1, 1);
    let delta: Vec<f64> = g.iter().zip(&base).map(|(a, b)| a - b).collect();
    for w in delta.windows(2) {
        assert!(
            (w[1] - w[0]).abs() < 0.5,
            "a step of {} across the region",
            w[1] - w[0]
        );
    }
    assert!(delta.iter().any(|d| *d > 0.5));
    // Tiles solve once while resident.
    let _ = land.chunk_facts(Vec2(7, 7));
    let solved = land
        .plan_stats()
        .iter()
        .find(|s| s.node == "terraces")
        .unwrap()
        .solved;
    let _ = land.chunk_facts(Vec2(7, 8));
    let _ = land.column(120, 120, Tier::Full);
    let again = land
        .plan_stats()
        .iter()
        .find(|s| s.node == "terraces")
        .unwrap()
        .solved;
    assert!(solved >= 1 && again <= solved + 1, "{solved} then {again}");
    // Determinism with every cache at capacity one.
    let registry = land::demo_registry();
    let config = land::config(7, H as usize);
    let chunks = vec![(6, 6), (7, 7), (8, 8), (7, 8), (16, 7)];
    let build = |o: &CompileOptions| compile(&spec, 7, o);
    let case = determinism::Case {
        name: "region",
        build: &build,
        registry: &registry,
        config: &config,
        chunks: &chunks,
    };
    determinism::assert_caches_cost_only(&case);
    determinism::assert_grid_equals_point(&case);
}

fn budget_spec(per_item: u64, plan_probes: u64) -> LandscapeSpec {
    let mut spec = land::plain_spec(H).with_node(
        "budgeted",
        NodeSpec::new("test.budget", "t.budget")
            .params(BudgetParams {
                per_item,
                items: 12,
            })
            .unwrap(),
    );
    spec.budgets.probe_calls = plan_probes;
    spec
}

#[test]
fn work_meters_are_per_index_and_deterministic() {
    let spec = budget_spec(2, 1 << 16);
    let area = Aabb2 {
        min_x: -600.0,
        min_z: -600.0,
        max_x: 600.0,
        max_z: 600.0,
    };
    let mut reference: Option<Vec<(String, (i32, i32), (f64, f64, f64, f64))>> = None;
    for threads in [1usize, 4, 8] {
        let land = compile(
            &spec,
            7,
            &CompileOptions {
                planner_threads: threads,
                ..CompileOptions::default()
            },
        );
        let got: Vec<_> = land
            .instances_in(area)
            .into_iter()
            .filter(|i| i.node == "budgeted")
            .map(|i| (i.node, i.cell, i.bounds))
            .collect();
        assert!(!got.is_empty());
        match &reference {
            None => reference = Some(got),
            Some(r) => assert_eq!(r, &got, "{threads} planner threads"),
        }
    }
    // Some items ran out of their own budget: a radius below the full one.
    let r = reference.unwrap();
    assert!(r
        .iter()
        .any(|(_, _, b)| (b.2 - b.0) * 0.5 < 8.0 + 2.0 * 12.0));
    // Chunk digests agree under order and thread shuffles too.
    let registry = land::demo_registry();
    let config = land::config(7, H as usize);
    let chunks = vec![(0, 0), (1, 0), (8, 8), (-9, 4), (3, -12)];
    let build = |o: &CompileOptions| compile(&spec, 7, o);
    let case = determinism::Case {
        name: "budget",
        build: &build,
        registry: &registry,
        config: &config,
        chunks: &chunks,
    };
    determinism::assert_order_and_threads(&case);
    // A plan budget too small for a plan rejects it, counted.
    let land = compile(&budget_spec(8, 6), 7, &CompileOptions::default());
    assert!(land.instances_in(area).iter().all(|i| i.node != "budgeted"));
    let stats = land.plan_stats();
    let s = stats.iter().find(|s| s.node == "budgeted").unwrap();
    assert!(s.rejected_budget > 0 && s.planned == 0, "{s:?}");
}

#[test]
fn forbid_solves_catches_a_cold_solve() {
    let land = proving(7, &CompileOptions::default());
    let m = mesa(&land);
    let (x, z) = (m.center.0 as i32, m.center.1 as i32);
    // A fresh landscape: the mesa's plan is cold.
    let cold = proving(7, &CompileOptions::default());
    {
        let _g = forbid_solves();
        assert_eq!(cold.column_if_ready(x, z, Tier::Full), Query::Pending);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            cold.column(x, z, Tier::Full)
        }));
        assert!(r.is_err(), "a cold solve inside forbid_solves() must panic");
    }
    // Outside the guard it solves, and once warm the guard is silent.
    let c = cold.column(x, z, Tier::Full);
    let _g = forbid_solves();
    assert_eq!(cold.column(x, z, Tier::Full), c);
}

#[test]
fn a_chunk_without_features_dispatches_nothing() {
    let land = proving(7, &CompileOptions::default());
    let m = mesa(&land);
    let s = land.chunk_size() as f64;
    let at = (
        (m.center.0 / s).floor() as i32,
        (m.center.1 / s).floor() as i32,
    );
    assert!(land.chunk_dispatch_len(at) >= 1);
    // Far out at sea, past every country gate.
    let mut empty = 0;
    for k in 0..40 {
        if land.chunk_dispatch_len((-4000 + k * 7, 4000 - k * 3)) == 0 {
            empty += 1;
        }
    }
    assert!(empty > 10);
    // A plain landscape (no nodes) never dispatches.
    let plain = land::plain(7, H, &CompileOptions::default());
    assert_eq!(plain.chunk_dispatch_len(at), 0);
}

#[test]
fn provinces_carve_and_spans_write_solids() {
    let land = proving(7, &CompileOptions::default());
    let registry = land::demo_registry();
    let config = land::config(7, H as usize);
    let hole = nearest_instance(&land, "sinkholes", 3000.0).expect("a sinkhole near spawn");
    let s = land.chunk_size();
    let (c0, c1) = (
        (
            (hole.bounds.0 / s as f64).floor() as i32,
            (hole.bounds.1 / s as f64).floor() as i32,
        ),
        (
            (hole.bounds.2 / s as f64).floor() as i32,
            (hole.bounds.3 / s as f64).floor() as i32,
        ),
    );
    let mut notched = 0;
    for cz in c0.1..=c1.1 {
        for cx in c0.0..=c1.0 {
            let facts = land.chunk_facts(Vec2(cx, cz));
            if facts.provinces.is_empty() {
                continue;
            }
            let chunk = generate(&land, &registry, &config, cx, cz);
            for &(i, ref e) in &facts.provinces {
                let side = facts.side();
                let (dx, dz) = (i as usize % side, i as usize / side);
                let x = facts.origin.0 - facts.halo as i32 + dx as i32;
                let z = facts.origin.1 - facts.halo as i32 + dz as i32;
                if x < cx * s || x >= (cx + 1) * s || z < cz * s || z >= (cz + 1) * s {
                    continue;
                }
                let top = facts.top[i as usize] as i32;
                // Air inside the band below the top, solid above it: an
                // overhang the heightfield alone cannot make.
                let carved = (e.lo..=e.hi.min(top - 1)).any(|y| chunk.get_voxel(x, y, z) == 0);
                if carved && chunk.get_voxel(x, top, z) != 0 {
                    notched += 1;
                }
            }
        }
    }
    assert!(notched > 0, "the sinkhole's notch carved nothing");
    // A disc with a span writes a solid slab above the ground, and the
    // height map still matches a rescan. It stands near spawn, on land.
    let (sx, sz) = land::plain(7, H, &CompileOptions::default()).spawn();
    let (px, pz) = (sx + 8, sz + 8);
    let spec = land::plain_spec(H).with_node(
        "slab",
        disc(
            "t.slab",
            DiscParams {
                layer: Layer::Detail,
                center: (px as f64 + 0.5, pz as f64 + 0.5),
                radius: 12.0,
                fade: 4.0,
                lift: 0.0,
                exclusive: false,
                claims: 0,
                span: Some((6, 8)),
                spawn_clear: None,
            },
        ),
    );
    let land = compile(&spec, 7, &CompileOptions::default());
    let (cx, cz) = (px.div_euclid(s), pz.div_euclid(s));
    let chunk = generate(&land, &registry, &config, cx, cz);
    let col = land.column(px, pz, Tier::Full);
    assert!(col.water.is_dry());
    let rock = land.role_block("rock.hard").unwrap();
    let base = col.ground.floor() as i32;
    assert_eq!(chunk.get_voxel(px, base + 7, pz), rock, "top {}", col.top);
    assert_eq!(chunk.get_voxel(px, base + 5, pz), 0);
    assert!(chunk.top_filled_y.unwrap() >= base + 8);
    let build = |o: &CompileOptions| compile(&spec, 7, o);
    let case = determinism::Case {
        name: "slab",
        build: &build,
        registry: &registry,
        config: &config,
        chunks: &[(cx, cz)],
    };
    determinism::assert_height_map_matches_rescan(&case);
    let _ = chunk_digest(&chunk);
}
