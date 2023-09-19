mod world;

use actix::{Actor, Addr};
use actix_cors::Cors;
use actix_web::{get, web, App, HttpResponse, HttpServer, Responder};
use serde_json::json;
use voxelize::{BlockRegistry, ChunkManager, Job, JobTicket, MesherRegistry, RegionMesher, Vec2};
use voxelize_actix::{GetWorlds, Server};
use world::{Block, VoxelizeWorld};

#[get("/")]
async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello world!")
}

#[get("/worlds")]
async fn worlds(server: web::Data<Addr<Server>>) -> impl Responder {
    let worlds_data = server.send(GetWorlds).await.unwrap();

    HttpResponse::Ok().json(
        worlds_data
            .into_iter()
            .map(|(id, data)| json!({ "id": id, "data": data}))
            .collect::<Vec<_>>(),
    )
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let mut server = Server::new(
        // 60 ticks per second = 16.666666666666668 ms per tick
        std::time::Duration::from_millis(16),
    );

    let new_world = VoxelizeWorld::default();

    server.add_world(new_world);

    let server_addr = server.start();

    let app = HttpServer::new(move || {
        let cors = Cors::permissive();

        App::new()
            .wrap(cors)
            .service(hello)
            .app_data(web::Data::new(server_addr.clone()))
            .route("/ws/", web::get().to(voxelize_actix::voxelize_index))
            .service(worlds)
    })
    .bind(("127.0.0.1", 8080))?;

    println!("Starting server at http://127.0.0.1:8080");

    app.run().await
}
