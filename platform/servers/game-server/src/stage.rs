//! Runs the platform world generator as an engine chunk stage.

use std::sync::Arc;

use platform_worldgen::{GeneratedChunk, Generator, Ocean, Paradise, Sky, Underworld, AIR};
use voxelize::{Chunk, ChunkStage, Resources, Space, VoxelAccess};

/// The generator of one dimension.
#[derive(Clone)]
pub enum Terrain {
    Overworld(Arc<Generator>),
    Underworld(Arc<Underworld>),
    Sky(Arc<Sky>),
    Paradise(Arc<Paradise>),
    Ocean(Arc<Ocean>),
}

impl Terrain {
    pub fn generate_chunk(&self, cx: i32, cz: i32, size: usize) -> GeneratedChunk {
        match self {
            Terrain::Overworld(g) => g.generate_chunk(cx, cz, size),
            Terrain::Underworld(u) => u.generate_chunk(cx, cz, size),
            Terrain::Sky(s) => s.generate_chunk(cx, cz, size),
            Terrain::Paradise(p) => p.generate_chunk(cx, cz, size),
            Terrain::Ocean(o) => o.generate_chunk(cx, cz, size),
        }
    }

    pub fn biome_at(&self, x: i32, z: i32) -> String {
        match self {
            Terrain::Overworld(g) => g.biome_at(x, z).to_owned(),
            Terrain::Underworld(u) => u.biome_at(x, z).to_owned(),
            Terrain::Sky(s) => s.biome_at(x, z).to_owned(),
            Terrain::Paradise(p) => p.biome_at(x, z).to_owned(),
            Terrain::Ocean(o) => o.biome_at(x, z).to_owned(),
        }
    }
}

pub struct WorldgenStage {
    generator: Terrain,
}

impl WorldgenStage {
    pub fn new(generator: Terrain) -> Self {
        Self { generator }
    }
}

impl ChunkStage for WorldgenStage {
    fn name(&self) -> String {
        "Platform worldgen".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let size = chunk.options.size;
        let generated = self
            .generator
            .generate_chunk(chunk.coords.0, chunk.coords.1, size);
        let height = generated.height.min(chunk.options.max_height);
        let (min_x, min_z) = (chunk.min.0, chunk.min.2);
        for x in 0..size {
            for z in 0..size {
                for y in 0..height {
                    // Raw: the generator's words may carry more than an id
                    // (a structure chest's loot stage, a waterlogged plant).
                    let raw = generated.get(x, y, z);
                    if raw != AIR {
                        chunk.set_raw_voxel(min_x + x as i32, y as i32, min_z + z as i32, raw);
                    }
                }
            }
        }
        chunk.biome_tints = generated.tints;
        chunk
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn generated_waterlogged_plants_are_waterlogged_for_the_engine() {
        let kelp = 101;
        let raw = kelp | platform_worldgen::WATERLOGGED;
        assert!(voxelize::BlockUtils::extract_waterlogged(raw));
        assert_eq!(voxelize::BlockUtils::extract_id(raw), kelp);
        assert_eq!(
            voxelize::BlockUtils::extract_waterlog_level(raw),
            0,
            "a full cell"
        );
    }
}
