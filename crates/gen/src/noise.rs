//! Self-contained gradient noise. The permutation table derives from a
//! seed stream (not from any external library's RNG), and evaluation uses
//! only IEEE add/mul/floor/sqrt — no transcendentals — so results are
//! bit-identical across machines, debug/release, and library versions.

use serde::Serialize;

use crate::stream::HashStream;

#[derive(Debug, Clone)]
pub struct Perlin {
    perm: Box<[u8; 512]>,
}

impl Perlin {
    pub fn new(seed: u64) -> Self {
        let mut table: [u8; 256] = [0; 256];
        for (i, slot) in table.iter_mut().enumerate() {
            *slot = i as u8;
        }
        let mut stream = HashStream::new(seed);
        for i in (1..256usize).rev() {
            let j = (stream.raw() % (i as u64 + 1)) as usize;
            table.swap(i, j);
        }
        let mut perm = Box::new([0u8; 512]);
        for i in 0..512 {
            perm[i] = table[i & 255];
        }
        Self { perm }
    }

    #[inline]
    fn fade(t: f64) -> f64 {
        t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
    }

    #[inline]
    fn grad2(hash: u8, x: f64, y: f64) -> f64 {
        // 8 gradient directions; axis sums keep amplitude bounded.
        match hash & 7 {
            0 => x + y,
            1 => x - y,
            2 => -x + y,
            3 => -x - y,
            4 => x,
            5 => -x,
            6 => y,
            _ => -y,
        }
    }

    #[inline]
    fn grad3(hash: u8, x: f64, y: f64, z: f64) -> f64 {
        match hash & 15 {
            0 => x + y,
            1 => -x + y,
            2 => x - y,
            3 => -x - y,
            4 => x + z,
            5 => -x + z,
            6 => x - z,
            7 => -x - z,
            8 => y + z,
            9 => -y + z,
            10 => y - z,
            11 => -y - z,
            12 => x + y,
            13 => -y + z,
            14 => -x + y,
            _ => -y - z,
        }
    }

    pub fn sample2(&self, x: f64, y: f64) -> f64 {
        let xf = x.floor();
        let yf = y.floor();
        let xi = (xf as i64 & 255) as usize;
        let yi = (yf as i64 & 255) as usize;
        let dx = x - xf;
        let dy = y - yf;

        let u = Self::fade(dx);
        let v = Self::fade(dy);

        let p = &self.perm;
        let a = p[xi] as usize + yi;
        let b = p[xi + 1] as usize + yi;

        let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
        let x1 = lerp(
            Self::grad2(p[a], dx, dy),
            Self::grad2(p[b], dx - 1.0, dy),
            u,
        );
        let x2 = lerp(
            Self::grad2(p[a + 1], dx, dy - 1.0),
            Self::grad2(p[b + 1], dx - 1.0, dy - 1.0),
            u,
        );
        // grad2 spans roughly [-2, 2]; normalize toward [-1, 1].
        lerp(x1, x2, v) * std::f64::consts::FRAC_1_SQRT_2
    }

    pub fn sample3(&self, x: f64, y: f64, z: f64) -> f64 {
        let xf = x.floor();
        let yf = y.floor();
        let zf = z.floor();
        let xi = (xf as i64 & 255) as usize;
        let yi = (yf as i64 & 255) as usize;
        let zi = (zf as i64 & 255) as usize;
        let dx = x - xf;
        let dy = y - yf;
        let dz = z - zf;

        let u = Self::fade(dx);
        let v = Self::fade(dy);
        let w = Self::fade(dz);

        let p = &self.perm;
        let a = p[xi] as usize + yi;
        let aa = p[a] as usize + zi;
        let ab = p[a + 1] as usize + zi;
        let b = p[xi + 1] as usize + yi;
        let ba = p[b] as usize + zi;
        let bb = p[b + 1] as usize + zi;

        let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
        let x1 = lerp(
            Self::grad3(p[aa], dx, dy, dz),
            Self::grad3(p[ba], dx - 1.0, dy, dz),
            u,
        );
        let x2 = lerp(
            Self::grad3(p[ab], dx, dy - 1.0, dz),
            Self::grad3(p[bb], dx - 1.0, dy - 1.0, dz),
            u,
        );
        let y1 = lerp(x1, x2, v);
        let x3 = lerp(
            Self::grad3(p[aa + 1], dx, dy, dz - 1.0),
            Self::grad3(p[ba + 1], dx - 1.0, dy, dz - 1.0),
            u,
        );
        let x4 = lerp(
            Self::grad3(p[ab + 1], dx, dy - 1.0, dz - 1.0),
            Self::grad3(p[bb + 1], dx - 1.0, dy - 1.0, dz - 1.0),
            u,
        );
        let y2 = lerp(x3, x4, v);
        lerp(y1, y2, w) * std::f64::consts::FRAC_1_SQRT_2
    }
}

