use log::info;
use registry::setup_registry;
use specs::{Component, NullStorage};
use voxelize::{
    ChunkStage, FlatlandStage, LSystem, Server, Vec3, VoxelAccess, Voxelize, WorldConfig,
};
use world::{
    flat::setup_flat_world, main::setup_main_world, terrain::setup_terrain_world,
    test::setup_test_world,
};

mod registry;
mod world;

const ISLAND_LIMIT: i32 = 1;
const ISLAND_HEIGHT: i32 = 10;

struct LimitedStage;

impl ChunkStage for LimitedStage {
    fn name(&self) -> String {
        "Limited".to_owned()
    }

    fn process(
        &self,
        mut chunk: voxelize::Chunk,
        resources: voxelize::Resources,
        _: Option<voxelize::Space>,
    ) -> voxelize::Chunk {
        if chunk.coords.0 > ISLAND_LIMIT
            || chunk.coords.1 > ISLAND_LIMIT
            || chunk.coords.0 < -ISLAND_LIMIT
            || chunk.coords.1 < -ISLAND_LIMIT
        {
            return chunk;
        }

        let id = resources.registry.get_block_by_name("Stone").id;

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
    let registry = setup_registry();

    let mut server = Server::new()
        .port(4000)
        .secret("test")
        .serve("./examples/client/dist")
        .registry(&registry)
        .build();

    server
        .add_world(setup_main_world())
        .expect("Could not create world1.");

    server
        .add_world(setup_test_world())
        .expect("Could not create test world.");

    server
        .add_world(setup_terrain_world())
        .expect("Could not create terrain world.");

    server
        .add_world(setup_flat_world(&registry))
        .expect("Could not create flat world.");

    server.set_action_handle("create_world", |value, server| {
        info!("World creating...");
        let name: String = serde_json::from_value(value).expect("Can't understand name.");
        server
            .create_world(&name, &WorldConfig::default())
            .expect("Could not create world.");
    });

    // let config2 = WorldConfig::new()
    //     .min_chunk([-100, -100])
    //     .max_chunk([100, 100])
    //     .build();
    // let world2 = server
    //     .create_world("world2", &config2)
    //     .expect("Could not create world2.");

    // {
    //     let mut pipeline = world2.pipeline_mut();
    //     pipeline.add_stage(LimitedStage);
    // }

    // let world3 = server
    //     .create_world(
    //         "world3",
    //         &WorldConfig::new()
    //             .saving(true)
    //             .save_dir("examples/server/worlds/world3")
    //             .build(),
    //     )
    //     .expect("Could not create world2.");

    // {
    //     let mut pipeline = world3.pipeline_mut();
    //     pipeline.add_stage(FlatlandStage::new(70, 2, 1, 3));
    // }

    // world3.ecs_mut().register::<BoxFlag>();
    // world3.entities_mut().add_loader("box", load_box);
    // world3.set_method_handle("spawn", spawn_handle);
    // world3.set_transport_handle(transport_handle);
    // world3.set_client_modifier(client_modifier);
    // world3.set_client_parser(client_parser);

    Voxelize::run(server).await
}
