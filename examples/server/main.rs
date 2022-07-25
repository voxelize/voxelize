use std::process;

use log::{info, warn};
use registry::setup_registry;
use serde::Deserialize;
use serde_json::Value;
use specs::{
    Builder, Component, DispatcherBuilder, Entity, EntityBuilder, NullStorage, ReadStorage, System,
    WorldExt, WriteExpect, WriteStorage,
};
use voxelize::{
    default_client_parser, AnimationComp, AnimationMetaSystem, BroadcastSystem, ChunkMeshingSystem,
    ChunkPipeliningSystem, ChunkRequestsSystem, ChunkSavingSystem, ChunkSendingSystem, ChunkStage,
    ChunkUpdatingSystem, ClearCollisionsSystem, ClientFilter, ClientFlag, CollisionsComp,
    CurrentChunkSystem, EntitiesSavingSystem, EntitiesSendingSystem, EntityMetaSystem, Event,
    Events, EventsBroadcastSystem, FlatlandStage, IDComp, InteractorComp, MetadataComp,
    PeersMetaSystem, PeersSendingSystem, PhysicsSystem, PositionComp, RigidBody, RigidBodyComp,
    Server, UpdateStatsSystem, Vec2, Vec3, VoxelAccess, Voxelize, World, WorldConfig, AABB,
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
        WriteExpect<'a, Events>,
        ReadStorage<'a, BoxFlag>,
        ReadStorage<'a, ClientFlag>,
        ReadStorage<'a, IDComp>,
        ReadStorage<'a, CollisionsComp>,
        WriteStorage<'a, RigidBodyComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use specs::Join;

        let (mut events, box_flag, client_flag, ids, collisions, mut bodies) = data;

        for (collision, id, _) in (&collisions, &ids, &client_flag).join() {
            if !collision.0.is_empty() {
                let (_, entity) = collision.0[0];
                if let Some(_) = box_flag.get(entity.clone()) {
                    events.dispatch(
                        Event::new("TELEPORT")
                            .payload([0.0, 90.0, 0.0] as [f32; 3])
                            .filter(ClientFilter::Direct(id.0.clone()))
                            .location(Vec2(0, 0))
                            .build(),
                    )
                    // if let Some(body) = bodies.get_mut(entity) {
                    //     body.0.apply_impulse(0.0, 30.0, 0.0);
                    // }
                }
            }
        }
    }
}

fn get_dispatcher(
    builder: DispatcherBuilder<'static, 'static>,
) -> DispatcherBuilder<'static, 'static> {
    builder
        .with(UpdateStatsSystem, "update-stats", &[])
        .with(EntityMetaSystem, "entity-meta", &[])
        .with(PeersMetaSystem, "peers-meta", &[])
        .with(CurrentChunkSystem, "current-chunking", &[])
        .with(ChunkUpdatingSystem, "chunk-updating", &["current-chunking"])
        .with(ChunkRequestsSystem, "chunk-requests", &["current-chunking"])
        .with(
            ChunkPipeliningSystem,
            "chunk-pipelining",
            &["chunk-requests"],
        )
        .with(ChunkMeshingSystem, "chunk-meshing", &["chunk-pipelining"])
        .with(ChunkSendingSystem, "chunk-sending", &["chunk-meshing"])
        .with(ChunkSavingSystem, "chunk-saving", &["chunk-pipelining"])
        .with(PhysicsSystem, "physics", &["update-stats"])
        .with(EntitiesSavingSystem, "entities-saving", &["entity-meta"])
        .with(
            EntitiesSendingSystem,
            "entities-sending",
            &["entities-saving"],
        )
        .with(PeersSendingSystem, "peers-sending", &["peers-meta"])
        .with(
            BroadcastSystem,
            "broadcast",
            &["entities-sending", "peers-sending", "chunk-sending"],
        )
        .with(
            ClearCollisionsSystem,
            "clear-collisions",
            &["entities-sending"],
        )
        .with(
            EventsBroadcastSystem,
            "events-broadcasting",
            &["chunk-requests", "broadcast"],
        )
}

