use std::process;

use specs::DispatcherBuilder;
use voxelize::{
    chunk::Chunk,
    chunks::Chunks,
    pipeline::{ChunkStage, Pipeline},
    vec::Vec3,
    world::{registry::Registry, World, WorldConfig},
    Server, Voxelize,
};

fn handle_ctrlc() {
    ctrlc::set_handler(move || {
        print!("\nStopping application...\n");
        process::exit(0);
    })
    .expect("Error setting Ctrl-C handler");
}

fn get_dispatcher(_: &mut DispatcherBuilder) {}

struct TestStage;

impl ChunkStage for TestStage {
    fn neighbors(&self) -> usize {
        15
    }

    fn process(
        &self,
        chunk: &mut Chunk,
        chunks: &Chunks,
        registry: &Registry,
        pipeline: &Pipeline,
    ) {
        let Vec3(min_x, min_y, min_z) = chunk.min;
        chunk.set_voxel(min_x, min_y, min_z, registry.get_id_by_name("1"));
    }
}

fn main() {
    handle_ctrlc();

    let mut server = Server::new().port(4000).build();

    let config1 = WorldConfig::new().build();

    let mut world = World::new("world1", &config1);

    world.set_dispatcher(get_dispatcher);
    world.pipeline_mut().add_stage(TestStage {});

    server.add_world(world).expect("Could not create world1.");

    let config2 = WorldConfig::new().build();
    server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    Voxelize::run(server);
}
