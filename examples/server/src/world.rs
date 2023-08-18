use voxelize::World;
use voxelize_protocol::Packet;

pub struct TestWorld {
    clients: Vec<String>,
    id: String,
}

impl Default for TestWorld {
    fn default() -> Self {
        Self {
            clients: vec![],
            id: "test".to_string(),
        }
    }
}

impl World for TestWorld {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        "Test World"
    }

    fn clients(&self) -> Vec<&str> {
        self.clients.iter().map(|s| s.as_str()).collect()
    }

    fn add_client(&mut self, client_id: &str) {
        self.clients.push(client_id.to_string());
    }

    fn remove_client(&mut self, client_id: &str) {
        self.clients.retain(|s| s != client_id);
    }

    fn on_packet(&mut self, client_id: &str, packet: Packet) {
        println!("{}: {:?}", client_id, packet);
    }
}
