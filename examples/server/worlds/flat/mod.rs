use log::warn;
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use specs::{Builder, Component, NullStorage, VecStorage, WorldExt};
use voxelize::{
    Event, FlatlandStage, InteractorComp, PositionComp, Registry, RigidBody, RigidBodyComp, Vec3,
    World, WorldConfig, AABB,
};

use super::shared::{setup_components, setup_dispatcher, setup_entities, setup_methods};

#[derive(Default, Component)]
#[storage(NullStorage)]
struct BoxFlag;

#[derive(Default, Component, Serialize, Deserialize)]
#[storage(VecStorage)]
pub struct Name(pub String);

#[derive(Serialize, Deserialize, Debug)]
struct SpawnMethodPayload {
    position: Vec3<f32>,
}

pub fn setup_flat_world(registry: &Registry) -> World {
    let config = WorldConfig::new()
        .preload(true)
        .preload_radius(2)
        .min_chunk([-50, -50])
        .max_chunk([50, 50])
        .saving(true)
        .save_dir("data/worlds/flat")
        .time_per_day(24000)
        .default_time(12000.0)
        .build();

    let mut world = World::new("flat", &config);

    {
        let mut pipeline = world.pipeline_mut();

        let stone = registry.get_block_by_name("stone");

        pipeline.add_stage(FlatlandStage::new().add_soiling(stone.id, 50))
    }

    setup_components(&mut world);
    setup_methods(&mut world);
    setup_entities(&mut world);
    setup_dispatcher(&mut world);

    world.ecs_mut().register::<BoxFlag>();
    world.ecs_mut().register::<Name>();

    world.set_entity_loader("box", |world, metadata| {
        let position = metadata.get::<PositionComp>("position").unwrap_or_default();

        let body: RigidBody =
            RigidBody::new(&AABB::new().scale_x(0.5).scale_y(0.5).scale_z(0.5).build()).build();
        let interactor = world.physics_mut().register(&body);

        world
            .create_entity(&nanoid!(), "box")
            .with(BoxFlag)
            .with(PositionComp::default())
            .with(RigidBodyComp::new(&body))
            .with(InteractorComp::new(&interactor))
            .with(Name("Box".to_owned()))
            .with(position)
    });

    world.set_method_handle("spawn", |world, _, payload| {
        let data: SpawnMethodPayload = match serde_json::from_str(payload) {
            Ok(data) => data,
            Err(error) => {
                warn!("Ignoring invalid spawn payload '{}': {}", payload, error);
                return;
            }
        };
        world.spawn_entity_at("box", &data.position);
    });

    world.set_event_handle("test", |world, _, payload| {
        world
            .events_mut()
            .dispatch(Event::new("test").payload(payload).build());
    });

    world
}
