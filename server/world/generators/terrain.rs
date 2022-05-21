use super::{
    noise::{NoiseParams, SeededSimplex},
    spline::SplineMap,
};

pub struct SeededTerrain {
    noise: SeededSimplex,
    params: NoiseParams,
    layers: Vec<TerrainLayer>,
}

impl SeededTerrain {
    pub fn new(seed: u32, params: &NoiseParams) -> Self {
        Self {
            noise: SeededSimplex::new(seed),
            params: params.to_owned(),
            layers: vec![],
        }
    }

    pub fn add_layer(&mut self, layer: &TerrainLayer) -> &mut Self {
        // if !self.layers.is_empty() {
        //     let prev_layer = self.layers.last_mut().unwrap();
        //     prev_layer.height_bias_spline.rescale_values(-1.0, 1.0);
        //     prev_layer.height_offset_spline.rescale_values(-1.0, 1.0);
        // }
        self.layers.push(layer.to_owned());
        self
    }

    pub fn density_at(&self, vx: i32, vy: i32, vz: i32) -> f64 {
        let (bias, offset) = self.get_bias_offset(vx, vz);
        self.noise.get3d(vx, vy, vz, &self.params) - bias * (vy as f64 - offset) / offset
    }

    pub fn get_bias_offset(&self, vx: i32, vz: i32) -> (f64, f64) {
        let mut bias = 0.0;
        let mut offset = 0.0;

        self.layers.iter().for_each(|layer| {
            let value = self.noise.get2d(vx, vz, &layer.params);
            bias += layer.sample_bias(value);
            offset += layer.sample_offset(value);
        });

        bias /= self.layers.len() as f64;
        offset /= self.layers.len() as f64;

        (bias, offset)
    }
}

#[derive(Clone)]
pub struct TerrainLayer {
    pub params: NoiseParams,
    height_bias_spline: SplineMap,
    height_offset_spline: SplineMap,
}

impl TerrainLayer {
    pub fn new(params: &NoiseParams) -> Self {
        TerrainLayer {
            params: params.to_owned(),
            height_bias_spline: SplineMap::new(),
            height_offset_spline: SplineMap::new(),
        }
    }

    pub fn add_bias_point(mut self, point: [f64; 2]) -> Self {
        self.height_bias_spline.add(point);
        self
    }

    pub fn add_bias_points(mut self, points: Vec<[f64; 2]>) -> Self {
        points.into_iter().for_each(|point| {
            self.height_bias_spline.add(point);
        });
        self
    }

    pub fn add_offset_point(mut self, point: [f64; 2]) -> Self {
        self.height_offset_spline.add(point);
        self
    }

    pub fn add_offset_points(mut self, points: Vec<[f64; 2]>) -> Self {
        points.into_iter().for_each(|point| {
            self.height_offset_spline.add(point);
        });
        self
    }

    pub fn sample_bias(&self, x: f64) -> f64 {
        self.height_bias_spline.sample(x)
    }

    pub fn sample_offset(&self, x: f64) -> f64 {
        self.height_offset_spline.sample(x)
    }
}
