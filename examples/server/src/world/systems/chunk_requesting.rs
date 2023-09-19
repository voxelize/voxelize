use hashbrown::HashMap;
use specs::{Join, ReadExpect, ReadStorage, System, WriteExpect, WriteStorage};
use voxelize::{BlockAccess, ChunkManager, Vec3};
use voxelize_protocol::{ChunkData, Packet, PacketType};

use crate::world::{
    components::{ChunkRequests, ClientId},
    types::PacketQueue,
    Block,
};

pub struct ChunkRequestingSystem;

impl<'a> System<'a> for ChunkRequestingSystem {
    type SystemData = (
        ReadExpect<'a, ChunkManager<Block>>,
        WriteExpect<'a, PacketQueue>,
        ReadStorage<'a, ClientId>,
        WriteStorage<'a, ChunkRequests>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (chunk_manager, mut packet_queue, client_ids, mut chunk_requests) = data;

        let finished_chunk_jobs = chunk_manager.get_done_jobs();

        for job in finished_chunk_jobs {
            let coords = job.coords;
            let chunk = chunk_manager.chunks.get(&coords);

            if let Some(chunk) = chunk {
                println!("Chunk status: {:?} {:?}", chunk.coords, chunk.status);

                let Vec3(x, y, z) = chunk.min;
                println!("Block at 0, 0, 0: {}", chunk.get_block_id(x, y, z));
            }

            if let Some(chunk) = chunk {
                for (chunk_request, client_id) in (&mut chunk_requests, &client_ids).join() {
                    // Pending
                    println!("Pending: {:?}", chunk_request.pending);
                    if chunk_request.pending.contains(&coords) {
                        chunk_request.pending.retain(|c| c != &coords);
                        chunk_request.completed.push(coords.to_owned());

                        let mut meshes = vec![];

                        if chunk.meshes.is_some() {
                            (0..1).for_each(|level| {
                                if let Some(mesh) = chunk.meshes.as_ref().unwrap().get(&level) {
                                    meshes.push(mesh.to_owned());
                                }
                            });
                        }

                        let packet = Packet::new(PacketType::Chunk)
                            .chunks(vec![chunk.to_model(true, 0..1)])
                            .build();

                        packet_queue.push((client_id.0.to_owned(), vec![packet]))
                    }
                }
            }
        }
    }
}
