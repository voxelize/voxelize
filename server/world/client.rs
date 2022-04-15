/// A client of the server.
pub struct Client {
    /// The client's ID on the voxelize server.
    pub id: String,

    /// The entity ID that represents this client in the ECS world.
    pub ent_id: u32,
}
