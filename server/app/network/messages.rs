use actix::prelude::*;

use crate::app::world::WorldConfig;

use super::models;

/// An actix client-to-server protocol buffer message with additional information.
#[derive(Clone, Message, Default)]
#[rtype(result = "()")]
pub struct ClientMessage {
    pub world_name: String,
    pub client_id: String,
    pub data: models::Message,
}

/// An actix message to create a new world on the server.
#[derive(Clone, Message)]
#[rtype(result = "()")]
pub struct CreateWorld {
    pub name: String,
    pub config: WorldConfig,
}

/// An actix message to add a client to a world.
#[derive(Clone, Message)]
#[rtype(result = "String")]
pub struct JoinWorld {
    pub world_name: String,
    pub recipient: Recipient<models::Message>,
}

/// An actix message to remove a client from a world.
#[derive(Clone, Message)]
#[rtype(result = "()")]
pub struct LeaveWorld {
    pub world_name: String,
    pub client_id: String,
}

/// An actix message to check if the server has a world.
#[derive(Clone, Message)]
#[rtype(result = "bool")]
pub struct HasWorld(pub String);
