mod comps;
mod systems;

use log::info;
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use specs::{Builder, Component, DispatcherBuilder, NullStorage, WorldExt};
use voxelize::{
    BroadcastSystem, ChunkGeneratingSystem, ChunkRequestsSystem, ChunkSavingSystem,
    ChunkSendingSystem, ChunkUpdatingSystem, CleanupSystem, CurrentChunkSystem, DataSavingSystem,
    EntitiesMetaSystem, EntitiesSendingSystem, Event, EventsSystem, FlatlandStage, InteractorComp,
    PeersMetaSystem, PeersSendingSystem, PhysicsSystem, PositionComp, Registry, RigidBody,
    RigidBodyComp, UpdateStatsSystem, Vec3, World, WorldConfig, AABB,
};

use self::{comps::CountdownComp, systems::CountdownSystem};

#[derive(Default, Component)]
#[storage(NullStorage)]
struct BoxFlag;

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
        .min_chunk([-50, -50])
        .max_chunk([50, 50])
        .saving(true)
        .save_dir("data/worlds/flat")
        .time_per_day(2400)
        .build();

    let mut world = World::new("flat", &config);

    {
        let mut pipeline = world.pipeline_mut();

        let stone = registry.get_block_by_name("stone");

        pipeline.add_stage(FlatlandStage::new().add_soiling(stone.id, 50))
    }

    world.set_dispatcher(|| {
        DispatcherBuilder::new()
            .with(UpdateStatsSystem, "update-stats", &[])
            .with(EntitiesMetaSystem, "entities-meta", &[])
            .with(PeersMetaSystem, "peers-meta", &[])
            .with(CurrentChunkSystem, "current-chunk", &[])
            .with(ChunkUpdatingSystem, "chunk-updating", &["current-chunk"])
            .with(ChunkRequestsSystem, "chunk-requests", &["current-chunk"])
            .with(
                ChunkGeneratingSystem,
                "chunk-generation",
                &["chunk-requests"],
            )
            .with(ChunkSendingSystem, "chunk-sending", &["chunk-generation"])
            .with(ChunkSavingSystem, "chunk-saving", &["chunk-generation"])
            .with(PhysicsSystem, "physics", &["current-chunk", "update-stats"])
            .with(CountdownSystem, "countdown", &["entities-meta"])
            .with(DataSavingSystem, "entities-saving", &["entities-meta"])
            .with(
                EntitiesSendingSystem,
                "entities-sending",
                &["entities-meta"],
            )
            .with(PeersSendingSystem, "peers-sending", &["peers-meta"])
            .with(
                BroadcastSystem,
                "broadcast",
                &["chunk-sending", "entities-sending", "peers-sending"],
            )
            .with(
                CleanupSystem,
                "cleanup",
                &["entities-sending", "peers-sending"],
            )
            .with(EventsSystem, "events", &["broadcast"])
    });

    world.ecs_mut().register::<BoxFlag>();
    world.ecs_mut().register::<CountdownComp>();

    world.set_entity_loader("box", |world, metadata| {
        let position = metadata.get::<PositionComp>("position").unwrap_or_default();

        let body =
            RigidBody::new(&AABB::new().scale_x(0.5).scale_y(0.5).scale_z(0.5).build()).build();
        let interactor = world.physics_mut().register(&body);

        world
            .create_entity(&nanoid!(), "box")
            .with(BoxFlag)
            .with(PositionComp::default())
            .with(RigidBodyComp::new(&body))
            .with(InteractorComp::new(&interactor))
            .with(CountdownComp::new(300))
            .with(position)
    });

    world.set_method_handle("spawn", |world, _, payload| {
        let data: SpawnMethodPayload = serde_json::from_str(&payload).unwrap();
        world.spawn_entity_at("box", &data.position);
    });

    world.set_method_handle("time", |world, _, payload| {
        let time_per_day = world.config().time_per_day as f32;
        let new_time: TimeMethodPayload = serde_json::from_str(&payload).unwrap();
        world.stats_mut().set_time(new_time.time % time_per_day);
    });

    world.set_event_handle("test", |world, _, payload| {
        world
            .events_mut()
            .dispatch(Event::new("test").payload(payload).build());
    });

    world
}
