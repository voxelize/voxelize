//! Facts, queries and quality on the `plain` preset: the preset compiles
//! under strict taste guards; facts hold their invariants (one definition of
//! ground, the solid top, L2 slope, the sea layer); the spawn is dry, calm
//! and in its windows; the facts cache stays within its byte budget; the
//! quality bands pass on three seeds and catch both knife-cut and
//! fake-smooth terrain.

#[path = "fixtures/landscape.rs"]
mod land;

use voxelize::Vec2;
use voxelize_gen::landscape::facts::{solid_top, Tier};
use voxelize_gen::landscape::{CompileOptions, QualityBands, QualityReport, Query};

/// The bands the plain preset passes (measured values with margins).
fn plain_bands() -> QualityBands {
    QualityBands {
        max_fine_ratio: 0.01,
        min_medium_floor: 0.12,
        min_rim_break_p50: 3.0,
        max_axis_bias: 1.3,
        max_edge_spike_share: 0.002,
    }
}

#[test]
fn plain_compiles_strict_and_facts_hold_their_invariants() {
    let land = land::plain(7, 512, &CompileOptions::default());
    assert!(land.spec().taste.strict);
    assert!(
        land.lints().iter().all(|l| !l.starts_with("taste")),
        "{:?}",
        land.lints()
    );
    let sea = land.frame().sea;
    let mut wet = 0;
    for (cx, cz) in land::walk_chunks() {
        let f = land.chunk_facts(Vec2(cx, cz));
        assert_eq!(f.size, 16);
        assert_eq!(f.halo, 2);
        let area = f.area();
        for dz in 1..area.d as i32 - 1 {
            for dx in 1..area.w as i32 - 1 {
                let (x, z) = (area.x0 + dx, area.z0 + dz);
                let i = f.index(x, z).unwrap();
                let g = f.ground[i];
                assert!(g.is_finite());
                assert_eq!(f.top[i] as i32, solid_top(g).clamp(0, 511));
                assert!(f.slope[i] >= 0.0);
                let a = f.aspect[i];
                let n = (a[0] * a[0] + a[1] * a[1]).sqrt();
                assert!(n == 0.0 || (n - 1.0).abs() < 1e-5);
                // L2 slope from final ground at the neighbours.
                let gx = (f.ground[f.index(x + 1, z).unwrap()]
                    - f.ground[f.index(x - 1, z).unwrap()])
                    / 2.0;
                let gz = (f.ground[f.index(x, z + 1).unwrap()]
                    - f.ground[f.index(x, z - 1).unwrap()])
                    / 2.0;
                assert_eq!(f.slope[i], (gx * gx + gz * gz).sqrt() as f32);
                let water = f.water_at(i, land.sea());
                if (f.top[i] as i32) < sea {
                    wet += 1;
                    let l = water.top().expect("a sea layer below sea level");
                    assert_eq!((l.bottom, l.level), (f.top[i] as i32 + 1, sea));
                } else {
                    assert!(water.is_dry());
                }
            }
        }
    }
    assert!(wet > 0, "the walk should reach the sea");
}

#[test]
fn spawn_is_dry_calm_and_in_its_windows() {
    for seed in [1u32, 7, 123123123] {
        let land = land::plain(seed, 512, &CompileOptions::default());
        let (x, y, z) = land.spawn_point();
        let c = land.column(x, z, Tier::Full);
        assert_eq!(y, c.top + 1);
        assert!(c.water.is_dry(), "seed {seed}: spawn is wet");
        assert!(c.slope <= 0.35, "seed {seed}: spawn slope {}", c.slope);
        let sea = land.frame().sea;
        assert!(
            c.top >= sea + 3 && c.top <= sea + 40,
            "seed {seed}: spawn top {}",
            c.top
        );
        assert!(land.fluid_at(x, y, z).is_none());
        assert!(land.fluid_at(x, c.top, z).is_none());
    }
}

