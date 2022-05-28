use std::process;

use registry::setup_registry;
use voxelize::{pipeline::FlatlandStage, world::WorldConfig, Server, Voxelize};
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

fn main() {
    handle_ctrlc();

    let mut server = Server::new().port(4000).registry(&setup_registry()).build();

    server
        .add_world(setup_world())
        .expect("Could not create world1.");

    let config2 = WorldConfig::new()
        .min_chunk([-5, -5])
        .max_chunk([5, 5])
        .build();
    let world = server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    {
        let mut pipeline = world.pipeline_mut();
        pipeline.add_stage(FlatlandStage::new(10, 1, 1, 1));
    }

    Voxelize::run(server);
}
