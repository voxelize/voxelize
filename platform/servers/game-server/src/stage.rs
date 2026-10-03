//! Runs the platform world generator as an engine chunk stage.

use platform_worldgen::{Generator, AIR};
use voxelize::{Chunk, ChunkStage, Resources, Space, VoxelAccess};

pub struct WorldgenStage {
    generator: Generator,
}

impl WorldgenStage {
    pub fn new(generator: Generator) -> Self {
        Self { generator }
    }
}

impl ChunkStage for WorldgenStage {
    fn name(&self) -> String {
        "Platform worldgen".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let size = chunk.options.size;
        let generated = self.generator.generate_chunk(chunk.coords.0, chunk.coords.1, size);
        let height = generated.height.min(chunk.options.max_height);
        let (min_x, min_z) = (chunk.min.0, chunk.min.2);
        for x in 0..size {
            for z in 0..size {
                for y in 0..height {
                    let id = generated.get(x, y, z);
                    if id != AIR {
                        chunk.set_voxel(min_x + x as i32, y as i32, min_z + z as i32, id);
                    }
                }
            }
        }
        chunk
    }
}
