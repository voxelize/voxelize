use voxelize::{BlockAccess, Chunk, ChunkManager, ChunkOptions, ChunkStage, Space, Vec3, World};
use voxelize_protocol::Packet;

pub struct TestStage;

impl ChunkStage for TestStage {
    fn name(&self) -> String {
        "Test Stage".to_string()
    }

    fn process(&self, mut chunk: Chunk) -> Chunk {
        let Vec3(x, y, z) = chunk.min;
        let chunk_size = chunk.options.chunk_size;

        println!("Going through test stage: {:?}", chunk.coords);

        for vx in x..x + chunk_size as i32 {
            for vz in z..z + chunk_size as i32 {
                chunk.set_block_id(vx, 0, vz, 1);
            }
        }

        chunk
    }
}

pub struct TestWorld {
    clients: Vec<String>,
    id: String,
    pub chunk_manager: ChunkManager,
}

impl Default for TestWorld {
    fn default() -> Self {
        let chunk_options = ChunkOptions::new(16, 256, 4, 16);
        let mut chunk_manager = ChunkManager::new(&chunk_options);

        chunk_manager.start_job_processor(8);
        chunk_manager.add_stage(TestStage);

        Self {
            clients: vec![],
            id: "test".to_string(),
            chunk_manager,
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

    fn update(&mut self) {
        self.chunk_manager.update();

        let done_jobs = self.chunk_manager.get_done_jobs();

        for job in done_jobs {
            let coords = job.coords;
            let chunk = self.chunk_manager.chunks.get(&coords);

            if let Some(chunk) = chunk {
                println!("Chunk status: {:?}", chunk.status);

                let Vec3(x, y, z) = chunk.min;
                println!("Block at 0, 0, 0: {}", chunk.get_block_id(x, y, z));
            }
        }
    }
}
