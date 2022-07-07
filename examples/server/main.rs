use std::{fmt::Write, process};

use hashbrown::HashMap;
use log::info;
use nanoid::nanoid;
use registry::setup_registry;
use serde_json::json;
use specs::{
    Builder, Component, DispatcherBuilder, EntityBuilder, NullStorage, ReadExpect, ReadStorage,
    System, SystemData, WorldExt, WriteStorage,
};
use voxelize::{
    CollisionsComp, CurrentChunkComp, ETypeComp, EntityFlag, FlatlandStage, HeadingComp, IDComp,
    InteractorComp, MetadataComp, PositionComp, RigidBody, RigidBodyComp, SaveLoad, Server, Stats,
    TargetComp, Voxelize, World, WorldConfig, AABB,
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
        ReadStorage<'a, CollisionsComp>,
        WriteStorage<'a, RigidBodyComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (stats, flag, collisions, mut bodies) = data;

        for (collision, body, _) in (&collisions, &mut bodies, &flag).join() {
            // if !collision.0.is_empty() {
            // body.0.apply_impulse(0.0, 10.0, 0.0);
            // }
        }
    }
}

fn get_dispatcher(
    builder: DispatcherBuilder<'static, 'static>,
) -> DispatcherBuilder<'static, 'static> {
    builder.with(UpdateBoxSystem, "update-box", &["physics"])
}

fn load_box(id: String, etype: String, metadata: MetadataComp, world: &mut World) -> EntityBuilder {
    let mut test_body = RigidBody::new(&AABB::new(0.0, 0.0, 0.0, 0.5, 0.5, 0.5)).build();
    let interactor1 = world.physics_mut().register(&test_body);

    let base = world.create_entity(&id, &etype);

    if let Some(position) = metadata.get("position") {
        let position: PositionComp = serde_json::from_value(position.to_owned()).unwrap();
        let mut storage: WriteStorage<PositionComp> = SystemData::fetch(&base.world);
        test_body.set_position(position.0 .0, position.0 .1, position.0 .2);
        storage.insert(base.entity, position).unwrap();
    }

    if let Some(target) = metadata.get("target") {
        let target: TargetComp = serde_json::from_value(target.to_owned()).unwrap();
        let mut storage: WriteStorage<TargetComp> = SystemData::fetch(&base.world);
        storage.insert(base.entity, target).unwrap();
    }

    if let Some(heading) = metadata.get("heading") {
        let heading: HeadingComp = serde_json::from_value(heading.to_owned()).unwrap();
        let mut storage: WriteStorage<HeadingComp> = SystemData::fetch(&base.world);
        storage.insert(base.entity, heading).unwrap();
    }

    base.with(RigidBodyComp::new(&test_body))
        .with(InteractorComp::new(interactor1))
        .with(BoxFlag)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    handle_ctrlc();

    let mut server = Server::new()
        .port(4000)
        .secret("test")
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
        .create_world(
            "world3",
            &WorldConfig::new()
                .saving(true)
                .save_dir("examples/server/worlds/world3")
                .build(),
        )
        .expect("Could not create world2.");

    {
        let mut pipeline = world3.pipeline_mut();
        pipeline.add_stage(FlatlandStage::new(70, 2, 1, 3));
    }

    let test_body = RigidBody::new(&AABB::new(0.0, 0.0, 0.0, 0.5, 0.5, 0.5)).build();

    world3.ecs_mut().register::<BoxFlag>();
    world3.set_dispatcher(get_dispatcher);
    world3
        .ecs_mut()
        .write_resource::<SaveLoad>()
        .add_loader("box", load_box);

    let interactor1 = world3.physics_mut().register(&test_body);
    let interactor2 = world3.physics_mut().register(&test_body);

    // world3
    //     .create_entity(&nanoid!(), "Box")
    //     .with(PositionComp::new(1.0, 80.0, 0.0))
    //     .with(TargetComp::new(0.0, 0.0, 0.0))
    //     .with(HeadingComp::new(0.0, 0.0, 0.0))
    //     .with(RigidBodyComp::new(&test_body))
    //     .with(InteractorComp::new(interactor1))
    //     .with(BoxFlag)
    //     .build();

    // world3
    //     .create_entity(&nanoid!(), "Box")
    //     .with(PositionComp::new(-1.0, 80.0, 0.0))
    //     .with(TargetComp::new(0.0, 0.0, 0.0))
    //     .with(HeadingComp::new(0.0, 0.0, 0.0))
    //     .with(RigidBodyComp::new(&test_body))
    //     .with(InteractorComp::new(interactor2))
    //     .with(BoxFlag)
    //     .build();

    Voxelize::run(server).await
}
