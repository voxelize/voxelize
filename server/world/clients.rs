use hashbrown::HashMap;

use specs::Entity;

use crate::server::WsSender;

/// A client of the server.
#[derive(Clone)]
pub struct Client {
    /// The client's ID on the voxelize server.
    pub id: String,

    /// The username of the client.
    pub username: String,

    /// The entity that represents this client in the ECS world.
    pub entity: Entity,

    /// WebSocket sender to the client.
    pub sender: WsSender,
}

pub type Clients = HashMap<String, Client>;
