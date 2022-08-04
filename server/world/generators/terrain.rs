use super::{
    noise::{NoiseParams, SeededSimplex},
    spline::SplineMap,
};

/// A seeded layered terrain for Voxelize world generation.
#[derive(Clone)]
pub struct SeededTerrain {
    noise: SeededSimplex,
    params: NoiseParams,
    layers: Vec<TerrainLayer>,
}

impl SeededTerrain {
    /// Create a new instance of the seeded terrain.
    pub fn new(seed: u32, params: &NoiseParams) -> Self {
        Self {
            noise: SeededSimplex::new(seed),
            params: params.to_owned(),
            layers: vec![],
        }
    }

    /// Add a terrain layer to the voxelize terrain.
    pub fn add_layer(&mut self, layer: &TerrainLayer) -> &mut Self {
        self.layers.push(layer.to_owned());
        self
    }

    /// Get the voxel density at a voxel coordinate, which does the following:
    /// 1. Calculate the height bias and height offset of each terrain layer.
    /// 2. Obtain the average height bias and height offset at this specific voxel column.
    /// 3. Get the noise value at this specific voxel coordinate, and add the average bias and height to it.
    pub fn get_density_at(&self, vx: i32, vy: i32, vz: i32) -> f64 {
        let (bias, offset) = self.get_bias_offset(vx, vz);
        self.noise.get3d(vx, vy, vz, &self.params) - bias * (vy as f64 - offset) / offset
    }

    /// Get the height bias and height offset values at a voxel column. What it does is that it samples the bias and offset
    /// of all noise layers and take the average of them all.
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

    /// Set the parameters of the terrain.
    pub fn set_params(&mut self, params: &NoiseParams) {
        self.params = params.to_owned();
    }
}

/// A layer to the terrain. Consists of two spline graphs: height bias and height offset graphs.
/// Height bias is how much terrain should be compressed as y-coordinate increases, and height offset is
/// by how much should the entire terrain shift up and down.
#[derive(Clone)]
pub struct TerrainLayer {
    pub params: NoiseParams,
    height_bias_spline: SplineMap,
    height_offset_spline: SplineMap,
}

impl TerrainLayer {
    /// Create a new terrain layer from a specific noise configuration. The noise params are used for this layer
    /// to be mapped to the height bias and height offset spline graphs.
    pub fn new(params: &NoiseParams) -> Self {
        TerrainLayer {
            params: params.to_owned(),
            height_bias_spline: SplineMap::default(),
            height_offset_spline: SplineMap::default(),
        }
    }

    /// Add a point to the bias spline graph.
    pub fn add_bias_point(mut self, point: [f64; 2]) -> Self {
        self.height_bias_spline.add(point[0], point[1]);
        self
    }

    /// Add a set of points to the bias spline graph.
    pub fn add_bias_points(mut self, points: Vec<[f64; 2]>) -> Self {
        points.into_iter().for_each(|point| {
            self.height_bias_spline.add(point[0], point[1]);
        });
        self
    }

    /// Add a point to the height offset spline graph.
    pub fn add_offset_point(mut self, point: [f64; 2]) -> Self {
        self.height_offset_spline.add(point[0], point[1]);
        self
    }

    /// Add a set of points to the height offset spline graph.
    pub fn add_offset_points(mut self, points: Vec<[f64; 2]>) -> Self {
        points.into_iter().for_each(|point| {
            self.height_offset_spline.add(point[0], point[1]);
        });
        self
    }

    /// Sample the bias at a certain x-value.
    pub fn sample_bias(&self, x: f64) -> f64 {
        self.height_bias_spline.sample(x)
    }

    /// Sample the offset at a certain x-value.
    pub fn sample_offset(&self, x: f64) -> f64 {
        self.height_offset_spline.sample(x)
    }
}
