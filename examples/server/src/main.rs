use actix::Actor;
use actix_web::{web, App, HttpServer};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(move || App::new())
        .bind("127.0.0.1:4000")?
        .run()
        .await
}
