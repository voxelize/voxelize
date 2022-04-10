use actix::prelude::*;

use super::models;

#[derive(Clone, Message, Default)]
#[rtype(result = "()")]
pub struct ClientMessage {
    pub room_name: String,
    pub client_id: String,
    pub data: models::Message,
}

#[derive(Clone, Message)]
#[rtype(result = "String")]
pub struct JoinRoom {
    pub room_name: String,
    pub recipient: Recipient<models::Message>,
}

#[derive(Clone, Message)]
#[rtype(result = "()")]
pub struct LeaveRoom {
    pub room_name: String,
    pub client_id: String,
}