#[test]
fn point_queries_answer_from_caches_and_never_compute_when_asked_not_to() {
    let land = land::plain(7, 512, &CompileOptions::default());
    assert_eq!(land.column_if_ready(5000, 5000, Tier::Full), Query::Pending);
    assert_eq!(land.water_if_ready(5000, 5000), Query::Pending);
    let f = land.chunk_facts(Vec2(0, 0));
    let Query::Ready(c) = land.column_if_ready(3, 4, Tier::Full) else {
        panic!("a generated chunk answers")
    };
    assert_eq!(c, f.column(3, 4, land.sea()).unwrap());
    // A sea column reports its fluid.
    let mut found = false;
    'outer: for x in (-2000..2000).step_by(97) {
        for z in (-2000..2000).step_by(89) {
            let c = land.column(x, z, Tier::Full);
            if let Some(l) = c.water.top() {
                let hit = land
                    .fluid_at(x, l.level, z)
                    .expect("the surface voxel is water");
                assert_eq!(hit.depth, 1);
                assert_eq!(hit.surface, land.frame().sea);
                let bottom = land.fluid_at(x, l.bottom, z).unwrap();
                assert_eq!(bottom.depth, l.level - l.bottom + 1);
                assert!(land.fluid_at(x, l.bottom - 1, z).is_none());
                found = true;
                break 'outer;
            }
        }
    }
    assert!(found, "no sea within 2 km");
}

#[test]
fn facts_cache_stays_within_its_byte_budget() {
    let budget = 512 * 1024;
    let land = land::plain(
        7,
        256,
        &CompileOptions {
            facts_bytes: budget,
            ..CompileOptions::default()
        },
    );
    for cx in 0..12 {
        for cz in 0..12 {
            land.chunk_facts(Vec2(cx, cz));
        }
    }
    let one = land.chunk_facts(Vec2(0, 0)).bytes();
    let stats = land_stats(&land);
    assert!(
        stats.0 <= budget + one,
        "facts cache holds {} bytes over {budget}",
        stats.0
    );
    assert!(stats.1 > 0, "the cache evicted nothing");
}

fn land_stats(land: &voxelize_gen::landscape::Landscape) -> (usize, u64) {
    let s = land.facts_cache_stats();
    (s.weight, s.evictions)
}

#[test]
fn explain_tells_the_column_story() {
    let land = land::plain(7, 512, &CompileOptions::default());
    let e = land.explain(300, 200);
    let c = land.column(300, 200, Tier::Full);
    assert_eq!(e.top, c.top);
    assert_eq!(e.ground.to_bits(), c.ground.to_bits());
    assert!(e.fields.iter().any(|(n, _)| n == "ground"));
    assert!(!e.paint.is_empty());
    let text = e.to_text();
    assert!(text.contains("column (300, 200)") && text.contains("biome"));
    let json = serde_json::to_value(&e).unwrap();
    assert_eq!(json["x"], 300);
}

#[test]
fn quality_bands_pass_on_three_seeds() {
    for seed in [1u32, 7, 123123123] {
        let land = land::plain(seed, 512, &CompileOptions::default());
        let (sx, sz) = land.spawn();
        let r = land.quality(sx - 1024, sz - 1024, 2048, 2);
        let failures = plain_bands().failures(&r);
        assert!(failures.is_empty(), "seed {seed}: {failures:?}\n{r:#?}");
        assert!(r.fine_ratio.is_some() && r.medium_floor.is_some());
    }
}

