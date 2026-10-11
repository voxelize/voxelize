use noise::{Fbm, HybridMulti, MultiFractal, NoiseFn, Perlin, RidgedMulti};
use serde::Serialize;
use splines::interpolate::Interpolator;
use std::f64;

/// Seeded simplex noise for Voxelize.
#[derive(Clone, Debug)]
pub struct SeededNoise {
    /// Core noise instance.
    regular: HybridMulti<Perlin>,
    /// The regular noise's octave sources, which `get3d_over` reads one at a
    /// time, and its scale and the most its octaves past the first add.
    octaves: Vec<Perlin>,
    scale: f64,
    headroom: f64,
    ridged: RidgedMulti<Perlin>,
    options: NoiseOptions,
}

impl SeededNoise {
    /// Create a new seeded simplex noise.
    pub fn new(seed: u32, options: &NoiseOptions) -> Self {
        // Built at the default seed and then given octave sources seeded here:
        // `new(seed)` and `set_octaves` would seed them inside `noise`.
        let regular = HybridMulti::<Perlin>::default()
            .set_frequency(options.frequency)
            .set_lacunarity(options.lacunarity)
            .set_persistence(options.persistence)
            .set_octaves(options.octaves);
        let regular_octaves = regular.octaves;
        let octaves = octave_sources(seed, regular_octaves);
        let regular = regular.set_sources(octaves.clone());
        let persistence = regular.persistence;
        let ridged = RidgedMulti::<Perlin>::default()
            .set_frequency(options.frequency)
            .set_lacunarity(options.lacunarity)
            .set_persistence(options.persistence)
            .set_attenuation(options.attenuation)
            .set_octaves(options.octaves);
        let ridged_octaves = ridged.octaves;
        let ridged = ridged.set_sources(octave_sources(seed, ridged_octaves));

        Self {
            regular,
            octaves,
            scale: hybrid_scale_factor(persistence, regular_octaves),
            headroom: (1..regular_octaves)
                .map(|octave| persistence.powi(octave as i32))
                .sum(),
            ridged,
            options: options.clone(),
        }
    }

    /// Get the 2D multi-fractal value at voxel column with noise options.
    /// Noise values are attempted to be scaled to -1.0 to 1.0, but noise options may change that.
    pub fn get2d(&self, vx: i32, vz: i32) -> f64 {
        self.get2d_at(vx as f64, vz as f64)
    }

    /// Sample at continuous world coordinates, for example after a domain warp.
    /// Keep the fractional position until the final voxel decision; rounding a
    /// warped coordinate first introduces steps into an otherwise smooth field.
    pub fn get2d_at(&self, x: f64, z: f64) -> f64 {
        if self.options.ridged {
            self.ridged.get([x, z])
        } else {
            self.regular.get([x, z])
        }
    }

    /// Get the 3D multi-fractal value at voxel column with noise options.
    /// Noise values are attempted to be scaled to -1.0 to 1.0, but noise options may change that.
    pub fn get3d(&self, vx: i32, vy: i32, vz: i32) -> f64 {
        if self.options.ridged {
            self.ridged.get([vx as f64, vy as f64, vz as f64])
        } else {
            self.regular.get([vx as f64, vy as f64, vz as f64])
        }
    }

    /// [`get3d`](Self::get3d), unless the value cannot be over `bound`.
    ///
    /// The regular noise at a persistence in `0..=1` sums its octaves, each
    /// adding at most its amplitude: Perlin is clamped to ±1, and the hybrid
    /// weight is one at every octave. So its octaves are read in turn, and the
    /// sample is turned away once those read, every one left at its most,
    /// stay under `bound`: a sample far under it reads a few octaves, not all.
    /// Any other noise reads its whole value.
    pub fn get3d_over(&self, vx: i32, vy: i32, vz: i32, bound: f64) -> Option<f64> {
        let regular = &self.regular;
        let persistence = regular.persistence;
        if self.options.ridged || !(0.0..=1.0).contains(&persistence) {
            let value = self.get3d(vx, vy, vz);
            return (value > bound).then_some(value);
        }
        // Float error in the sums read so far stays well inside this.
        let under = bound - 1e-9;
        let mut point = [vx as f64, vy as f64, vz as f64].map(|axis| axis * regular.frequency);
        let mut sum = self.octaves[0].get(point) * persistence;
        let mut left = self.headroom;
        let mut attenuation = persistence;
        for source in &self.octaves[1..] {
            if (sum + left.max(0.0)) * self.scale < under {
                return None;
            }
            point = point.map(|axis| axis * regular.lacunarity);
            sum += source.get(point) * attenuation;
            left -= attenuation;
            attenuation *= persistence;
        }
        if sum * self.scale < under {
            return None;
        }
        Some(self.get3d(vx, vy, vz))
    }

