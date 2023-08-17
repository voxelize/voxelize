use actix_web::{get, post, web, App, HttpResponse, HttpServer, Responder};
use voxelize_actix::Server;

#[get("/")]
async fn hello() -> impl Responder {
    HttpResponse::Ok().body("Hello world!")
}

#[post("/echo")]
async fn echo(req_body: String) -> impl Responder {
    HttpResponse::Ok().body(req_body)
}

async fn manual_hello() -> impl Responder {
    HttpResponse::Ok().body("Hey there!")
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let server_addr = Server::new(
        // 60 ticks per second = 16.666666666666668 ms per tick
        std::time::Duration::from_millis(16),
    )
    .start();

    HttpServer::new(move || {
        App::new()
            .service(hello)
            .service(echo)
            .app_data(web::Data::new(server_addr.clone()))
            .route("/hey", web::get().to(manual_hello))
    })
    .bind(("127.0.0.1", 8080))?
    .run()
    .await
}
