//! `QualityReport`: taste as numbers, checked in both directions.
//!
//! Computed from a heightmap window (final ground at some stride), over
//! land columns only:
//!
//! - **cut-ness**: the *rim break width* (from the last column steeper
//!   than 1.2 to the first gentler than 0.3, marching uphill along the
//!   gradient; knife edges measure about 1, worn rims 3 or more), the
//!   *edge spike share* (columns whose Laplacian reaches 6 blocks per
//!   block squared), and the *axis bias* (the share of gradients within
//!   22.5 degrees of a grid axis over the isotropic half; above 1.3 the
//!   terrain is aligned to the grid);
//! - **spectrum** without an FFT: a box-blur difference ladder
//!   `E(l) = mean((B(l/2) h - B(l) h)^2)` for `l = 2 .. 512`; the *fine
//!   ratio* `E(<=8) / E(32..256)` caps cavity-like fine erosion, and the
//!   *medium floor* `E(32..256) / E(>=512)` refuses fake-smooth terrain;
//! - **massiveness**: relief per 512-block window (p90);
//! - **realism**: the hypsometric integral.
//!
//! [`QualityBands`] holds the limits a preset must pass.

use serde::{Deserialize, Serialize};

use super::math::MinMax;

/// The measured metrics of one window.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QualityReport {
    /// Window side in samples, and sample spacing in blocks.
    pub samples: (usize, usize, f64),
    /// Share of land samples.
    pub land_share: f64,
    /// Rim break width p10 and p50 in blocks, with the count measured
    /// (`None` where no steep rim exists).
    pub rim_break: Option<(f64, f64, usize)>,
    /// Share of land samples with `|laplacian| >= 6`.
    pub edge_spike_share: f64,
    /// Axis-aligned gradient share over the isotropic 0.5.
    pub axis_bias: f64,
    /// `E(l)` for `l = 2, 4, ..., 512` blocks (`None` below two samples).
    pub ladder: Vec<(f64, Option<f64>)>,
    /// `E(<=8) / E(32..256)`.
    pub fine_ratio: Option<f64>,
    /// `E(32..256) / E(>=512)`.
    pub medium_floor: Option<f64>,
    /// Relief p90 over 512-block windows.
    pub relief_p90: Option<f64>,
    /// Hypsometric integral of land.
    pub hypsometric: Option<f64>,
}

/// Limits a preset must pass.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct QualityBands {
    /// Fine ratio cap (no cavity-like fine erosion).
    pub max_fine_ratio: f64,
    /// Medium floor (not fake-smooth).
    pub min_medium_floor: f64,
    /// Least rim break p50 where rims exist (worn, not cut).
    pub min_rim_break_p50: f64,
    /// Largest axis bias.
    pub max_axis_bias: f64,
    /// Largest edge spike share.
    pub max_edge_spike_share: f64,
}

impl QualityBands {
    /// The failures of `r` against these bands, empty when it passes.
    pub fn failures(&self, r: &QualityReport) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(f) = r.fine_ratio {
            if f > self.max_fine_ratio {
                out.push(format!("fine ratio {f:.5} exceeds {}", self.max_fine_ratio));
            }
        }
        if let Some(m) = r.medium_floor {
            if m < self.min_medium_floor {
                out.push(format!(
                    "medium floor {m:.5} is below {}",
                    self.min_medium_floor
                ));
            }
        }
        if let Some((_, p50, n)) = r.rim_break {
            if n >= 16 && p50 < self.min_rim_break_p50 {
                out.push(format!(
                    "rim break p50 {p50:.2} is below {}",
                    self.min_rim_break_p50
                ));
            }
        }
        if r.axis_bias > self.max_axis_bias {
            out.push(format!(
                "axis bias {:.3} exceeds {}",
                r.axis_bias, self.max_axis_bias
            ));
        }
        if r.edge_spike_share > self.max_edge_spike_share {
            out.push(format!(
                "edge spike share {:.5} exceeds {}",
                r.edge_spike_share, self.max_edge_spike_share
            ));
        }
        out
    }
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    let i = ((sorted.len() - 1) as f64 * q + 0.5).floor() as usize;
    sorted[Ord::min(i, sorted.len() - 1)]
}

