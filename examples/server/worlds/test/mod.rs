use voxelize::{FlatlandStage, World, WorldConfig};

pub fn setup_test_world() -> World {
    let config = WorldConfig::new()
        .saving(true)
        .save_dir("data/worlds/test")
        .build();

    let mut world = World::new("test", &config);

    {
        let mut pipeline = world.pipeline_mut();
        pipeline.add_stage(FlatlandStage::new().add_soiling(2, 10));
    }

    world
}
