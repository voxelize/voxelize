use specs::{Join, System, WriteExpect, WriteStorage};
use voxelize::{ChunkManager, ChunkStatus, JobTicket};

use crate::world::{components::ChunkRequests, Block};

pub struct ChunkingSystem;

impl<'a> System<'a> for ChunkingSystem {
    type SystemData = (
        WriteExpect<'a, ChunkManager<Block>>,
        WriteStorage<'a, ChunkRequests>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (mut chunk_manager, mut chunk_requests) = data;

        chunk_manager.update();

        for chunk_request in (&mut chunk_requests).join() {
            let mut requested = vec![];

            std::mem::swap(&mut requested, &mut chunk_request.requested);

            for chunk_coords in requested {
                if let Some(chunk) = chunk_manager.chunks.get(&chunk_coords) {
                    if chunk.status == ChunkStatus::Ready {
                        chunk_request.completed.push(chunk_coords);
                    } else {
                        chunk_request.pending.push(chunk_coords);
                    }

                    continue;
                }

                chunk_manager.add_job_ticket(JobTicket::Generate(
                    "".to_string(),
                    chunk_coords,
                    false,
                ));
            }
        }
    }
}