    /// Set the noise of this seeded noise as a whole.
    pub fn set_seed(&mut self, seed: u32) -> &mut Self {
        let seed = seed.wrapping_add(self.options.seed);
        let regular_octaves = self.regular.octaves;
        let ridged_octaves = self.ridged.octaves;
        self.octaves = octave_sources(seed, regular_octaves);
        self.regular = self.regular.clone().set_sources(self.octaves.clone());
        self.ridged = self
            .ridged
            .clone()
            .set_sources(octave_sources(seed, ridged_octaves));
        self
    }
}

/// One Perlin source per octave, seeded `seed`, `seed + 1`, ... with wrapping
/// arithmetic. `noise` seeds its octaves with a plain `+`, which wraps in
/// release but panics in overflow-checked builds for any seed within `octaves`
/// of `u32::MAX`; seeding them here gives every build release's sequence.
fn octave_sources(seed: u32, octaves: usize) -> Vec<Perlin> {
    (0..octaves)
        .map(|octave| Perlin::new(seed.wrapping_add(octave as u32)))
        .collect()
}

/// The factor `HybridMulti` scales its sum by, as `noise` 0.9 sets it from
/// the persistence and octaves it is built with.
fn hybrid_scale_factor(persistence: f64, octaves: usize) -> f64 {
    let mut amplitude = persistence;
    let mut result = persistence + amplitude;
    if octaves >= 1 {
        result += (1..=octaves).fold(0.0, |acc, _| {
            amplitude *= persistence;
            acc + amplitude
        });
    }
    2.0 / result
}

#[cfg(test)]
mod sampling_tests {
    use super::*;

    #[test]
    fn continuous_sampling_preserves_integer_noise_exactly() {
        for ridged in [false, true] {
            let options = NoiseOptions::new().frequency(0.017).lacunarity(2.1)
                .octaves(3).persistence(0.45).ridged(ridged).build();
            for seed in [0, 76129, u32::MAX] {
                let noise = SeededNoise::new(seed, &options);
                for (x, z) in [(0, 0), (-1, 16), (608, -352), (-1000000, 1000000)] {
                    let point = [x as f64, z as f64];
                    let original = if ridged { noise.ridged.get(point) } else { noise.regular.get(point) };
                    assert_eq!(noise.get2d(x, z).to_bits(), original.to_bits());
                    assert_eq!(noise.get2d_at(point[0], point[1]).to_bits(), original.to_bits());
                }
            }
        }
    }

    /// `get3d_over` reads `get3d`'s own value, or turns away only a sample
    /// not over the bound, at bounds round the samples' own values too; and
    /// under a high bound it turns nearly every sample away.
    #[test]
    fn get3d_over_reads_the_value_or_turns_away_only_what_is_not_over() {
        for (persistence, octaves, lacunarity, ridged) in [
            (1.0, 6, 2.9, false),
            (0.45, 3, 2.1, false),
            (0.0, 4, 2.0, false),
            (1.0, 1, 2.0, false),
            (1.3, 5, 2.0, false),
            (1.0, 6, 2.9, true),
        ] {
            let options = NoiseOptions::new()
                .frequency(0.13)
                .lacunarity(lacunarity)
                .octaves(octaves)
                .persistence(persistence)
                .ridged(ridged)
                .build();
            for seed in [0, 31004, u32::MAX] {
                let mut noise = SeededNoise::new(seed, &options);
                for reseed in [false, true] {
                    if reseed {
                        noise.set_seed(seed ^ 0x5eed);
                    }
                    for x in -40..40 {
                        for (y, z) in [(-7, 13), (64, -900), (200, 5)] {
                            let value = noise.get3d(x, y, z);
                            for bound in [-0.5, 0.0, 0.3, 0.56, 0.74, 1.2, value, value - 1e-12] {
                                match noise.get3d_over(x, y, z, bound) {
                                    Some(read) => assert_eq!(read.to_bits(), value.to_bits()),
                                    None => assert!(
                                        value <= bound,
                                        "({x}, {y}, {z}) is {value}, over {bound}, but was turned away"
                                    ),
                                }
                            }
                        }
                    }
                }
            }
        }
        let noise = SeededNoise::new(
            31003,
            &NoiseOptions::new().frequency(0.18).lacunarity(2.9).build(),
        );
        let turned = (-200..200)
            .filter(|&x| noise.get3d_over(x, 66, -x, 0.56).is_none())
            .count();
        assert!(
            turned > 380,
            "only {turned} of 400 samples under 0.56 turned away"
        );
    }

