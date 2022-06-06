use std::process;

use registry::setup_registry;
use voxelize::{FlatlandStage, Server, Voxelize, WorldConfig};
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
    let world = server
        .create_world("world2", &config2)
        .expect("Could not create world2.");

    {
        let mut pipeline = world.pipeline_mut();
        pipeline.add_stage(FlatlandStage::new(10, 1, 2, 3));
    }

    Voxelize::run(server).await
}
