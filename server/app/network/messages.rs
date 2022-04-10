use actix::prelude::*;

use crate::app::world::WorldConfig;

use super::models;

#[derive(Clone, Message, Default)]
#[rtype(result = "()")]
pub struct ClientMessage {
    pub world_name: String,
    pub client_id: String,
    pub data: models::Message,
}

#[derive(Clone, Message)]
#[rtype(result = "()")]
pub struct CreateWorld {
    pub name: String,
    pub config: WorldConfig,
}

#[derive(Clone, Message)]
#[rtype(result = "String")]
pub struct JoinWorld {
    pub world_name: String,
    pub recipient: Recipient<models::Message>,
}

#[derive(Clone, Message)]
#[rtype(result = "()")]
pub struct LeaveWorld {
    pub world_name: String,
    pub client_id: String,
}

#[derive(Clone, Message)]
#[rtype(result = "bool")]
pub struct HasWorld(pub String);
