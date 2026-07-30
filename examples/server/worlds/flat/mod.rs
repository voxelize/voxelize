mod comps;
mod systems;

use log::info;
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use specs::{Builder, Component, DispatcherBuilder, NullStorage, VecStorage, WorldExt};
use voxelize::{
    BroadcastSystem, ChunkGeneratingSystem, ChunkRequestsSystem, ChunkSavingSystem,
    ChunkSendingSystem, ChunkUpdatingSystem, CleanupSystem, CurrentChunkSystem, DataSavingSystem,
    EntitiesMetaSystem, EntitiesSendingSystem, Event, EventsSystem, FlatlandStage, InteractorComp,
    PeersMetaSystem, PeersSendingSystem, PhysicsSystem, PositionComp, Registry, RigidBody,
    RigidBodyComp, UpdateStatsSystem, Vec3, World, WorldConfig, AABB,
};

use self::{
    comps::CountdownComp,
    systems::{CountdownSystem, NameMetadataSystem},
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

#[derive(Serialize, Deserialize, Debug)]
struct TimeMethodPayload {
    time: f32,
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
    world.ecs_mut().register::<CountdownComp>();

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
            // .with(CountdownComp::new(300))
            .with(position)
    });

    world.set_method_handle("spawn", |world, _, payload| {
        let data: SpawnMethodPayload = serde_json::from_str(&payload).unwrap();
        world.spawn_entity_at("box", &data.position);
    });

    world.set_event_handle("test", |world, _, payload| {
        world
            .events_mut()
            .dispatch(Event::new("test").payload(payload).build());
    });

    world
}
