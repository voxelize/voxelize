//! Terrain quality gates over the layered reference stack: the field API
//! must be able to express terrain that spans a real height range, mixes
//! flats with steeps, carries measurable relief at many scales, and does
//! not read as one repeated pattern — measured, not eyeballed. The stack
//! under test is built purely from engine primitives (multifractals,
//! nested warps, affine anisotropy, smooth splines, curvature valleys,
//! erosion damping), so these gates hold the API, not any game preset, to
//! the standard. Every threshold is pinned against measured values with
//! deliberate margins.

#[path = "fixtures/mod.rs"]
mod fixtures;

use fixtures::reference_stack;
use voxelize_gen::*;

/// 384 samples every 12 blocks: a 4608-block window, several multiples of
/// the largest feature wavelength (1400-block continents), which the
/// repetition diagnostic requires.
const GRID: usize = 384;
const STEP: i32 = 12;

fn compile_graph(graph: &FieldGraph) -> FieldProgram {
    let mut salts = hashbrown::HashSet::new();
    FieldProgram::compile(graph, "terrain_quality", 7, "reference_dim", &mut salts)
        .expect("reference stack compiles")
}

/// The pre-rework failure mode reproduced with the same primitives: one
/// plain ridged field, banded straight into mountain height with a linear
/// spline — the uniform parallel-ridge texture, everywhere.
fn plain_ridged_chains() -> FieldGraph {
    let mut b = FieldGraphBuilder::new();
    let ridged = b.ridged("plain.chains", 1.0 / 420.0, 4, 0.5, 2.0);
    b.spline(ridged, &[(0.35, 0.0), (0.55, 30.0), (0.95, 110.0)]);
    b.build()
}

/// The chain lane of the reference stack in isolation: anisotropic
/// ridged-multifractal under two nested warps, confined to belts.
fn layered_chains() -> FieldGraph {
    let mut b = FieldGraphBuilder::new();
    let chains_raw = b.ridged_multi("ref.chains", 1.0 / 420.0, 5, 0.5, 2.0, 1.0, 2.0);
    let chains_oriented = b.affine(chains_raw, 0.5, 0.375, -0.96, 1.28, 0.0, 0.0);
    let wx_micro = b.fbm("ref.warp.micro.x", 1.0 / 130.0, 3, 0.5, 2.0);
    let wz_micro = b.fbm("ref.warp.micro.z", 1.0 / 130.0, 3, 0.5, 2.0);
    let chains_wobbled = b.warp(chains_oriented, wx_micro, wz_micro, 24.0);
    let wx_macro = b.fbm("ref.warp.macro.x", 1.0 / 1100.0, 2, 0.5, 2.0);
    let wz_macro = b.fbm("ref.warp.macro.z", 1.0 / 1100.0, 2, 0.5, 2.0);
    let chains = b.warp(chains_wobbled, wx_macro, wz_macro, 300.0);
    let shaped = b.smooth_spline(
        chains,
        &[(-1.0, 0.0), (-0.30, 3.0), (0.20, 22.0), (0.65, 70.0), (1.0, 118.0)],
    );
    let belts = b.fbm("ref.belts", 1.0 / 900.0, 2, 0.5, 2.0);
    let belt_gate = b.gate(belts, 0.01, 0.14);
    b.mul(shaped, belt_gate);
    b.build()
}

#[test]
fn reference_stack_terrain_acceptance() {
    let program = compile_graph(&reference_stack());
    let grid = FieldGrid::sample((-2304, -2304), GRID, STEP, |x, z| program.sample2(x, z));

    // Height distribution: ocean basins, populated midlands, real crests.
    let stats = FieldStats::measure(grid.values());
    println!("reference heights: {stats:?}");
    assert!(stats.p05 < 40.0, "ocean basins missing: p05 {:.1}", stats.p05);
    assert!(stats.p99 > 105.0, "mountain crests missing: p99 {:.1}", stats.p99);
    assert!(
        stats.p99 - stats.p01 > 85.0,
        "height span too flat: {:.1}",
        stats.p99 - stats.p01
    );

    // Multi-scale: measurable relief in every frequency band, from
    // 12-block detail to continental structure (band std in blocks).
    let shares = band_shares(&grid, 6);
    let variance = stats.std_dev * stats.std_dev;
    let band_stds: Vec<f64> = shares.iter().map(|share| (share * variance).sqrt()).collect();
    println!("reference band stds (blocks, fine->coarse): {band_stds:?}");
    let meaningful = band_stds.iter().filter(|std| **std >= 1.0).count();
    assert!(
        meaningful >= 5,
        "relief must exist at 5+ scales: {band_stds:?}"
    );
    assert!(
        *band_stds.last().expect("bands") >= 10.0,
        "macro structure missing: {band_stds:?}"
    );

    // Anti-repetition: once correlation decays, it must not come back
    // (no periodic pattern), and no direction may be translation-invariant.
    let repetition = repetition_score(&grid, 0.3);
    println!("reference repetition score: {repetition:.4}");
    assert!(repetition < 0.5, "terrain repeats itself: {repetition:.4}");
}