/// Box blur of width `k` samples (odd or even; centred, clamped at the
/// edges), separable, by prefix sums.
fn box_blur(h: &[f64], w: usize, d: usize, k: usize) -> Vec<f64> {
    if k <= 1 {
        return h.to_vec();
    }
    let lo = k / 2;
    let hi = k - lo - 1;
    let mut tmp = vec![0.0; w * d];
    let mut prefix = vec![0.0; Ord::max(w, d) + 1];
    for z in 0..d {
        for x in 0..w {
            prefix[x + 1] = prefix[x] + h[z * w + x];
        }
        for x in 0..w {
            let a = x.saturating_sub(lo);
            let b = Ord::min(x + hi, w - 1);
            tmp[z * w + x] = (prefix[b + 1] - prefix[a]) / (b + 1 - a) as f64;
        }
    }
    let mut out = vec![0.0; w * d];
    for x in 0..w {
        for z in 0..d {
            prefix[z + 1] = prefix[z] + tmp[z * w + x];
        }
        for z in 0..d {
            let a = z.saturating_sub(lo);
            let b = Ord::min(z + hi, d - 1);
            out[z * w + x] = (prefix[b + 1] - prefix[a]) / (b + 1 - a) as f64;
        }
    }
    out
}

impl QualityReport {
    /// Measure a `w x d` heightmap sampled every `spacing` blocks; land is
    /// where ground lies above `sea + 1`.
    pub fn measure(h: &[f64], w: usize, d: usize, spacing: f64, sea: f64) -> QualityReport {
        assert_eq!(h.len(), w * d);
        let at = |x: usize, z: usize| h[z * w + x];
        let land = |x: usize, z: usize| at(x, z) > sea + 1.0;
        let mut slope = vec![0.0f64; w * d];
        let mut grad = vec![(0.0f64, 0.0f64); w * d];
        let mut land_n = 0usize;
        let mut spikes = 0usize;
        let mut axis = 0usize;
        let mut sloped = 0usize;
        for z in 1..d - 1 {
            for x in 1..w - 1 {
                let gx = (at(x + 1, z) - at(x - 1, z)) / (2.0 * spacing);
                let gz = (at(x, z + 1) - at(x, z - 1)) / (2.0 * spacing);
                let s = (gx * gx + gz * gz).sqrt();
                slope[z * w + x] = s;
                grad[z * w + x] = (gx, gz);
                if !land(x, z) {
                    continue;
                }
                land_n += 1;
                let lap = (at(x + 1, z) + at(x - 1, z) + at(x, z + 1) + at(x, z - 1)
                    - 4.0 * at(x, z))
                    / (spacing * spacing);
                if lap.abs() >= 6.0 {
                    spikes += 1;
                }
                if s >= 0.1 {
                    sloped += 1;
                    let (ax, az) = (gx.abs(), gz.abs());
                    // Within 22.5 degrees of an axis: tan(22.5) = sqrt 2 - 1.
                    if ax.fmin(az) < (std::f64::consts::SQRT_2 - 1.0) * ax.fmax(az) {
                        axis += 1;
                    }
                }
            }
        }
        let interior = (w - 2) * (d - 2);
        // Rim break widths: from the top of each steep band, march uphill.
        let mut breaks = Vec::new();
        let sample_slope = |px: f64, pz: f64| -> Option<f64> {
            let (fx, fz) = (px.floor(), pz.floor());
            let (ix, iz) = (fx as i64, fz as i64);
            if ix < 1 || iz < 1 || ix + 2 >= w as i64 || iz + 2 >= d as i64 {
                return None;
            }
            let (tx, tz) = (px - fx, pz - fz);
            let s = |x: i64, z: i64| slope[z as usize * w + x as usize];
            let a = s(ix, iz) + (s(ix + 1, iz) - s(ix, iz)) * tx;
            let b = s(ix, iz + 1) + (s(ix + 1, iz + 1) - s(ix, iz + 1)) * tx;
            Some(a + (b - a) * tz)
        };
        for z in 2..d - 2 {
            for x in 2..w - 2 {
                let i = z * w + x;
                if slope[i] < 1.2 || !land(x, z) {
                    continue;
                }
                let (gx, gz) = grad[i];
                let s = slope[i];
                let (ux, uz) = (gx / s, gz / s);
                // Only the top edge of the steep band starts a march.
                let step = 0.5 / spacing;
                match sample_slope(x as f64 + ux * step * 2.0, z as f64 + uz * step * 2.0) {
                    Some(next) if next < 1.2 => {}
                    _ => continue,
                }
                let mut last_steep = 0.0;
                let mut t = 0.0;
                let mut found = None;
                while t * spacing <= 32.0 {
                    t += step;
                    let Some(v) = sample_slope(x as f64 + ux * t, z as f64 + uz * t) else {
                        break;
                    };
                    if v >= 1.2 {
                        last_steep = t;
                    } else if v <= 0.3 {
                        found = Some((t - last_steep) * spacing);
                        break;
                    }
                }
                if let Some(d) = found {
                    breaks.push(d);
                }
            }
        }
        breaks.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let rim_break = if breaks.is_empty() {
            None
        } else {
            Some((
                percentile(&breaks, 0.1),
                percentile(&breaks, 0.5),
                breaks.len(),
            ))
        };

        // The spectrum ladder over land.
        let mut ladder = Vec::new();
        let mut prev = h.to_vec();
        let mut lambda = 2.0;
        let mut energies: Vec<(f64, Option<f64>)> = Vec::new();
        // Odd, centred boxes (width about one wavelength), so a blur never
        // shifts the field by half a sample.
        let odd = |l: f64| 2 * (l / (2.0 * spacing)).floor() as usize + 1;
        while lambda <= 512.0 {
            let k = odd(lambda);
            let cur = box_blur(h, w, d, k);
            let e = if k >= 3 && odd(lambda / 2.0) < k {
                // Only columns whose largest box fits inside the window.
                let m = k / 2 + 1;
                let mut sum = 0.0;
                let mut n = 0usize;
                if w > 2 * m && d > 2 * m {
                    for z in m..d - m {
                        for x in m..w - m {
                            if land(x, z) {
                                let diff = prev[z * w + x] - cur[z * w + x];
                                sum += diff * diff;
                                n += 1;
                            }
                        }
                    }
                }
                if n > 0 {
                    Some(sum / n as f64)
                } else {
                    None
                }
            } else {
                None
            };
            energies.push((lambda, e));
            ladder.push((lambda, e));
            prev = cur;
            lambda *= 2.0;
        }
        let band = |lo: f64, hi: f64| -> Option<f64> {
            let mut s = 0.0;
            let mut any = false;
            for &(l, e) in &energies {
                if l >= lo && l <= hi {
                    if let Some(e) = e {
                        s += e;
                        any = true;
                    }
                }
            }
            if any {
                Some(s)
            } else {
                None
            }
        };
        let fine = band(2.0, 8.0);
        let medium = band(32.0, 256.0);
        let coarse = band(512.0, 512.0);
        let fine_ratio = match (fine, medium) {
            (Some(f), Some(m)) if m > 0.0 => Some(f / m),
            _ => None,
        };
        let medium_floor = match (medium, coarse) {
            (Some(m), Some(c)) if c > 0.0 => Some(m / c),
            _ => None,
        };

        // Relief per 512-block window.
        let win = (512.0 / spacing).floor() as usize;
        let mut reliefs = Vec::new();
        if win >= 2 && win <= w && win <= d {
            let mut z0 = 0;
            while z0 + win <= d {
                let mut x0 = 0;
                while x0 + win <= w {
                    let mut lo = f64::INFINITY;
                    let mut hi = f64::NEG_INFINITY;
                    for z in z0..z0 + win {
                        for x in x0..x0 + win {
                            lo = lo.fmin(at(x, z));
                            hi = hi.fmax(at(x, z));
                        }
                    }
                    reliefs.push(hi - lo);
                    x0 += win;
                }
                z0 += win;
            }
        }
        reliefs.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let relief_p90 = if reliefs.is_empty() {
            None
        } else {
            Some(percentile(&reliefs, 0.9))
        };
        let land_heights: Vec<f64> = h.iter().copied().filter(|&v| v > sea + 1.0).collect();
        let hypsometric = if land_heights.len() > 16 {
            let lo = land_heights
                .iter()
                .copied()
                .fold(f64::INFINITY, |a, b| a.fmin(b));
            let hi = land_heights
                .iter()
                .copied()
                .fold(f64::NEG_INFINITY, |a, b| a.fmax(b));
            let mean = land_heights.iter().sum::<f64>() / land_heights.len() as f64;
            if hi > lo {
                Some((mean - lo) / (hi - lo))
            } else {
                None
            }
        } else {
            None
        };
        QualityReport {
            samples: (w, d, spacing),
            land_share: land_n as f64 / interior as f64,
            rim_break,
            edge_spike_share: if land_n > 0 {
                spikes as f64 / land_n as f64
            } else {
                0.0
            },
            axis_bias: if sloped > 0 {
                (axis as f64 / sloped as f64) / 0.5
            } else {
                1.0
            },
            ladder,
            fine_ratio,
            medium_floor,
            relief_p90,
            hypsometric,
        }
    }
}

impl super::Landscape {
    /// The quality report of the `size`-block square window from `(x0, z0)`
    /// sampled every `stride` blocks.
    pub fn quality(&self, x0: i32, z0: i32, size: usize, stride: i32) -> QualityReport {
        let n = size / stride as usize;
        let h = self.ground_window(x0, z0, n, n, stride);
        QualityReport::measure(&h, n, n, stride as f64, self.frame.sea as f64)
    }
}
