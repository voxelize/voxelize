use hashbrown::HashMap;

use specs::Entity;

use crate::{server::WsSender, MotionProtocol};

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

    /// How this client receives entity motion, negotiated from the JOIN
    /// request's capabilities (see `world::replication::motion`).
    pub motion_protocol: MotionProtocol,
}

pub type Clients = HashMap<String, Client>;
