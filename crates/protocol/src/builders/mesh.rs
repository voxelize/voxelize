use crate::{GeometryData, MeshData};

#[derive(Default)]
pub struct MeshDataBuilder {
    pub level: i32,
    pub geometries: Vec<GeometryData>,
}

impl MeshDataBuilder {
    pub fn level(mut self, level: i32) -> Self {
        self.level = level;
        self
    }

    pub fn geometries(mut self, geometries: Vec<GeometryData>) -> Self {
        self.geometries = geometries;
        self
    }

    pub fn build(self) -> MeshData {
        MeshData {
            level: self.level,
            geometries: self.geometries,
        }
    }
}
