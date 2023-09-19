use specs::{Join, ReadStorage, System, WriteExpect, WriteStorage};
use voxelize::{ChunkManager, ChunkStatus, JobTicket};
use voxelize_protocol::{Packet, PacketType};

use crate::world::{
    components::{ChunkRequests, ClientId},
    types::PacketQueue,
    Block,
};

pub struct ChunkingSystem;

impl<'a> System<'a> for ChunkingSystem {
    type SystemData = (
        WriteExpect<'a, ChunkManager<Block>>,
        WriteExpect<'a, PacketQueue>,
        ReadStorage<'a, ClientId>,
        WriteStorage<'a, ChunkRequests>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (mut chunk_manager, mut packet_queue, client_ids, mut chunk_requests) = data;

        chunk_manager.update();

        for (chunk_request, client_id) in (&mut chunk_requests, &client_ids).join() {
            let mut requested = vec![];

            std::mem::swap(&mut requested, &mut chunk_request.requested);

            for chunk_coords in requested {
                if let Some(chunk) = chunk_manager.chunks.get(&chunk_coords) {
                    if chunk.status == ChunkStatus::Ready {
                        chunk_request.completed.push(chunk_coords);

                        packet_queue.push((
                            client_id.0.to_owned(),
                            vec![Packet::new(PacketType::Chunk)
                                .chunks(vec![(chunk.to_model(true, 0..1))])
                                .build()],
                        ))
                    } else {
                        chunk_request.pending.push(chunk_coords);
                    }

                    continue;
                }

                chunk_request.pending.push(chunk_coords.to_owned());

                chunk_manager.add_job_ticket(JobTicket::Generate(
                    "".to_string(),
                    chunk_coords,
                    false,
                ));
            }
        }
    }
}
