//! Field diagnostics: distribution, spectrum, and repetition measurements
//! over deterministic sample grids. These are the numbers behind terrain
//! acceptance gates — "spans a real height range", "carries energy at
//! several scales", "does not repeat itself" — and behind live debug taps,
//! so tuning conversations happen over measurements instead of adjectives.

use serde::Serialize;

/// A square grid of field samples anchored at `origin`, `step` blocks
/// apart. Sampling order is fixed, so grids are deterministic artifacts.
pub struct FieldGrid {
    pub origin: (i32, i32),
    pub step: i32,
    pub size: usize,
    values: Vec<f64>,
}

impl FieldGrid {
    pub fn sample(
        origin: (i32, i32),
        size: usize,
        step: i32,
        mut field: impl FnMut(i32, i32) -> f64,
    ) -> Self {
        assert!(size >= 2 && step >= 1, "grid needs area and a stride");
        let mut values = Vec::with_capacity(size * size);
        for iz in 0..size {
            for ix in 0..size {
                values.push(field(
                    origin.0 + ix as i32 * step,
                    origin.1 + iz as i32 * step,
                ));
            }
        }
        Self {
            origin,
            step,
            size,
            values,
        }
    }

    #[inline]
    pub fn value(&self, ix: usize, iz: usize) -> f64 {
        self.values[iz * self.size + ix]
    }

    pub fn values(&self) -> &[f64] {
        &self.values
    }
}

/// Distribution summary of a sample set.
#[derive(Debug, Clone, Serialize)]
pub struct FieldStats {
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub std_dev: f64,
    pub p01: f64,
    pub p05: f64,
    pub p50: f64,
    pub p95: f64,
    pub p99: f64,
}

impl FieldStats {
    pub fn measure(values: &[f64]) -> Self {
        assert!(!values.is_empty(), "stats need samples");
        let mut sorted = values.to_vec();
        sorted.sort_by(|a, b| a.partial_cmp(b).expect("finite samples"));
        let mean = sorted.iter().sum::<f64>() / sorted.len() as f64;
        let variance = sorted
            .iter()
            .map(|v| (v - mean) * (v - mean))
            .sum::<f64>()
            / sorted.len() as f64;
        let pct = |p: f64| sorted[((sorted.len() - 1) as f64 * p).round() as usize];
        Self {
            min: sorted[0],
            max: sorted[sorted.len() - 1],
            mean,
            std_dev: variance.sqrt(),
            p01: pct(0.01),
            p05: pct(0.05),
            p50: pct(0.50),
            p95: pct(0.95),
            p99: pct(0.99),
        }
    }
}

/// Energy share per frequency band, finest first, from a Laplacian-pyramid
/// style decomposition: each level is a 2x2 box downsample of the previous,
/// and a band's energy is the variance of what that downsample discarded.
/// A single-scale ("low-octave") field concentrates its shares in one or
/// two bands; a professional multi-scale stack spreads them.
pub fn band_shares(grid: &FieldGrid, bands: usize) -> Vec<f64> {
    let mut level: Vec<f64> = grid.values().to_vec();
    let mut level_size = grid.size;
    let mut energies = Vec::new();
    for _ in 0..bands {
        if level_size < 4 {
            break;
        }
        let half = level_size / 2;
        let mut coarse = vec![0.0; half * half];
        for cz in 0..half {
            for cx in 0..half {
                let mut sum = 0.0;
                for dz in 0..2 {
                    for dx in 0..2 {
                        sum += level[(cz * 2 + dz) * level_size + cx * 2 + dx];
                    }
                }
                coarse[cz * half + cx] = sum / 4.0;
            }
        }
        let mut detail_energy = 0.0;
        for z in 0..level_size {
            for x in 0..level_size {
                let detail = level[z * level_size + x] - coarse[(z / 2) * half + x / 2];
                detail_energy += detail * detail;
            }
        }
        energies.push(detail_energy / (level_size * level_size) as f64);
        level = coarse;
        level_size = half;
    }
    // Residual: whatever variance the coarsest level still carries.
    let mean = level.iter().sum::<f64>() / level.len() as f64;
    energies.push(
        level.iter().map(|v| (v - mean) * (v - mean)).sum::<f64>() / level.len() as f64,
    );
    let total: f64 = energies.iter().sum();
    if total <= 0.0 {
        return vec![0.0; energies.len()];
    }
    energies.iter().map(|e| e / total).collect()
}

