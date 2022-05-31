use nanoid::nanoid;
use noise::Worley;
use specs::{
    Builder, Component, DispatcherBuilder, NullStorage, ReadExpect, ReadStorage, System, WorldExt,
    WriteStorage,
};
use voxelize::{
    CurrentChunkComp, ETypeComp, EntityFlag, HeadingComp, HeightMapStage, IDComp, MetadataComp,
    NoiseParams, PositionComp, RigidBody, RigidBodyComp, Stats, TargetComp, TerrainLayer, World,
    WorldConfig, AABB,
};

use crate::generator::{test::TestStage, tree::TreeTestStage, water::WaterStage};

#[derive(Default, Component)]
#[storage(NullStorage)]
struct BoxFlag;

struct UpdateBoxSystem;

impl<'a> System<'a> for UpdateBoxSystem {
    type SystemData = (
        ReadExpect<'a, Stats>,
        ReadStorage<'a, BoxFlag>,
        WriteStorage<'a, RigidBodyComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, flag, mut bodies) = data;

        for (body, _) in (&mut bodies, &flag).join() {
            if stats.tick % 500 == 0 {
                body.0.apply_impulse(0.0, 10.0, -2.0);
            }
        }
    }
}

fn get_dispatcher(
    builder: DispatcherBuilder<'static, 'static>,
) -> DispatcherBuilder<'static, 'static> {
    builder.with(UpdateBoxSystem, "update-box", &[])
}

pub fn setup_world() -> World {
    let config = WorldConfig::new()
        // .min_chunk([-1, -1])
        // .max_chunk([1, 1])
        .terrain(
            &NoiseParams::new()
                .frequency(0.008)
                .octaves(7)
                .persistence(0.8)
                .lacunarity(1.4)
                .build(),
        )
        .seed(1213123)
        .build();

    let mut world = World::new("world1", &config);

    world.ecs_mut().register::<BoxFlag>();

    world.set_dispatcher(get_dispatcher);

    {
        let mut pipeline = world.pipeline_mut();

        // pipeline.add_stage(FlatlandStage::new(10, 2, 2, 3));
        pipeline.add_stage(TestStage);
        pipeline.add_stage(HeightMapStage);
        pipeline.add_stage(WaterStage);
        pipeline.add_stage(TreeTestStage {
            noise: Worley::new(),
        });
    }

    {
        let mut terrain = world.terrain_mut();

        let continentalness = TerrainLayer::new(
            &NoiseParams::new()
                .frequency(0.001)
                .octaves(7)
                .persistence(0.8)
                .lacunarity(1.6)
                .build(),
        )
        .add_bias_points(vec![[-1.0, 3.6], [-0.5, 4.6], [0.4, 2.3], [1.0, 1.0]])
        .add_offset_points(vec![[-1.0, 60.0], [-0.3, 62.0], [1.2, 290.0]]);

        let erosion = TerrainLayer::new(
            &NoiseParams::new()
                .frequency(0.0008)
                .octaves(5)
                .persistence(0.8)
                .lacunarity(1.8)
                .build(),
        )
        .add_bias_points(vec![
            [-1.0, 1.6],
            [-0.4, 1.2],
            [0.0, 2.0],
            [0.2, 6.8],
            [1.0, 2.0],
        ])
        .add_offset_points(vec![
            [-1.3, 230.0],
            [-0.5, 113.0],
            [-0.3, 85.0],
            [0.0, 65.0],
            [0.3, 66.0],
            [0.4, 63.0],
            [0.7, 63.0],
            [1.0, 10.0],
        ]);

        let pv = TerrainLayer::new(
            &NoiseParams::new()
                .frequency(0.0015)
                .octaves(5)
                .persistence(1.2)
                .ridged(true)
                .build(),
        )
        .add_bias_points(vec![[-1.2, 0.4], [-0.4, 1.0], [0.9, 0.7], [1.3, 0.9]])
        .add_offset_points(vec![
            [-1.5, 166.0],
            [-0.3, 80.0],
            [0.5, 56.0],
            [0.9, 34.0],
            [1.2, 6.0],
        ]);

        terrain.add_layer(&continentalness);
        terrain.add_layer(&erosion);
        terrain.add_layer(&pv);
    }

    let test_body = RigidBody::new(&AABB::new(0.0, 0.0, 0.0, 0.5, 0.5, 0.5)).build();

    // world
    //     .ecs_mut()
    //     .create_entity()
    //     .with(EntityFlag::default())
    //     .with(ETypeComp::new("Box"))
    //     .with(IDComp::new(&nanoid!()))
    //     .with(PositionComp::new(3.0, 200.0, 3.0))
    //     .with(TargetComp::new(0.0, 0.0, 0.0))
    //     .with(HeadingComp::new(0.0, 0.0, 0.0))
    //     .with(MetadataComp::new())
    //     .with(RigidBodyComp::new(&test_body))
    //     .with(CurrentChunkComp::default())
    //     .with(BoxFlag)
    //     .build();

    world
}
