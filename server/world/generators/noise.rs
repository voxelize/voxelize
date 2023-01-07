use noise::{Fbm, HybridMulti, MultiFractal, NoiseFn, Perlin, RidgedMulti, Seedable};
use serde::Serialize;
use splines::interpolate::Interpolator;
use std::f64;

/// Seeded simplex noise for Voxelize.
#[derive(Clone, Debug)]
pub struct SeededNoise {
    /// Core noise instance.
    regular: HybridMulti<Perlin>,
    ridged: RidgedMulti<Perlin>,
    params: NoiseParams,
}

impl SeededNoise {
    /// Create a new seeded simplex noise.
    pub fn new(seed: u32, params: &NoiseParams) -> Self {
        let regular = HybridMulti::new(seed)
            .set_frequency(params.frequency)
            .set_lacunarity(params.lacunarity)
            .set_persistence(params.persistence)
            .set_octaves(params.octaves);
        let ridged = RidgedMulti::new(seed)
            .set_frequency(params.frequency)
            .set_lacunarity(params.lacunarity)
            .set_persistence(params.persistence)
            .set_attenuation(params.attenuation)
            .set_octaves(params.octaves);

        Self {
            regular,
            ridged,
            params: params.clone(),
        }
    }

    /// Get the 2D multi-fractal value at voxel column with noise parameters.
    /// Noise values are attempted to be scaled to -1.0 to 1.0, but noise parameters may change that.
    pub fn get2d(&self, vx: i32, vz: i32) -> f64 {
        if self.params.ridged {
            self.ridged.get([vx as f64, vz as f64])
        } else {
            self.regular.get([vx as f64, vz as f64])
        }
    }

    /// Get the 3D multi-fractal value at voxel column with noise parameters.
    /// Noise values are attempted to be scaled to -1.0 to 1.0, but noise parameters may change that.
    pub fn get3d(&self, vx: i32, vy: i32, vz: i32) -> f64 {
        if self.params.ridged {
            self.ridged.get([vx as f64, vy as f64, vz as f64])
        } else {
            self.regular.get([vx as f64, vy as f64, vz as f64])
        }
    }

    /// Set the noise of this seeded noise as a whole.
    pub fn set_seed(&mut self, seed: u32) -> &mut Self {
        self.regular = self.regular.clone().set_seed(seed + self.params.seed);
        self.ridged = self.ridged.clone().set_seed(seed + self.params.seed);
        self
    }
}

/// Multi-fractal noise parameters.
#[derive(Clone, Default, Serialize, Debug)]
pub struct NoiseParams {
    pub seed: u32,

    /// How frequently should noise be sampled. The bigger the value, the more condensed noise
    /// seems. Defaults to PI * 2.0 / 3.0.
    pub frequency: f64,

    /// How many times should noise be sampled at each query. Defaults to 6.
    pub octaves: usize,

    /// By how much should successive noise samples contribute to the previous octave. Defaults to 1.0.
    pub persistence: f64,

    /// By how far apart should each successive noise sample be sampled at. Defaults to 1.0.
    pub lacunarity: f64,

    /// How much should each noise value contribute for RIDGED NOISE!!! `params.ridged` needs to be `true`
    /// for this to be used. Defaults to 2.0.
    pub attenuation: f64,

    /// Whether should the noise query be ridged. Defaults to false.
    pub ridged: bool,
}

const DEFAULT_SEED: u32 = 0;
const DEFAULT_FREQUENCY: f64 = f64::consts::PI * 2.0 / 3.0;
const DEFAULT_LACUNARITY: f64 = 1.0;
const DEFAULT_ATTENUATION: f64 = 2.0;
const DEFAULT_OCTAVES: usize = 6;
const DEFAULT_PERSISTENCE: f64 = 1.0;
const DEFAULT_RIDGED: bool = false;

impl NoiseParams {
    pub fn new() -> NoiseParamsBuilder {
        NoiseParamsBuilder {
            seed: DEFAULT_SEED,
            frequency: DEFAULT_FREQUENCY,
            lacunarity: DEFAULT_LACUNARITY,
            attenuation: DEFAULT_ATTENUATION,
            octaves: DEFAULT_OCTAVES,
            persistence: DEFAULT_PERSISTENCE,
            ridged: DEFAULT_RIDGED,
        }
    }
}

/// Idiomatic builder pattern for `NoiseParams`.
#[derive(Default)]
pub struct NoiseParamsBuilder {
    seed: u32,
    frequency: f64,
    octaves: usize,
    persistence: f64,
    lacunarity: f64,
    attenuation: f64,
    ridged: bool,
}

impl NoiseParamsBuilder {
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

    /// Build a noise parameter instance.
    pub fn build(self) -> NoiseParams {
        NoiseParams {
            seed: self.seed,
            frequency: self.frequency,
            octaves: self.octaves,
            persistence: self.persistence,
            lacunarity: self.lacunarity,
            attenuation: self.attenuation,
            ridged: self.ridged,
        }
    }
}
