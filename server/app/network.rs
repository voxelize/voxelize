use actix_web::{web, Error, HttpRequest, Responder};
use actix_web_actors::ws;

use super::session::WsSession;

// Define HTTP actor
pub struct Network;

impl Network {
    pub async fn ws_route(req: HttpRequest, stream: web::Payload) -> Result<impl Responder, Error> {
        ws::start(WsSession::default(), &req, stream)
    }
}
