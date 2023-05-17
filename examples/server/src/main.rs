use actix::Actor;
use actix_web::{web, App, HttpServer};
use voxelize::{EventReactor, Server};

struct Test {}

impl EventReactor for Test {
    fn init(&mut self) {
        println!("init");
    }

    fn error(&mut self, error: String) {
        println!("error: {}", error);
    }

    fn entity(&mut self, entity: String) {
        println!("entity: {}", entity);
    }

    fn event(&mut self, event: String) {
        println!("event: {}", event);
    }

    fn chunk(&mut self, chunk: String) {
        println!("chunk: {}", chunk);
    }

    fn unchunk(&mut self, block: String) {
        println!("unchunk: {}", block);
    }

    fn method(&mut self, method: String) {
        println!("method: {}", method);
    }

    fn stats(&mut self, stats: String) {
        println!("stats: {}", stats);
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let mut server = Server::new();

    server.react(Test {});

    let server_addr = server.start();

    HttpServer::new(move || App::new().app_data(web::Data::new(server_addr.clone())))
        .bind("127.0.0.1:4000")?
        .run()
        .await
}