/// Normalized autocorrelation (Pearson) of the grid against itself shifted
/// by `lag` grid cells. 1.0 means the field repeats exactly at that offset.
pub fn autocorrelation(grid: &FieldGrid, lag: (i32, i32)) -> f64 {
    let size = grid.size as i32;
    let (lx, lz) = lag;
    assert!(
        lx.abs() < size && lz.abs() < size,
        "lag must stay inside the grid"
    );
    let x_range = if lx >= 0 { 0..size - lx } else { -lx..size };
    let z_range = if lz >= 0 { 0..size - lz } else { -lz..size };
    let mut a_values = Vec::new();
    let mut b_values = Vec::new();
    for z in z_range {
        for x in x_range.clone() {
            a_values.push(grid.value(x as usize, z as usize));
            b_values.push(grid.value((x + lx) as usize, (z + lz) as usize));
        }
    }
    let n = a_values.len() as f64;
    let mean_a = a_values.iter().sum::<f64>() / n;
    let mean_b = b_values.iter().sum::<f64>() / n;
    let mut covariance = 0.0;
    let mut var_a = 0.0;
    let mut var_b = 0.0;
    for (a, b) in a_values.iter().zip(&b_values) {
        covariance += (a - mean_a) * (b - mean_b);
        var_a += (a - mean_a) * (a - mean_a);
        var_b += (b - mean_b) * (b - mean_b);
    }
    let denominator = (var_a * var_b).sqrt();
    if denominator <= 0.0 {
        return 1.0;
    }
    covariance / denominator
}

/// The repetition diagnostic, an echo score: along each of the four
/// principal directions, walk lags outward; once correlation first decays
/// below `decay_threshold`, the strongest correlation seen afterwards is
/// that direction's echo — a pattern that comes back is a pattern that
/// repeats. A direction whose correlation never decays at all is
/// translation-invariant across the window (the straight-parallel-ridges
/// signature) and scores its floor correlation instead. Terrain that is
/// merely smooth decays once and stays down, scoring near zero.
///
/// The window must span several multiples of the largest feature
/// wavelength, or macro smoothness is indistinguishable from sameness.
pub fn repetition_score(grid: &FieldGrid, decay_threshold: f64) -> f64 {
    let half = (grid.size / 2) as i32;
    let mut score: f64 = 0.0;
    for direction in [(1, 0), (0, 1), (1, 1), (1, -1)] {
        let mut is_decayed = false;
        let mut echo: f64 = 0.0;
        let mut floor: f64 = 1.0;
        for k in 1..=half {
            let lag = (direction.0 * k, direction.1 * k);
            let c = autocorrelation(grid, lag);
            floor = floor.min(c);
            if is_decayed {
                echo = echo.max(c);
            } else if c < decay_threshold {
                is_decayed = true;
            }
        }
        score = score.max(if is_decayed { echo } else { floor });
    }
    score
}

/// Relief span (max minus min) of each `window`-by-`window` tile of the
/// grid, row-major. The relief-mix diagnostic: uniform ridge fields make
/// every tile rugged; belted, eroded terrain mixes calm tiles with rugged
/// ones. Tile edge in blocks is `window * grid.step`.
pub fn relief_windows(grid: &FieldGrid, window: usize) -> Vec<f64> {
    assert!(window >= 2 && window <= grid.size, "window must fit the grid");
    let per_axis = grid.size / window;
    let mut reliefs = Vec::with_capacity(per_axis * per_axis);
    for wz in 0..per_axis {
        for wx in 0..per_axis {
            let mut lo = f64::MAX;
            let mut hi = f64::MIN;
            for iz in 0..window {
                for ix in 0..window {
                    let v = grid.value(wx * window + ix, wz * window + iz);
                    lo = lo.min(v);
                    hi = hi.max(v);
                }
            }
            reliefs.push(hi - lo);
        }
    }
    reliefs
}

/// Values of strict local maxima over a `(2*radius+1)^2` neighborhood, at
/// or above `floor`. The crest-variety diagnostic: uniform ridge fields
/// push every crest to the same height; varied morphology spreads them.
pub fn local_maxima(grid: &FieldGrid, radius: usize, floor: f64) -> Vec<f64> {
    let mut maxima = Vec::new();
    let r = radius as i32;
    let n = grid.size as i32;
    for z in r..n - r {
        for x in r..n - r {
            let center = grid.value(x as usize, z as usize);
            if center < floor {
                continue;
            }
            let mut is_max = true;
            'scan: for dz in -r..=r {
                for dx in -r..=r {
                    if dx == 0 && dz == 0 {
                        continue;
                    }
                    if grid.value((x + dx) as usize, (z + dz) as usize) > center {
                        is_max = false;
                        break 'scan;
                    }
                }
            }
            if is_max {
                maxima.push(center);
            }
        }
    }
    maxima
}

