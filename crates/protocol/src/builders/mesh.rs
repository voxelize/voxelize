use crate::{Geometry, Mesh};

#[derive(Default)]
pub struct MeshBuilder {
    pub level: i32,
    pub geometries: Vec<Geometry>,
}

impl MeshBuilder {
    pub fn level(mut self, level: i32) -> Self {
        self.level = level;
        self
    }

    pub fn geometries(mut self, geometries: Vec<Geometry>) -> Self {
        self.geometries = geometries;
        self
    }

    pub fn build(self) -> Mesh {
        Mesh {
            level: self.level,
            geometries: self.geometries,
        }
    }
}
