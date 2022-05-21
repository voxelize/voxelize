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

    pub fn get2d(&self, vx: i32, vz: i32, params: &NoiseParams) -> f64 {
        let &NoiseParams {
            octaves,
            scale,
            lacunarity,
            persistance,
            normalize,
        } = params;

        let mut total = 0.0;
        let mut frequency = 1.0;
        let mut amplitude = 1.0;
        let mut max_val = 0.0;

        for _ in 0..octaves {
            total += self
                .noise
                .get([vx as f64 * frequency * scale, vz as f64 * frequency * scale])
                * amplitude;

            max_val += amplitude;

            amplitude *= persistance;
            frequency *= lacunarity;
        }

        (total / max_val) / if normalize { 2.0_f64.sqrt() / 2.0 } else { 1.0 }
    }

    pub fn get3d(
        &self,
        vx: i32,
        vy: i32,
        vz: i32,
        params: &NoiseParams,
        height_bias: f64,
        height_offset: f64,
    ) -> f64 {
        let &NoiseParams {
            octaves,
            scale,
            lacunarity,
            persistance,
            normalize,
        } = params;

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

        (total / max_val) / if normalize { 3.0_f64.sqrt() / 2.0 } else { 1.0 }
            - (height_bias * vy as f64 - height_offset) / height_offset
    }
}

#[derive(Clone)]
pub struct NoiseParams {
    pub scale: f64,
    pub octaves: usize,
    pub persistance: f64,
    pub lacunarity: f64,
    pub normalize: bool,
}

impl NoiseParams {
    pub fn new() -> NoiseParamsBuilder {
        NoiseParamsBuilder::default()
    }
}

#[derive(Default)]
pub struct NoiseParamsBuilder {
    scale: f64,
    octaves: usize,
    persistance: f64,
    lacunarity: f64,
    normalize: bool,
}

impl NoiseParamsBuilder {
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

    pub fn normalize(mut self, normalize: bool) -> Self {
        self.normalize = normalize;
        self
    }

    pub fn build(self) -> NoiseParams {
        NoiseParams {
            scale: self.scale,
            octaves: self.octaves,
            persistance: self.persistance,
            lacunarity: self.lacunarity,
            normalize: self.normalize,
        }
    }
}