    #[test]
    fn fractional_sampling_is_continuous_across_rounding_boundaries() {
        for ridged in [false, true] {
            let noise = SeededNoise::new(76129, &NoiseOptions::new()
                .frequency(0.017).lacunarity(2.1).octaves(3)
                .persistence(0.45).ridged(ridged).build());
            let mut varied = false;
            for x in -64..64 {
                let boundary = x as f64 + 0.5;
                let a = noise.get2d_at(boundary - 1e-5, 31.125);
                let b = noise.get2d_at(boundary + 1e-5, 31.125);
                assert!((a-b).abs() < 1e-4);
                varied |= a != b;
            }
            assert!(varied, "fractional coordinates must not collapse to one voxel");
        }
    }
}

/// Multi-fractal noise options.
#[derive(Clone, Default, Serialize, Debug)]
pub struct NoiseOptions {
    pub seed: u32,

    pub dimension: usize,

    /// How frequently should noise be sampled. The bigger the value, the more condensed noise
    /// seems. Defaults to PI * 2.0 / 3.0.
    pub frequency: f64,

    /// How many times should noise be sampled at each query. Defaults to 6.
    pub octaves: usize,

    /// By how much should successive noise samples contribute to the previous octave. Defaults to 1.0.
    pub persistence: f64,

    /// By how far apart should each successive noise sample be sampled at. Defaults to 1.0.
    pub lacunarity: f64,

    /// How much should each noise value contribute for RIDGED NOISE!!! `options.ridged` needs to be `true`
    /// for this to be used. Defaults to 2.0.
    pub attenuation: f64,

    /// Whether should the noise query be ridged. Defaults to false.
    pub ridged: bool,
}

const DEFAULT_SEED: u32 = 0;
const DEFAULT_DIMENSION: usize = 2;
const DEFAULT_FREQUENCY: f64 = f64::consts::PI * 2.0 / 3.0;
const DEFAULT_LACUNARITY: f64 = 1.0;
const DEFAULT_ATTENUATION: f64 = 2.0;
const DEFAULT_OCTAVES: usize = 6;
const DEFAULT_PERSISTENCE: f64 = 1.0;
const DEFAULT_RIDGED: bool = false;

impl NoiseOptions {
    pub fn new() -> NoiseOptionsBuilder {
        NoiseOptionsBuilder {
            seed: DEFAULT_SEED,
            dimension: DEFAULT_DIMENSION,
            frequency: DEFAULT_FREQUENCY,
            lacunarity: DEFAULT_LACUNARITY,
            attenuation: DEFAULT_ATTENUATION,
            octaves: DEFAULT_OCTAVES,
            persistence: DEFAULT_PERSISTENCE,
            ridged: DEFAULT_RIDGED,
        }
    }
}

/// Idiomatic builder pattern for `NoiseOptions`.
#[derive(Default)]
pub struct NoiseOptionsBuilder {
    seed: u32,
    dimension: usize,
    frequency: f64,
    octaves: usize,
    persistence: f64,
    lacunarity: f64,
    attenuation: f64,
    ridged: bool,
}

impl NoiseOptionsBuilder {
    /// Configure the seed of the noise parameter. Defaults to 0.
    pub fn seed(mut self, seed: u32) -> Self {
        self.seed = seed;
        self
    }

    /// Configure the frequency of the noise parameter. Defaults to PI * 2.0 / 3.0.
    pub fn frequency(mut self, frequency: f64) -> Self {
        self.frequency = frequency;
        self
    }

    /// Configure the number of octaves of the noise parameter. Defaults to 6.
    pub fn octaves(mut self, octaves: usize) -> Self {
        self.octaves = octaves;
        self
    }

    /// Configure the persistence of the noise parameter. Defaults to 1.0.
    pub fn persistence(mut self, persistence: f64) -> Self {
        self.persistence = persistence;
        self
    }

    /// Configure the lacunarity of the noise parameter. Defaults to 1.0.
    pub fn lacunarity(mut self, lacunarity: f64) -> Self {
        self.lacunarity = lacunarity;
        self
    }

    /// Configure the attenuation of the noise parameter. Defaults to 2.0.
    pub fn attenuation(mut self, attenuation: f64) -> Self {
        self.attenuation = attenuation;
        self
    }

    /// Configure whether this parameter should be ridged. Defaults to false.
    pub fn ridged(mut self, ridged: bool) -> Self {
        self.ridged = ridged;
        self
    }

    pub fn dimension(mut self, dimension: usize) -> Self {
        self.dimension = dimension;
        self
    }

    /// Build a noise parameter instance.
    pub fn build(self) -> NoiseOptions {
        NoiseOptions {
            seed: self.seed,
            dimension: self.dimension,
            frequency: self.frequency,
            octaves: self.octaves,
            persistence: self.persistence,
            lacunarity: self.lacunarity,
            attenuation: self.attenuation,
            ridged: self.ridged,
        }
    }
}
