mod block;
mod world;

use actix::Actor;
use actix_cors::Cors;
use actix_web::{get, web, App, HttpResponse, HttpServer, Responder};
use voxelize::{BlockRegistry, Job, JobTicket, MesherRegistry, Vec2};
use voxelize_actix::Server;

use crate::{block::Block, world::TestWorld};

#[get("/")]
async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello world!")
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let mut server = Server::new(
        // 60 ticks per second = 16.666666666666668 ms per tick
        std::time::Duration::from_millis(16),
    );

    let air = Block::new(0, "air").build();
    let stone = Block::new(1, "stone").build();

    let block_registry = BlockRegistry::with_blocks(vec![air, stone]);
    let mesher_registry = MesherRegistry::new();

    let mut new_world = TestWorld::default();

    // From -5 to 5, generate chunks
    for x in -5..5 {
        for z in -5..5 {
            new_world.chunk_manager.add_job_ticket(JobTicket::Generate(
                format!("test_chunk_{}_{}", x, z),
                Vec2(x, z),
            ));
        }
    }

    server.add_world(new_world);

    let server_addr = server.start();

    let app = HttpServer::new(move || {
        let cors = Cors::permissive();

        App::new()
            .wrap(cors)
            .service(hello)
            .app_data(web::Data::new(server_addr.clone()))
            .route("/ws/", web::get().to(voxelize_actix::voxelize_index))
    })
    .bind(("127.0.0.1", 8080))?;

    println!("Starting server at http://127.0.0.1:8080");

    app.run().await
}
