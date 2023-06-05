use actix::Actor;
use actix_web::{web, App, HttpServer};
use voxelize::{Server, World};

struct TestWorld {}

impl World for TestWorld {
    fn add_client(&mut self, client: voxelize::Client) {
        println!("add_client");
    }

    fn remove_client(&mut self, client_id: &str) {
        println!("remove_client");
    }

    fn on_packet(&mut self, client_id: &str, packet: voxelize_protocol::Packet) {
        println!("on_packet");
    }

    fn id(&self) -> &str {
        "test"
    }

    fn name(&self) -> &str {
        "Test"
    }

    fn packets(&self) -> Vec<(voxelize::ClientFilter, voxelize_protocol::Packet)> {
        println!("packets");
        vec![]
    }

    fn clients(&self) -> Vec<voxelize::Client> {
        println!("clients");
        vec![]
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let mut server = Server::new();

    server.add_world(TestWorld {});

    let server_addr = server.start();

    HttpServer::new(move || App::new().app_data(web::Data::new(server_addr.clone())))
        .bind("127.0.0.1:4000")?
        .run()
        .await
}
