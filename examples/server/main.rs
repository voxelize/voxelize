use std::process;

fn handle_ctrlc() {
    ctrlc::set_handler(move || {
        print!("\nStopping application...\n");
        process::exit(0);
    })
    .expect("Error setting Ctrl-C handler");
}

fn main() {
    handle_ctrlc();

    let server = voxelize::Server::new(4000).build();
    server.start().expect("Couldn't start voxelize server.");
}
