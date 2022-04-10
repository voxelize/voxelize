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

    let room1 = Room::new("room1").build();
    server.add_room(room1);

    let room2 = Room::new("room2").build();
    server.add_room(room2);

    server.start().expect("Couldn't start voxelize server.");
}
