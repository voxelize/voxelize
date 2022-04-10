use std::process;

use voxelize::{Room, Server};

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

    let room = Room::new("test").build();
    server.add_room(room);

    server.start().expect("Couldn't start voxelize server.");
}
