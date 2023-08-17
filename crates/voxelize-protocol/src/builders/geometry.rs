use crate::GeometryData;

#[derive(Default)]
pub struct GeometryDataBuilder {
    pub block_id: u32,
    pub face_name: Option<String>,
    pub positions: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<i32>,
    pub lights: Vec<i32>,
}

impl GeometryDataBuilder {
    pub fn block_id(mut self, block_id: u32) -> Self {
        self.block_id = block_id;
        self
    }

    pub fn face_name(mut self, face_name: &str) -> Self {
        // ! Face names are lower-cased
        self.face_name = Some(face_name.to_lowercase());
        self
    }

    pub fn positions(mut self, positions: Vec<f32>) -> Self {
        self.positions = positions;
        self
    }

    pub fn uvs(mut self, uvs: Vec<f32>) -> Self {
        self.uvs = uvs;
        self
    }

    pub fn indices(mut self, indices: Vec<i32>) -> Self {
        self.indices = indices;
        self
    }

    pub fn lights(mut self, lights: Vec<i32>) -> Self {
        self.lights = lights;
        self
    }

    pub fn build(self) -> GeometryData {
        GeometryData {
            block_id: self.block_id,
            face_name: self.face_name,
            positions: self.positions,
            uvs: self.uvs,
            indices: self.indices,
            lights: self.lights,
        }
    }
}
