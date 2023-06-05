use prost_wkt_types::Struct;
use serde::Serialize;

use crate::{utils::serialize_into_struct, ChunkData, MeshData};

#[derive(Default)]
pub struct ChunkDataBuilder {
    pub x: i32,
    pub z: i32,
    pub id: String,
    pub meshes: Vec<MeshData>,
    pub blocks: Vec<u32>,
    pub lights: Vec<u32>,
    pub metainfo: Option<Struct>,
}

impl ChunkDataBuilder {
    pub fn x(mut self, x: i32) -> Self {
        self.x = x;
        self
    }

    pub fn z(mut self, z: i32) -> Self {
        self.z = z;
        self
    }

    pub fn id(mut self, id: &str) -> Self {
        self.id = id.to_owned();
        self
    }

    pub fn meshes(mut self, meshes: Vec<MeshData>) -> Self {
        self.meshes = meshes;
        self
    }

    pub fn blocks(mut self, blocks: Vec<u32>) -> Self {
        self.blocks = blocks;
        self
    }

    pub fn lights(mut self, lights: Vec<u32>) -> Self {
        self.lights = lights;
        self
    }

    pub fn metainfo<T: Serialize>(mut self, metainfo: T) -> Self {
        self.metainfo = Some(serialize_into_struct(metainfo));
        self
    }

    pub fn build(self) -> ChunkData {
        ChunkData {
            x: self.x,
            z: self.z,
            id: self.id,
            meshes: self.meshes,
            blocks: self.blocks,
            lights: self.lights,
            metainfo: self.metainfo,
        }
    }
}