fn load_box(id: String, etype: String, metadata: MetadataComp, world: &mut World) -> EntityBuilder {
    let mut test_body =
        RigidBody::new(&AABB::new().scale_x(0.5).scale_y(0.5).scale_z(0.5).build()).build();
    let interactor1 = world.physics_mut().register(&test_body);

    let position = metadata.get::<PositionComp>("position").unwrap_or_default();
    test_body.set_position(position.0 .0, position.0 .1, position.0 .2);

    world
        .create_entity(&id, &etype)
        .with(position)
        .with(RigidBodyComp::new(&test_body))
        .with(InteractorComp::new(interactor1))
        .with(BoxFlag)
}

fn spawn_handle(value: Value, world: &mut World) {
    let position: Vec3<f32> = serde_json::from_value(value).expect("Can't understand position.");
    if world.spawn_entity("box", &position).is_none() {
        warn!("Failed to spawn box entity!");
    }
}

fn transport_handle(value: Value, world: &mut World) {
    let position: Vec3<f32> = serde_json::from_value(value).expect("Can't understand position.");

    info!("Spawning box at: {:?}", position);
    if world.spawn_entity("box", &position).is_none() {
        warn!("Failed to spawn box entity!");
    }

    // let ids: Vec<String> = world
    //     .clients()
    //     .iter()
    //     .map(|(id, _)| id.to_owned())
    //     .collect();

    // let mut events = world.events_mut();

    // events.dispatch(
    //     Event::new("TELEPORT")
    //         .payload(position)
    //         .filter(ClientFilter::Include(ids))
    //         .location(Vec2(0, 0))
    //         .build(),
    // );
}

fn client_modifier(ent: Entity, world: &mut World) {
    world.add(ent, AnimationComp::default());
}

#[derive(Deserialize, Default)]
struct ClientAnimation {
    animation: Option<String>,
}

fn client_parser(metadata: &str, ent: Entity, world: &mut World) {
    default_client_parser(metadata, ent.to_owned(), world);

    let metadata = serde_json::from_str::<ClientAnimation>(metadata).unwrap_or_default();

    if let Some(new_anim) = metadata.animation {
        let mut animations = world.write_component::<AnimationComp>();
        if let Some(animation) = animations.get_mut(ent) {
            animation.0 = Some(new_anim);
        }
    }
}

const ISLAND_LIMIT: i32 = 1;
const ISLAND_HEIGHT: i32 = 10;

struct LimitedStage;

impl ChunkStage for LimitedStage {
    fn name(&self) -> String {
        "Limited Stage".to_owned()
    }

    fn process(
        &self,
        mut chunk: voxelize::Chunk,
        resources: voxelize::ResourceResults,
        _: Option<voxelize::Space>,
    ) -> voxelize::Chunk {
        if chunk.coords.0 > ISLAND_LIMIT
            || chunk.coords.1 > ISLAND_LIMIT
            || chunk.coords.0 < -ISLAND_LIMIT
            || chunk.coords.1 < -ISLAND_LIMIT
        {
            return chunk;
        }

        let id = resources.registry.unwrap().get_block_by_name("Stone").id;

        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;

        for vx in min_x..max_x {
            for vz in min_z..max_z {
                for vy in 0..ISLAND_HEIGHT {
                    chunk.set_voxel(vx, vy, vz, id);
                }
            }
        }

        chunk
    }
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
        .min_chunk([-100, -100])
        .max_chunk([100, 100])
        .build();
    let world2 = server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    world2.set_dispatcher(get_dispatcher.clone());

    {
        let mut pipeline = world2.pipeline_mut();
        pipeline.add_stage(LimitedStage);
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

    world3.ecs_mut().register::<BoxFlag>();
    world3.set_dispatcher(get_dispatcher);
    world3.entities_mut().add_loader("box", load_box);
    world3.set_method_handle("spawn", spawn_handle);
    world3.set_transport_handle(transport_handle);
    world3.set_client_modifier(client_modifier);
    world3.set_client_parser(client_parser);

    Voxelize::run(server).await
}
