use actix::Recipient;
use actix_web::{web, Error, HttpRequest, Responder};
use actix_web_actors::ws;

use session::WsSession;

use self::models::Message;

pub mod messages;
pub mod models;
pub mod server;
pub mod session;

pub type Client = Recipient<Message>;

// Define HTTP actor
pub struct Network;

impl Network {
    pub async fn ws_route(req: HttpRequest, stream: web::Payload) -> Result<impl Responder, Error> {
        ws::start(WsSession::default(), &req, stream)
    }
}
