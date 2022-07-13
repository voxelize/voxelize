use actix::Recipient;
use hashbrown::HashMap;

use specs::Entity;

use crate::EncodedMessage;

/// A client of the server.
#[derive(Clone, Debug)]
pub struct Client {
    /// The client's ID on the voxelize server.
    pub id: String,

    /// The username of the client.
    pub username: String,

    /// The entity that represents this client in the ECS world.
    pub entity: Entity,

    /// Address to the client
    pub addr: Recipient<EncodedMessage>,
}

pub type Clients = HashMap<String, Client>;