#[cfg(test)]
mod tests {
    use super::*;

    fn triangle_wave(x: i32, period: i32) -> f64 {
        let phase = x.rem_euclid(period) as f64 / period as f64;
        (phase * 2.0 - 1.0).abs()
    }

    #[test]
    fn autocorrelation_finds_exact_periodicity() {
        let grid = FieldGrid::sample((0, 0), 64, 1, |x, _| triangle_wave(x, 16));
        let at_period = autocorrelation(&grid, (16, 0));
        let off_period = autocorrelation(&grid, (8, 0));
        assert!(at_period > 0.999, "period lag must correlate: {at_period}");
        assert!(off_period < -0.9, "half-period must anticorrelate: {off_period}");
    }

    #[test]
    fn repetition_score_separates_periodic_from_fractal() {
        use crate::noise::{Fractal, NoiseKind};
        let periodic = FieldGrid::sample((0, 0), 64, 1, |x, z| {
            triangle_wave(x, 16) + 0.25 * triangle_wave(z, 16)
        });
        let fractal_noise = Fractal::new(9, 1.0 / 8.0, 5, 0.5, 2.0, NoiseKind::Fbm);
        let fractal = FieldGrid::sample((0, 0), 64, 1, |x, z| {
            fractal_noise.sample2(x as f64, z as f64)
        });
        let periodic_score = repetition_score(&periodic, 0.3);
        let fractal_score = repetition_score(&fractal, 0.3);
        assert!(periodic_score > 0.95, "periodic: {periodic_score}");
        assert!(fractal_score < 0.5, "fractal: {fractal_score}");
    }

    #[test]
    fn band_shares_flag_single_scale_fields() {
        use crate::noise::{Fractal, NoiseKind};
        let single = Fractal::new(5, 1.0 / 64.0, 1, 0.5, 2.0, NoiseKind::Fbm);
        let multi = Fractal::new(5, 1.0 / 64.0, 6, 0.8, 2.0, NoiseKind::Fbm);
        let single_grid =
            FieldGrid::sample((0, 0), 128, 1, |x, z| single.sample2(x as f64, z as f64));
        let multi_grid =
            FieldGrid::sample((0, 0), 128, 1, |x, z| multi.sample2(x as f64, z as f64));
        let single_shares = band_shares(&single_grid, 5);
        let multi_shares = band_shares(&multi_grid, 5);
        let meaningful = |shares: &[f64]| shares.iter().filter(|s| **s >= 0.05).count();
        let fine_pair = |shares: &[f64]| shares[0] + shares[1];
        assert!(
            meaningful(&single_shares) <= 3 && fine_pair(&single_shares) < 0.02,
            "coarse-only field should carry no fine energy: {single_shares:?}"
        );
        assert!(
            meaningful(&multi_shares) >= 5 && fine_pair(&multi_shares) > 0.06,
            "multi-scale field should spread: {multi_shares:?}"
        );
    }

    #[test]
    fn relief_windows_and_local_maxima_measure_mixes() {
        // A field that is flat on one side and a tall bump grid on the
        // other must show both calm and rugged windows, and the maxima
        // detector must find exactly the bump crests.
        let grid = FieldGrid::sample((0, 0), 64, 1, |x, z| {
            if x < 32 {
                0.0
            } else {
                triangle_wave(x, 16) * 30.0 + triangle_wave(z, 16) * 30.0
            }
        });
        let reliefs = relief_windows(&grid, 16);
        let max_relief = reliefs.iter().cloned().fold(f64::MIN, f64::max);
        let calm = reliefs.iter().filter(|r| **r < max_relief * 0.1).count();
        let rugged = reliefs.iter().filter(|r| **r > max_relief * 0.5).count();
        assert!(calm >= 4 && rugged >= 4, "calm {calm}, rugged {rugged}");

        let crests = local_maxima(&grid, 2, 30.0);
        assert!(!crests.is_empty());
        assert!(crests.iter().all(|c| *c >= 30.0));
    }

    #[test]
    fn stats_summarize_distributions() {
        let values: Vec<f64> = (0..1000).map(|i| i as f64 / 999.0).collect();
        let stats = FieldStats::measure(&values);
        assert_eq!(stats.min, 0.0);
        assert_eq!(stats.max, 1.0);
        assert!((stats.mean - 0.5).abs() < 1e-9);
        assert!((stats.p50 - 0.5).abs() < 0.01);
        assert!((stats.p95 - 0.95).abs() < 0.01);
    }
}