#[test]
fn reference_stack_mixes_flats_and_steeps() {
    let graph = {
        let mut b = FieldGraphBuilder::new();
        let mut last = 0;
        for node in reference_stack().nodes {
            last = b.push(node);
        }
        b.slope_of(last, 4.0);
        b.build()
    };
    let program = compile_graph(&graph);
    let grid = FieldGrid::sample((-1024, -1024), 128, 16, |x, z| program.sample2(x, z));
    let stats = FieldStats::measure(grid.values());
    println!("reference slopes: {stats:?}");
    assert!(
        stats.p05 < 0.1,
        "true flats must exist: slope p05 {:.3}",
        stats.p05
    );
    assert!(
        stats.p50 < 0.45,
        "plains and shelves must dominate: slope p50 {:.3}",
        stats.p50
    );
    assert!(
        stats.p99 > 0.7,
        "real steeps must exist: slope p99 {:.3}",
        stats.p99
    );
}

#[test]
fn layered_chains_break_the_uniform_ridge_signature() {
    // The rejected look, quantified: every 384-block tile of the plain
    // ridged construction is rugged (no calm regions at all) and its crest
    // heights cluster tightly. The layered chains mix mountain belts with
    // plains and vary their crests.
    let plain = compile_graph(&plain_ridged_chains());
    let layered = compile_graph(&layered_chains());
    let measure = |program: &FieldProgram| {
        let grid = FieldGrid::sample((-2304, -2304), GRID, STEP, |x, z| program.sample2(x, z));
        let reliefs = relief_windows(&grid, 32);
        let max_relief = reliefs.iter().cloned().fold(f64::MIN, f64::max);
        let calm = reliefs.iter().filter(|r| **r < max_relief * 0.10).count() as f64
            / reliefs.len() as f64;
        let rugged = reliefs.iter().filter(|r| **r > max_relief * 0.5).count() as f64
            / reliefs.len() as f64;
        let crests = local_maxima(&grid, 2, 20.0);
        let mean = crests.iter().sum::<f64>() / crests.len().max(1) as f64;
        let crest_cv = (crests.iter().map(|c| (c - mean) * (c - mean)).sum::<f64>()
            / crests.len().max(1) as f64)
            .sqrt()
            / mean;
        (calm, rugged, crest_cv, crests.len())
    };

    let (plain_calm, plain_rugged, plain_cv, plain_crests) = measure(&plain);
    let (layered_calm, layered_rugged, layered_cv, layered_crests) = measure(&layered);
    println!(
        "plain: calm {plain_calm:.3} rugged {plain_rugged:.3} crest_cv {plain_cv:.3} ({plain_crests} crests)"
    );
    println!(
        "layered: calm {layered_calm:.3} rugged {layered_rugged:.3} crest_cv {layered_cv:.3} ({layered_crests} crests)"
    );

    assert!(
        plain_calm < 0.05 && plain_rugged > 0.9,
        "the plain construction should exhibit the uniform signature this gate exists to reject"
    );
    assert!(
        layered_calm > 0.10,
        "layered chains must leave calm regions: {layered_calm:.3}"
    );
    assert!(
        layered_rugged < 0.75,
        "layered chains must not blanket the map: {layered_rugged:.3}"
    );
    assert!(
        layered_cv > plain_cv + 0.10,
        "layered crest heights must vary more than the uniform field \
         (plain {plain_cv:.3}, layered {layered_cv:.3})"
    );
    assert!(plain_crests > 500 && layered_crests > 100);
}

#[test]
fn reference_stack_is_deterministic_across_compiles() {
    let first = compile_graph(&reference_stack());
    let second = compile_graph(&reference_stack());
    for i in 0..512 {
        let (x, z) = (i * 37 - 9000, i * -23 + 4500);
        assert_eq!(
            first.sample2(x, z).to_bits(),
            second.sample2(x, z).to_bits(),
            "reference stack diverged at ({x},{z})"
        );
    }
}
