use voxelize::{ChunkStage, Vec3, VoxelAccess, World, WorldConfig};

pub struct Height128Stage;

impl ChunkStage for Height128Stage {
    fn name(&self) -> String {
        "Height128".to_string()
    }

    fn process(
        &self,
        mut chunk: voxelize::Chunk,
        resources: voxelize::Resources,
        space: Option<voxelize::Space>,
    ) -> voxelize::Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                chunk.set_voxel(vx, 128, vz, 60);
            }
        }

        chunk
    }
}

pub fn setup_world() -> World {
    let config = WorldConfig::new()
        .min_chunk([-20, 0])
        .max_chunk([20, 0])
        .seed(1213123)
        .max_response_per_tick(1)
        .build();

    let mut world = World::new("world1", &config);

    {
        let mut pipeline = world.pipeline_mut();
        pipeline.add_stage(Height128Stage);
    }

    world
}
