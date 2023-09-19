use voxelize_protocol::Packet;

pub trait World {
    /// Returns the world's *unique* id.
    fn id(&self) -> &str;

    /// Returns the world's name.
    fn name(&self) -> &str;

    /// The server starts the world.
    fn start(&mut self) {}

    /// Called every `update_interval` milliseconds.
    fn update(&mut self) {}

    /// The server stops the world.
    fn stop(&mut self) {}

    /// A list of packets to send back to the clients.
    fn packets(&mut self) -> Vec<(String, Vec<Packet>)> {
        vec![]
    }

    /// A list of clients in this world.
    fn clients(&self) -> Vec<String>;

    /// Adds a client to the world. This is called by the server when a new
    /// client is connected to this world.
    fn add_client(&mut self, client_id: &str);

    /// Removes a client from the world. This is called by the server when a client
    /// is disconnected from this world.
    fn remove_client(&mut self, client_id: &str);

    /// Handles a packet from a client. This is called by the server when a packet is
    /// received from a client.
    fn on_packet(&mut self, client_id: &str, packet: Packet);
}