/// Fractal accumulation strategy. `Fbm` and `Ridged` keep the exact
/// arithmetic of the original engine slice (their outputs are golden-pinned
/// world data); the multifractal kinds weight octaves by the running signal
/// so relief is heterogeneous — smooth basins, detailed crests — instead of
/// the uniform ridge repetition plain `Ridged` produces.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum NoiseKind {
    Fbm,
    /// Per-octave `1 - 2|n|`: sharp creases everywhere, uniform character.
    Ridged,
    /// Per-octave `2|n| - 1`: rounded lobes, the billowing inverse of ridged.
    Billow,
    /// Musgrave hybrid multifractal: octave contributions are damped by the
    /// running total, so lowlands stay smooth while highlands accumulate
    /// detail. `offset` (0..=2, ~0.7) biases the signal positive.
    HybridMulti { offset: f64 },
    /// Musgrave ridged multifractal: squared ridges with spectral weights
    /// fed back through `gain`, yielding varied crest-and-saddle chains
    /// rather than a uniform ridge field. `offset` in (0..=2] (~1.0),
    /// `gain` in (0..=8] (~2.0).
    RidgedMulti { offset: f64, gain: f64 },
}

/// Fractal noise over per-octave Perlin instances. Each octave gets its own
/// permutation (derived from the same seed), which avoids the self-similar
/// artifacts of reusing one table across octaves.
#[derive(Debug, Clone)]
pub struct Fractal {
    octaves: Vec<Perlin>,
    frequency: f64,
    lacunarity: f64,
    persistence: f64,
    amplitude_norm: f64,
    kind: NoiseKind,
}

impl Fractal {
    pub fn new(
        seed: u64,
        frequency: f64,
        octaves: u8,
        persistence: f64,
        lacunarity: f64,
        kind: NoiseKind,
    ) -> Self {
        let mut stream = HashStream::new(seed);
        let octaves: Vec<Perlin> = (0..octaves.max(1))
            .map(|_| Perlin::new(stream.raw()))
            .collect();
        let mut amplitude = 1.0;
        let mut total = 0.0;
        for _ in 0..octaves.len() {
            total += amplitude;
            amplitude *= persistence;
        }
        let amplitude_norm = match kind {
            NoiseKind::Fbm | NoiseKind::Ridged | NoiseKind::Billow => 1.0 / total,
            // Hybrid signals span up to (1 + offset) per unit amplitude.
            NoiseKind::HybridMulti { offset } => 1.0 / (total * (1.0 + offset)),
            // Ridged-multi signals are squared ridges capped at offset^2.
            NoiseKind::RidgedMulti { offset, .. } => 1.0 / (total * offset * offset),
        };
        Self {
            octaves,
            frequency,
            lacunarity,
            persistence,
            amplitude_norm,
            kind,
        }
    }

    pub fn sample2(&self, x: f64, z: f64) -> f64 {
        self.accumulate(|octave, freq| octave.sample2(x * freq, z * freq))
    }

    pub fn sample3(&self, x: f64, y: f64, z: f64) -> f64 {
        self.accumulate(|octave, freq| octave.sample3(x * freq, y * freq, z * freq))
    }

    fn accumulate(&self, mut raw_at: impl FnMut(&Perlin, f64) -> f64) -> f64 {
        match self.kind {
            NoiseKind::Fbm | NoiseKind::Ridged | NoiseKind::Billow => {
                let mut freq = self.frequency;
                let mut amp = 1.0;
                let mut sum = 0.0;
                for octave in &self.octaves {
                    let raw = raw_at(octave, freq);
                    sum += match self.kind {
                        NoiseKind::Ridged => (1.0 - raw.abs() * 2.0) * amp,
                        NoiseKind::Billow => (raw.abs() * 2.0 - 1.0) * amp,
                        _ => raw * amp,
                    };
                    freq *= self.lacunarity;
                    amp *= self.persistence;
                }
                (sum * self.amplitude_norm).clamp(-1.0, 1.0)
            }
            NoiseKind::HybridMulti { offset } => {
                let mut freq = self.frequency;
                let mut amp = 1.0;
                let mut sum = 0.0;
                let mut weight = 0.0;
                for (index, octave) in self.octaves.iter().enumerate() {
                    let signal = (raw_at(octave, freq) + offset) * amp;
                    if index == 0 {
                        sum = signal;
                        weight = signal;
                    } else {
                        let damped = weight.min(1.0);
                        sum += damped * signal;
                        weight *= signal;
                    }
                    freq *= self.lacunarity;
                    amp *= self.persistence;
                }
                (sum * self.amplitude_norm).clamp(-1.0, 1.0)
            }
            NoiseKind::RidgedMulti { offset, gain } => {
                let mut freq = self.frequency;
                let mut amp = 1.0;
                let mut sum = 0.0;
                let mut weight = 1.0;
                for octave in &self.octaves {
                    let ridge = offset - raw_at(octave, freq).abs();
                    let signal = ridge * ridge * weight;
                    weight = (signal * gain).clamp(0.0, 1.0);
                    sum += signal * amp;
                    freq *= self.lacunarity;
                    amp *= self.persistence;
                }
                // Signals are nonnegative; expand [0, 1] to [-1, 1].
                (sum * self.amplitude_norm * 2.0 - 1.0).clamp(-1.0, 1.0)
            }
        }
    }
}

