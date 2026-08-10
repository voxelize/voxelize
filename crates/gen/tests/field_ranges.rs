//! Characterization of practical fractal output ranges. Content tunes
//! splines, gates, and thresholds against these bands (fbm ~ +/-0.25,
//! ridged ~ +0.33..+0.95); if normalization ever changes, this test names
//! the drift before every preset silently flattens.

use voxelize_gen::noise::{Fractal, NoiseKind};

fn percentiles(octaves: u8, kind: NoiseKind) -> (f64, f64, f64) {
    let f = Fractal::new(7, 1.0 / 500.0, octaves, 0.5, 2.0, kind);
    let mut values: Vec<f64> = Vec::new();
    for i in 0..6000 {
        values.push(f.sample2(i as f64 * 1.37, (i % 971) as f64 * 3.1));
    }
    values.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
    let pct = |p: f64| values[(values.len() as f64 * p) as usize];
    (pct(0.01), pct(0.5), pct(0.99))
}

#[test]
fn fbm_practical_range_is_stable() {
    for octaves in [2u8, 3, 5, 6] {
        let (p01, p50, p99) = percentiles(octaves, NoiseKind::Fbm);
        assert!(p50.abs() < 0.05, "fbm{octaves} median drifted: {p50}");
        assert!((0.18..=0.40).contains(&p99), "fbm{octaves} p99 drifted: {p99}");
        assert!((-0.40..=-0.18).contains(&p01), "fbm{octaves} p01 drifted: {p01}");
    }
}

#[test]
fn ridged_practical_range_is_stable() {
    for octaves in [3u8, 4] {
        let (p01, p50, p99) = percentiles(octaves, NoiseKind::Ridged);
        assert!((0.25..=0.45).contains(&p01), "ridged{octaves} p01 drifted: {p01}");
        assert!((0.6..=0.8).contains(&p50), "ridged{octaves} median drifted: {p50}");
        assert!(p99 > 0.9, "ridged{octaves} p99 drifted: {p99}");
    }
}

#[test]
fn billow_practical_range_is_stable() {
    for octaves in [3u8, 4] {
        let (p01, p50, p99) = percentiles(octaves, NoiseKind::Billow);
        assert!(p01 < -0.9, "billow{octaves} p01 drifted: {p01}");
        assert!((-0.8..=-0.6).contains(&p50), "billow{octaves} median drifted: {p50}");
        assert!((-0.45..=-0.25).contains(&p99), "billow{octaves} p99 drifted: {p99}");
    }
}

#[test]
fn hybrid_multi_practical_range_is_stable() {
    for octaves in [4u8, 5] {
        let (p01, p50, p99) = percentiles(octaves, NoiseKind::HybridMulti { offset: 0.7 });
        assert!(
            (0.05..=0.25).contains(&p01),
            "hybrid{octaves} p01 drifted: {p01}"
        );
        assert!((0.2..=0.4).contains(&p50), "hybrid{octaves} median drifted: {p50}");
        assert!((0.4..=0.55).contains(&p99), "hybrid{octaves} p99 drifted: {p99}");
    }
}

#[test]
fn ridged_multi_practical_range_is_stable() {
    for octaves in [4u8, 5] {
        let (p01, p50, p99) = percentiles(
            octaves,
            NoiseKind::RidgedMulti {
                offset: 1.0,
                gain: 2.0,
            },
        );
        assert!(
            (-0.15..=0.1).contains(&p01),
            "ridged-multi{octaves} p01 drifted: {p01}"
        );
        assert!(
            (0.35..=0.65).contains(&p50),
            "ridged-multi{octaves} median drifted: {p50}"
        );
        assert!(p99 > 0.75, "ridged-multi{octaves} p99 drifted: {p99}");
    }
}
