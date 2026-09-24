use noise::{Fbm, HybridMulti, MultiFractal, NoiseFn, Perlin, RidgedMulti};
use serde::Serialize;
use splines::interpolate::Interpolator;
use std::f64;

/// Seeded simplex noise for Voxelize.
#[derive(Clone, Debug)]
pub struct SeededNoise {
    /// Core noise instance.
    regular: HybridMulti<Perlin>,
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
        let regular = regular.set_sources(octave_sources(seed, regular_octaves));
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

    /// Set the noise of this seeded noise as a whole.
    pub fn set_seed(&mut self, seed: u32) -> &mut Self {
        let seed = seed.wrapping_add(self.options.seed);
        let regular_octaves = self.regular.octaves;
        let ridged_octaves = self.ridged.octaves;
        self.regular = self
            .regular
            .clone()
            .set_sources(octave_sources(seed, regular_octaves));
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
