use std::collections::HashMap;

use actix::{Recipient, SystemService};
use actix_web::{
    get,
    web::{self, Query},
    Error, HttpRequest, HttpResponse, Responder, Result,
};
use actix_web_actors::ws;

use session::WsSession;

use self::{messages::HasWorld, models::Message, server::WsServer};

pub mod messages;
pub mod models;
pub mod server;
pub mod session;

pub type Client = Recipient<Message>;

async fn get_world_query(params: Query<HashMap<String, String>>) -> String {
    match params.get("world") {
        Some(world) => world.to_owned(),
        None => "world1".to_owned(),
    }
}

pub async fn ws_route(
    req: HttpRequest,
    params: Query<HashMap<String, String>>,
    stream: web::Payload,
) -> Result<impl Responder, Error> {
    let world = get_world_query(params).await;
    ws::start(WsSession::new(&world), &req, stream)
}

#[get("/has-world")]
pub async fn has_world(params: Query<HashMap<String, String>>) -> Result<HttpResponse> {
    let world = get_world_query(params).await;
    let has_world = WsServer::from_registry()
        .send(HasWorld(world))
        .await
        .unwrap();

    Ok(HttpResponse::Ok().json(has_world))
}
