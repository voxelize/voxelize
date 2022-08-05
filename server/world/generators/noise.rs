use noise::{NoiseFn, OpenSimplex, Seedable};
use serde::Serialize;
use std::f64;

/// Seeded noise of Voxelize. Use this to get consistent results with seed!
#[derive(Clone)]
pub struct SeededNoise {
    /// Simplex noise.
    pub simplex: SeededSimplex,
}

impl SeededNoise {
    /// Create a new `SeededNoise` instance.
    pub fn new(seed: u32) -> Self {
        Self {
            simplex: SeededSimplex::new(seed),
        }
    }
}

/// Seeded simplex noise for Voxelize.
#[derive(Clone)]
pub struct SeededSimplex {
    /// Core noise instance.
    noise: OpenSimplex,
}

impl SeededSimplex {
    /// Create a new seeded simplex noise.
    pub fn new(seed: u32) -> Self {
        let noise = OpenSimplex::new().set_seed(seed);

        Self { noise }
    }

    /// Get the 2D multi-fractal value at voxel column with noise parameters.
    /// Noise values are attempted to be scaled to -1.0 to 1.0, but noise parameters may change that.
    pub fn get2d(&self, vx: i32, vz: i32, params: &NoiseParams) -> f64 {
        let &NoiseParams {
            octaves,
            frequency,
            lacunarity,
            persistence,
            attenuation,
            ridged,
        } = params;

        let mut vx = vx as f64 * frequency;
        let mut vz = vz as f64 * frequency;

        if octaves == 0 {
            return 0.0;
        }

        // First unscaled octave of function; later octaves are scaled.
        let mut result = if ridged {
            0.0
        } else {
            self.noise.get([vx, vz])
        };
        let mut weight = 1.0;

        for x in (if ridged { 0 } else { 1 })..octaves {
            if !ridged {
                vx *= lacunarity;
                vz *= lacunarity;
            }

            // Get noise value.
            let mut signal = self.noise.get([vx, vz]);

            // If needed, make the ridges.
            if ridged {
                // Make the ridges.
                signal = signal.abs();
                signal = 1.0 - signal;

                // Square the signal to increase the sharpness of the ridges.
                signal *= signal;

                // Apply the weighting from the previous octave to the signal.
                // Larger values have higher weights, producing sharp points along
                // the ridges.
                signal *= weight;

                // Weight successive contributions by the previous signal.
                weight = signal / attenuation;

                // Clamp the weight to [0,1] to prevent the result from diverging.
                weight = weight.clamp(0.0, 1.0);
            }

            // Scale the amplitude appropriately for this frequency.
            signal *= persistence.powi(x as i32);

            if !ridged {
                // Scale the signal by the current "altitude" of the function.
                signal *= result;
            }

            // Add signal to result.
            result += signal;

            if ridged {
                vx *= lacunarity;
                vz *= lacunarity;
            }
        }

        // Scale the result to the [-1, 1] range.
        if ridged {
            let scale = 2.0 - 0.5_f64.powi(octaves as i32 - 1);
            result.abs().mul_add(2.0 / scale, -1.0_f64)
        } else {
            result * 0.5
        }
    }

    /// Get the 3D multi-fractal value at voxel column with noise parameters.
    /// Noise values are attempted to be scaled to -1.0 to 1.0, but noise parameters may change that.
    pub fn get3d(&self, vx: i32, vy: i32, vz: i32, params: &NoiseParams) -> f64 {
        let &NoiseParams {
            octaves,
            frequency,
            lacunarity,
            persistence,
            attenuation,
            ridged,
        } = params;

        let mut vx = vx as f64 * frequency;
        let mut vy = vy as f64 * frequency;
        let mut vz = vz as f64 * frequency;

        if octaves == 0 {
            return 0.0;
        }

        // First unscaled octave of function; later octaves are scaled.
        let mut result = if ridged {
            0.0
        } else {
            self.noise.get([vx, vz])
        };
        let mut weight = 1.0;

        for x in (if ridged { 0 } else { 1 })..octaves {
            if !ridged {
                vx *= lacunarity;
                vy *= lacunarity;
                vz *= lacunarity;
            }

            // Get noise value.
            let mut signal = self.noise.get([vx, vy, vz]);

            // If needed, make the ridges.
            if ridged {
                // Make the ridges.
                signal = signal.abs();
                signal = 1.0 - signal;

                // Square the signal to increase the sharpness of the ridges.
                signal *= signal;

                // Apply the weighting from the previous octave to the signal.
                // Larger values have higher weights, producing sharp points along
                // the ridges.
                signal *= weight;

                // Weight successive contributions by the previous signal.
                weight = signal / attenuation;

                // Clamp the weight to [0,1] to prevent the result from diverging.
                weight = weight.clamp(0.0, 1.0);
            }

            // Scale the amplitude appropriately for this frequency.
            signal *= persistence.powi(x as i32);

            if !ridged {
                // Scale the signal by the current "altitude" of the function.
                signal *= result;
            }

            // Add signal to result.
            result += signal;

            if ridged {
                vx *= lacunarity;
                vy *= lacunarity;
                vz *= lacunarity;
            }
        }

        // Scale the result to the [-1, 1] range.
        if ridged {
            let scale = 2.0 - 0.5_f64.powi(octaves as i32 - 1);
            result.abs().mul_add(2.0 / scale, -1.0_f64)
        } else {
            result * 0.5
        }
    }
}

/// Multi-fractal noise parameters.
#[derive(Clone, Default, Serialize)]
pub struct NoiseParams {
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

const DEFAULT_FREQUENCY: f64 = f64::consts::PI * 2.0 / 3.0;
const DEFAULT_LACUNARITY: f64 = 1.0;
const DEFAULT_ATTENUATION: f64 = 2.0;
const DEFAULT_OCTAVES: usize = 6;
const DEFAULT_PERSISTENCE: f64 = 1.0;
const DEFAULT_RIDGED: bool = false;

impl NoiseParams {
    pub fn new() -> NoiseParamsBuilder {
        NoiseParamsBuilder {
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
    frequency: f64,
    octaves: usize,
    persistence: f64,
    lacunarity: f64,
    attenuation: f64,
    ridged: bool,
}

impl NoiseParamsBuilder {
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
            frequency: self.frequency,
            octaves: self.octaves,
            persistence: self.persistence,
            lacunarity: self.lacunarity,
            attenuation: self.attenuation,
            ridged: self.ridged,
        }
    }
}
