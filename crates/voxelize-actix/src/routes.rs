use actix::Addr;
use actix_web::{web, Error, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use nanoid::nanoid;

use crate::{Server, Session};

pub async fn voxelize_index(
    req: HttpRequest,
    stream: web::Payload,
    server: web::Data<Addr<Server>>,
) -> Result<HttpResponse, Error> {
    ws::start(Session::new(&nanoid!(), server.get_ref()), &req, stream)
}
