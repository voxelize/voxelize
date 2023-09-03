use voxelize::{BlockAccess, Chunk, ChunkStage, Vec3};

pub struct TestStage;

impl ChunkStage for TestStage {
    fn name(&self) -> String {
        "Test Stage".to_string()
    }

    fn process(&self, mut chunk: Chunk) -> Chunk {
        let Vec3(x, y, z) = chunk.min;
        let chunk_size = chunk.options.chunk_size;

        println!("Going through test stage: {:?}", chunk.coords);

        for vx in x..x + chunk_size as i32 {
            for vz in z..z + chunk_size as i32 {
                chunk.set_block_id(vx, 0, vz, 1);
            }
        }

        chunk
    }
}