#[inline]
pub fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perlin_is_deterministic_per_seed() {
        let a = Perlin::new(99);
        let b = Perlin::new(99);
        let c = Perlin::new(100);
        for i in 0..64 {
            let (x, z) = (i as f64 * 0.37, i as f64 * -0.61);
            assert_eq!(a.sample2(x, z).to_bits(), b.sample2(x, z).to_bits());
        }
        assert_ne!(
            a.sample2(1.3, 4.7).to_bits(),
            c.sample2(1.3, 4.7).to_bits()
        );
    }

    #[test]
    fn fbm_and_ridged_keep_the_pinned_arithmetic() {
        // Golden values from the original engine slice: these two kinds are
        // world data and may only change with a format-version decision.
        let f = Fractal::new(7, 0.01, 5, 0.5, 2.0, NoiseKind::Fbm);
        let r = Fractal::new(7, 0.01, 4, 0.5, 2.0, NoiseKind::Ridged);
        let expect_f = [
            (13.0, -71.0, 0.051682552238690664),
            (250.5, 33.25, 0.0806319536820379),
            (-1024.0, 4096.0, -0.04553291010166044),
        ];
        for (x, z, value) in expect_f {
            assert_eq!(
                f.sample2(x, z).to_bits(),
                f64::to_bits(value),
                "fbm drifted at ({x},{z}): {}",
                f.sample2(x, z)
            );
        }
        let expect_r = [
            (13.0, -71.0, 0.8391346939133072),
            (250.5, 33.25, 0.8308485185837255),
            (-1024.0, 4096.0, 0.8440130216751061),
        ];
        for (x, z, value) in expect_r {
            assert_eq!(
                r.sample2(x, z).to_bits(),
                f64::to_bits(value),
                "ridged drifted at ({x},{z}): {}",
                r.sample2(x, z)
            );
        }
    }

    #[test]
    fn all_kinds_are_bounded_and_varied() {
        let kinds = [
            NoiseKind::Fbm,
            NoiseKind::Ridged,
            NoiseKind::Billow,
            NoiseKind::HybridMulti { offset: 0.7 },
            NoiseKind::RidgedMulti {
                offset: 1.0,
                gain: 2.0,
            },
        ];
        for kind in kinds {
            let f = Fractal::new(7, 0.01, 5, 0.5, 2.0, kind);
            let mut min = f64::MAX;
            let mut max = f64::MIN;
            for i in 0..4096 {
                let (x, z) = ((i % 64) as f64 * 3.1, (i / 64) as f64 * 3.1);
                let v = f.sample2(x, z);
                assert!(
                    v.is_finite() && (-1.0..=1.0).contains(&v),
                    "{kind:?} out of range: {v}"
                );
                min = min.min(v);
                max = max.max(v);
            }
            assert!(
                max - min > 0.3,
                "{kind:?} should span a real range: {min}..{max}"
            );
        }
    }

    #[test]
    fn new_kinds_are_golden_pinned() {
        // These pins define the reference output for the kinds introduced
        // upstream; any drift is a world-breaking change by definition.
        let cases = [
            (
                NoiseKind::Billow,
                [
                    (13.0, -71.0, -0.8337778515680004),
                    (250.5, 33.25, -0.8338739433325769),
                    (-1024.0, 4096.0, -0.8386178384400187),
                ],
            ),
            (
                NoiseKind::HybridMulti { offset: 0.7 },
                [
                    (13.0, -71.0, 0.34564432633872927),
                    (250.5, 33.25, 0.34869481433634636),
                    (-1024.0, 4096.0, 0.2884332743738047),
                ],
            ),
            (
                NoiseKind::RidgedMulti {
                    offset: 1.0,
                    gain: 2.0,
                },
                [
                    (13.0, -71.0, 0.6854485055878317),
                    (250.5, 33.25, 0.682218917599156),
                    (-1024.0, 4096.0, 0.6978249283733913),
                ],
            ),
        ];
        for (kind, expected) in cases {
            let f = Fractal::new(7, 0.01, 5, 0.5, 2.0, kind);
            for (x, z, value) in expected {
                assert_eq!(
                    f.sample2(x, z).to_bits(),
                    f64::to_bits(value),
                    "{kind:?} drifted at ({x},{z}): {}",
                    f.sample2(x, z)
                );
            }
        }
    }

    #[test]
    fn octave_tables_differ() {
        // Reusing one permutation across octaves is the classic self-similarity
        // bug; prove octaves decorrelate.
        let f = Fractal::new(11, 1.0, 2, 1.0, 1.0, NoiseKind::Fbm);
        let a = f.octaves[0].sample2(0.5, 0.5);
        let b = f.octaves[1].sample2(0.5, 0.5);
        assert_ne!(a.to_bits(), b.to_bits());
    }
}
