use std::process;

use nanoid::nanoid;
use registry::setup_registry;
use specs::{
    Builder, Component, DispatcherBuilder, NullStorage, ReadExpect, ReadStorage, System, WorldExt,
    WriteStorage,
};
use voxelize::{
    CurrentChunkComp, ETypeComp, EntityFlag, FlatlandStage, HeadingComp, IDComp, InteractorComp,
    MetadataComp, PositionComp, RigidBody, RigidBodyComp, Server, Stats, TargetComp, Voxelize,
    WorldConfig, AABB,
};
use world::setup_world;

mod generator;
mod registry;
mod world;

fn handle_ctrlc() {
    ctrlc::set_handler(move || {
        print!("\nStopping application...\n");
        process::exit(0);
    })
    .expect("Error setting Ctrl-C handler");
}

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
            // body.0.apply_impulse(0.0, 0.0, -0.01);
        }
    }
}

fn get_dispatcher(
    builder: DispatcherBuilder<'static, 'static>,
) -> DispatcherBuilder<'static, 'static> {
    builder.with(UpdateBoxSystem, "update-box", &[])
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    handle_ctrlc();

    let mut server = Server::new()
        .port(4000)
        .serve("./examples/client/build")
        .registry(&setup_registry())
        .build();

    server
        .add_world(setup_world())
        .expect("Could not create world1.");

    let config2 = WorldConfig::new()
        .min_chunk([-1, -1])
        .max_chunk([1, 1])
        .build();
    let world2 = server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    {
        let mut pipeline = world2.pipeline_mut();
        pipeline.add_stage(FlatlandStage::new(10, 1, 2, 3));
    }

    let world3 = server
        .create_world("world3", &WorldConfig::new().build())
        .expect("Could not create world2.");

    {
        let mut pipeline = world3.pipeline_mut();
        pipeline.add_stage(FlatlandStage::new(70, 2, 1, 3));
    }

    let test_body = RigidBody::new(&AABB::new(0.0, 0.0, 0.0, 0.5, 0.5, 0.5)).build();

    world3.ecs_mut().register::<BoxFlag>();
    world3.set_dispatcher(get_dispatcher);

    let (body_handle1, collider_handle1) = world3.physics_mut().register(&test_body);
    let (body_handle2, collider_handle2) = world3.physics_mut().register(&test_body);

    world3
        .ecs_mut()
        .create_entity()
        .with(EntityFlag::default())
        .with(ETypeComp::new("Box"))
        .with(IDComp::new(&nanoid!()))
        .with(PositionComp::new(1.0, 80.0, 0.0))
        .with(TargetComp::new(0.0, 0.0, 0.0))
        .with(HeadingComp::new(0.0, 0.0, 0.0))
        .with(MetadataComp::new())
        .with(RigidBodyComp::new(&test_body))
        .with(InteractorComp::new(body_handle1, collider_handle1))
        .with(CurrentChunkComp::default())
        .with(BoxFlag)
        .build();

    world3
        .ecs_mut()
        .create_entity()
        .with(EntityFlag::default())
        .with(ETypeComp::new("Box"))
        .with(IDComp::new(&nanoid!()))
        .with(PositionComp::new(-1.0, 80.0, 0.0))
        .with(TargetComp::new(0.0, 0.0, 0.0))
        .with(HeadingComp::new(0.0, 0.0, 0.0))
        .with(MetadataComp::new())
        .with(RigidBodyComp::new(&test_body))
        .with(InteractorComp::new(body_handle2, collider_handle2))
        .with(CurrentChunkComp::default())
        .with(BoxFlag)
        .build();

    Voxelize::run(server).await
}
