use std::process;

use voxelize::{Server, WorldConfig};

fn handle_ctrlc() {
    ctrlc::set_handler(move || {
        print!("\nStopping application...\n");
        process::exit(0);
    })
    .expect("Error setting Ctrl-C handler");
}

fn main() {
    handle_ctrlc();

    let mut server = Server::new(4000).build();

    let config1 = WorldConfig::new().build();
    server.create_world("world1", &config1);

    let config2 = WorldConfig::new().build();
    server.create_world("world2", &config2);

    server.start().expect("Couldn't start voxelize server.");
}
