use std::process;

use voxelize::{Server, World};

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

    let world1 = World::new("world1").build();
    server.add_world(world1);

    let world2 = World::new("world2").build();
    server.add_world(world2);

    server.start().expect("Couldn't start voxelize server.");
}
