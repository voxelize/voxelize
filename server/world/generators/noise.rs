use noise::{NoiseFn, Seedable, SuperSimplex};
use std::f64;

#[derive(Clone)]
pub struct SeededNoise {
    pub simplex: SeededSimplex,
}

impl SeededNoise {
    pub fn new(seed: u32) -> Self {
        Self {
            simplex: SeededSimplex::new(seed),
        }
    }
}

#[derive(Clone)]
pub struct SeededSimplex {
    noise: SuperSimplex,
}

impl SeededSimplex {
    pub fn new(seed: u32) -> Self {
        let noise = SuperSimplex::new().set_seed(seed);

        Self { noise }
    }

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

#[derive(Clone, Default)]
pub struct NoiseParams {
    pub frequency: f64,
    pub octaves: usize,
    pub persistence: f64,
    pub lacunarity: f64,
    pub attenuation: f64,
    pub ridged: bool,
}

const DEFAULT_FREQUENCY: f64 = f64::consts::PI * 2.0 / 3.0;

impl NoiseParams {
    pub fn new() -> NoiseParamsBuilder {
        NoiseParamsBuilder {
            frequency: DEFAULT_FREQUENCY,
            lacunarity: 1.0,
            attenuation: 2.0,
            octaves: 6,
            persistence: 1.0,
            ridged: false,
        }
    }
}

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
    pub fn frequency(mut self, frequency: f64) -> Self {
        self.frequency = frequency;
        self
    }

    pub fn octaves(mut self, octaves: usize) -> Self {
        self.octaves = octaves;
        self
    }

    pub fn persistence(mut self, persistence: f64) -> Self {
        self.persistence = persistence;
        self
    }

    pub fn lacunarity(mut self, lacunarity: f64) -> Self {
        self.lacunarity = lacunarity;
        self
    }

    pub fn attenuation(mut self, attenuation: f64) -> Self {
        self.attenuation = attenuation;
        self
    }

    pub fn ridged(mut self, ridged: bool) -> Self {
        self.ridged = ridged;
        self
    }

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
