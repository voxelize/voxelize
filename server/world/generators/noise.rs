use noise::{NoiseFn, Seedable, SuperSimplex};

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

    pub fn get(&self, query: &NoiseQuery) -> f64 {
        let &NoiseQuery {
            octaves,
            amplifier,
            scale,
            height_bias,
            height_offset,
            lacunarity,
            persistance,
            vx,
            vy,
            vz,
        } = query;

        let mut total = 0.0;
        let mut frequency = 1.0;
        let mut amplitude = 1.0;
        let mut max_val = 0.0;

        for _ in 0..octaves {
            total += self.noise.get([
                vx as f64 * frequency * scale,
                vy as f64 * frequency * scale,
                vz as f64 * frequency * scale,
            ]) * amplitude;

            max_val += amplitude;

            amplitude *= persistance;
            frequency *= lacunarity;
        }

        (total / max_val) * amplifier - height_bias * (vy as f64 - height_offset) * scale
    }
}

pub struct NoiseQuery {
    pub vx: i32,
    pub vy: i32,
    pub vz: i32,
    pub scale: f64,
    pub octaves: usize,
    pub persistance: f64,
    pub lacunarity: f64,
    pub amplifier: f64,
    pub height_bias: f64,
    pub height_offset: f64,
}

impl NoiseQuery {
    pub fn new() -> NoiseQueryBuilder {
        NoiseQueryBuilder::default()
    }

    pub fn voxel(&mut self, vx: i32, vy: i32, vz: i32) {
        self.vx = vx;
        self.vy = vy;
        self.vz = vz;
    }
}

#[derive(Default)]
pub struct NoiseQueryBuilder {
    vx: i32,
    vy: i32,
    vz: i32,
    scale: f64,
    octaves: usize,
    persistance: f64,
    lacunarity: f64,
    amplifier: f64,
    height_bias: f64,
    height_offset: f64,
}

impl NoiseQueryBuilder {
    pub fn scale(mut self, scale: f64) -> Self {
        self.scale = scale;
        self
    }

    pub fn octaves(mut self, octaves: usize) -> Self {
        self.octaves = octaves;
        self
    }

    pub fn persistance(mut self, persistance: f64) -> Self {
        self.persistance = persistance;
        self
    }

    pub fn lacunarity(mut self, lacunarity: f64) -> Self {
        self.lacunarity = lacunarity;
        self
    }

    pub fn amplifier(mut self, amplifier: f64) -> Self {
        self.amplifier = amplifier;
        self
    }

    pub fn height_bias(mut self, height_bias: f64) -> Self {
        self.height_bias = height_bias;
        self
    }

    pub fn height_offset(mut self, height_offset: f64) -> Self {
        self.height_offset = height_offset;
        self
    }

    pub fn build(self) -> NoiseQuery {
        NoiseQuery {
            vx: self.vx,
            vy: self.vy,
            vz: self.vz,
            scale: self.scale,
            octaves: self.octaves,
            persistance: self.persistance,
            lacunarity: self.lacunarity,
            amplifier: self.amplifier,
            height_bias: self.height_bias,
            height_offset: self.height_offset,
        }
    }
}