#[test]
fn quality_catches_knife_cuts_and_fake_smooth_ground() {
    let (w, d) = (1100usize, 1100usize);
    // A broad smooth swell with nothing at medium scale: fake-smooth.
    let smooth: Vec<f64> = (0..w * d)
        .map(|i| {
            let (x, z) = ((i % w) as f64, (i / w) as f64);
            let tau = std::f64::consts::TAU;
            150.0 + 60.0 * (tau * x / 2000.0).sin() * (tau * z / 2600.0).cos()
        })
        .collect();
    let r = QualityReport::measure(&smooth, w, d, 1.0, 86.0);
    let f = plain_bands().failures(&r);
    assert!(
        f.iter().any(|m| m.contains("medium floor")),
        "{f:?} {:?}",
        r.medium_floor
    );
    // Mesas with vertical walls: knife-cut rims and edge spikes.
    let cut: Vec<f64> = (0..w * d)
        .map(|i| {
            let (x, z) = ((i % w) as i64, (i / w) as i64);
            let on = ((x / 90) + (z / 70)) % 2 == 0;
            let hills = 6.0 * (((x as f64) / 37.0).fract() - 0.5).abs();
            if on {
                160.0 + hills
            } else {
                120.0 + hills
            }
        })
        .collect();
    let r = QualityReport::measure(&cut, w, d, 1.0, 86.0);
    let f = plain_bands().failures(&r);
    assert!(
        f.iter()
            .any(|m| m.contains("rim break") || m.contains("edge spike")),
        "{f:?} {:?} {}",
        r.rim_break,
        r.edge_spike_share
    );
    // Cavity-like fine noise.
    let pitted: Vec<f64> = (0..w * d)
        .map(|i| {
            let (x, z) = ((i % w) as u64, (i / w) as u64);
            let h = x.wrapping_mul(0x9E3779B97F4A7C15) ^ z.wrapping_mul(0xC2B2AE3D27D4EB4F);
            let h = (h ^ (h >> 29)).wrapping_mul(0xBF58476D1CE4E5B9);
            let tau = std::f64::consts::TAU;
            150.0
                + 20.0 * (tau * z as f64 / 300.0).sin()
                + 6.0 * ((h >> 40) as f64 / (1u64 << 24) as f64)
        })
        .collect();
    let r = QualityReport::measure(&pitted, w, d, 1.0, 86.0);
    let f = plain_bands().failures(&r);
    assert!(
        f.iter().any(|m| m.contains("fine ratio")),
        "{f:?} {:?}",
        r.fine_ratio
    );
}

/// The work budget: the plain walk's deterministic counters stay within
/// `budgets/plain.json` (cold, one worker, the spiral `walk_bench` pins).
#[cfg(feature = "gen-counters")]
#[test]
fn within_work_budget() {
    use voxelize::{Chunk, ChunkOptions, ChunkStage, Resources};
    use voxelize_gen::landscape::counters::{reset, snapshot, Counter};
    use voxelize_gen::landscape::LandscapeStage;

    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("budgets/plain.json");
    let budget: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let growth = 1.0 + budget["max_counter_growth"].as_f64().unwrap();
    let land = land::plain(land::BENCH_SEED, 512, &CompileOptions::default());
    let registry = land::demo_registry();
    let config = land::config(land::BENCH_SEED, 512);
    let stage = LandscapeStage::new(land);
    // walk_bench's spiral: 256 chunks out from the origin.
    let mut route = Vec::new();
    let (mut x, mut z, mut dx, mut dz, mut leg) = (0i32, 0i32, 1i32, 0i32, 1);
    'spiral: loop {
        for _ in 0..2 {
            for _ in 0..leg {
                if route.len() == 256 {
                    break 'spiral;
                }
                route.push((x, z));
                x += dx;
                z += dz;
            }
            (dx, dz) = (-dz, dx);
        }
        leg += 1;
    }
    let mut samples: Vec<Vec<f64>> = vec![Vec::new(); Counter::ALL.len()];
    for (cx, cz) in route {
        reset();
        let options = ChunkOptions {
            size: 16,
            max_height: 512,
            sub_chunks: config.sub_chunks,
        };
        let chunk = stage.process(
            Chunk::new("budget", cx, cz, &options),
            Resources {
                registry: &registry,
                config: &config,
            },
            None,
        );
        std::hint::black_box(&chunk);
        for (k, v) in snapshot().iter().enumerate() {
            samples[k].push(*v as f64);
        }
    }
    let mut over = Vec::new();
    for pin in budget["counters"].as_array().unwrap() {
        if pin["key"] != "plain/spiral/w1/cold" {
            continue;
        }
        let name = pin["name"].as_str().unwrap();
        let k = Counter::ALL.iter().position(|c| c.name() == name).unwrap();
        let mut v = samples[k].clone();
        v.sort_by(f64::total_cmp);
        let n = v.len();
        let median = (v[n / 2 - 1] + v[n / 2]) / 2.0;
        let p95 = v[((n as f64 * 0.95) as usize).min(n - 1)];
        let (pm, pp) = (
            pin["median"].as_f64().unwrap(),
            pin["p95"].as_f64().unwrap(),
        );
        if median > pm * growth || p95 > pp * growth {
            over.push(format!(
                "{name}: median {median} (pin {pm}), p95 {p95} (pin {pp})"
            ));
        }
    }
    assert!(
        over.is_empty(),
        "work counters over budget:\n{}",
        over.join("\n")
    );
}
