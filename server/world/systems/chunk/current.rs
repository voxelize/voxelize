use specs::{Join, ReadExpect, ReadStorage, System, WriteStorage};

use crate::{ChunkRequestsComp, ChunkUtils, CurrentChunkComp, PositionComp, Vec3, WorldConfig};

pub struct CurrentChunkSystem;

impl<'a> System<'a> for CurrentChunkSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadStorage<'a, PositionComp>,
        WriteStorage<'a, ChunkRequestsComp>,
        WriteStorage<'a, CurrentChunkComp>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (config, positions, mut requests, mut curr_chunks) = data;

        let chunk_size = config.chunk_size;

        (&positions, &mut curr_chunks)
            .par_join()
            .for_each(|(position, curr_chunk)| {
                let Vec3(vx, vy, vz) = position.0;
                let coords =
                    ChunkUtils::map_voxel_to_chunk(vx as i32, vy as i32, vz as i32, chunk_size);

                if coords != curr_chunk.coords {
                    curr_chunk.coords = coords;
                    curr_chunk.changed = true;
                }
            });

        // for (curr_chunk, request) in (&mut curr_chunks, &mut requests).join() {
        //     if curr_chunk.changed {
        //         request.sort_pending(&curr_chunk.coords);
        //     }
        // }
    }
}
