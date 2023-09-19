mod block;
mod components;
mod mesher;
mod stages;
mod systems;

use serde::{Deserialize, Serialize};
use specs::{Builder, DispatcherBuilder, Entity, Join, World, WorldExt};
use voxelize::{
    BlockAccess, BlockIdentity, BlockRegistry, ChunkCoords, ChunkManager, ChunkOptions, Face,
    MesherRegistry, SixFacesBuilder, TextureAtlas, Vec3, World as WorldLike,
};
use voxelize_protocol::{deserialize_from_struct, Packet, PacketType};

use self::{
    components::{ChunkRequests, ClientFlag, ClientId},
    mesher::BlockMesher,
    stages::TestStage,
    systems::ChunkingSystem,
};

pub use self::block::Block;

#[derive(Clone, Serialize)]
pub struct VoxelizeWorldInitData {
    name: String,
    atlas: Vec<(String, Vec<Face>)>,
}

pub struct VoxelizeWorld {
    id: String,
    atlas: TextureAtlas,
    pub ecs: World,
    pub packets: Vec<(String, Vec<Packet>)>,
}

impl VoxelizeWorld {
    pub fn get_client_entity_by_id(&self, client_id: &str) -> Option<Entity> {
        for (entity, client) in
            (&self.ecs.entities(), &self.ecs.read_component::<ClientId>()).join()
        {
            if client.0 == client_id {
                return Some(entity);
            }
        }

        None
    }
}

impl Default for VoxelizeWorld {
    fn default() -> Self {
        let chunk_options = ChunkOptions::new(16, 256, 4, 16);

        let air = Block::new(0, "air").build();
        let stone = Block::new(1, "stone").is_solid(true).build();
        let dirt = Block::new(2, "dirt").is_solid(true).build();

        let block_registry = BlockRegistry::with_blocks(vec![air, stone, dirt]);

        let mut mesher_registry = MesherRegistry::new();
        mesher_registry.register(BlockMesher);

        let six_faces = SixFacesBuilder::new().build();

        let mut texture_atlas = TextureAtlas::new();
        texture_atlas.add_faces("stone", &six_faces);
        texture_atlas.add_faces("dirt", &six_faces);
        texture_atlas.generate();

        let mut chunk_manager = ChunkManager::new(
            &block_registry,
            &mesher_registry,
            &texture_atlas,
            &chunk_options,
        );

        chunk_manager.start_job_processor(8);
        chunk_manager.add_stage(TestStage);

        let mut ecs = World::new();

        ecs.insert(block_registry);
        ecs.insert(mesher_registry);
        ecs.insert(chunk_manager);

        ecs.register::<ClientId>();
        ecs.register::<ChunkRequests>();
        ecs.register::<ClientFlag>();

        Self {
            id: "test".to_string(),
            atlas: texture_atlas,
            ecs,
            packets: vec![],
        }
    }
}

impl WorldLike for VoxelizeWorld {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        "Test World"
    }

    fn clients(&self) -> Vec<String> {
        (&self.ecs.read_component::<ClientId>())
            .join()
            .map(|c| c.0.to_owned())
            .collect()
    }

    fn add_client(&mut self, client_id: &str) {
        let client_entity = self
            .ecs
            .create_entity()
            .with(ClientFlag)
            .with(ChunkRequests::default())
            .with(ClientId(client_id.to_string()))
            .build();

        // Send the init packet to the client
        self.packets.push((
            client_id.to_string(),
            vec![Packet::new(PacketType::Init)
                .json(VoxelizeWorldInitData {
                    name: self.name().to_string(),
                    atlas: self
                        .atlas
                        .groups
                        .iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect(),
                })
                .build()],
        ))
    }

    fn remove_client(&mut self, client_id: &str) {
        let mut entities_to_delete = vec![];

        for (entity, client) in
            (&self.ecs.entities(), &self.ecs.read_component::<ClientId>()).join()
        {
            if client.0 == client_id {
                entities_to_delete.push(entity);
            }
        }

        for entity in entities_to_delete {
            self.ecs.delete_entity(entity).unwrap();
        }
    }

    fn packets(&mut self) -> Vec<(String, Vec<Packet>)> {
        self.packets.drain(..).collect()
    }

    fn on_packet(&mut self, client_id: &str, packet: Packet) {
        match packet.get_type() {
            PacketType::Chunk => {
                let mut chunk_requests = self.ecs.write_component::<ChunkRequests>();

                if let Some(client_entity) = self.get_client_entity_by_id(client_id) {
                    if let Some(chunk_requests) = chunk_requests.get_mut(client_entity) {
                        let json = packet.json.clone().unwrap();

                        #[derive(Deserialize)]
                        struct ChunkRequest {
                            chunks: Vec<ChunkCoords>,
                        }

                        if let Ok(mut chunk_coords) = deserialize_from_struct::<ChunkRequest>(&json)
                        {
                            chunk_requests.requested.append(&mut chunk_coords.chunks);
                        } else {
                            println!("Failed to deserialize chunk coords: {:?}", packet.json);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn update(&mut self) {
        let mut dispatcher = DispatcherBuilder::new()
            .with(ChunkingSystem, "chunking_system", &[])
            .build();

        dispatcher.dispatch(&self.ecs);

        self.ecs.maintain();

        let chunk_manager: &mut ChunkManager<Block> =
            self.ecs.get_mut::<ChunkManager<Block>>().unwrap();

        let done_jobs = chunk_manager.get_done_jobs();

        for job in done_jobs {
            let coords = job.coords;
            let chunk = chunk_manager.chunks.get(&coords);

            if let Some(chunk) = chunk {
                println!("Chunk status: {:?} {:?}", chunk.coords, chunk.status);

                let Vec3(x, y, z) = chunk.min;
                println!("Block at 0, 0, 0: {}", chunk.get_block_id(x, y, z));
            }
        }
    }
}
