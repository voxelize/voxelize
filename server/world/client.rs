use specs::Entity;

/// A client of the server.
pub struct Client {
    /// The client's ID on the voxelize server.
    pub id: String,

    /// The entity that represents this client in the ECS world.
    pub entity: Entity,
}
