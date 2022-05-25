use nanoid::nanoid;
use noise::Worley;
use specs::{
    Builder, Component, DispatcherBuilder, NullStorage, ReadExpect, ReadStorage, System, WorldExt,
    WriteStorage,
};
use voxelize::{
    pipeline::HeightMapStage,
    world::{
        components::{
            current_chunk::CurrentChunkComp, etype::ETypeComp, flags::EntityFlag,
            heading::HeadingComp, id::IDComp, metadata::MetadataComp, position::PositionComp,
            rigidbody::RigidBodyComp, target::TargetComp,
        },
        physics::{aabb::AABB, rigidbody::RigidBody},
        stats::Stats,
        World, WorldConfig,
    },
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
        // pipeline.add_stage(TreeTestStage {
        //     noise: Worley::new(),
        // });
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
