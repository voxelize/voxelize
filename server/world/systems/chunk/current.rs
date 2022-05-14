use linked_hash_set::LinkedHashSet;
use specs::{Join, ReadExpect, ReadStorage, System, WriteStorage};

use crate::{
    libs::utils::chunk::ChunkUtils,
    vec::{Vec2, Vec3},
    world::{
        components::{
            chunk_requests::ChunkRequestsComp, current_chunk::CurrentChunkComp,
            position::PositionComp,
        },
        WorldConfig,
    },
};

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

        for (curr_chunk, request) in (&mut curr_chunks, &mut requests).join() {
            if curr_chunk.changed {
                let Vec2(cx, cz) = curr_chunk.coords;

                let mut pendings: Vec<Vec2<i32>> =
                    request.pending.clone().into_iter().map(|c| c).collect();

                pendings.sort_by(|c1, c2| {
                    let dist1 = (c1.0 - cx).pow(2) + (c1.1 - cz).pow(2);
                    let dist2 = (c2.0 - cx).pow(2) + (c2.1 - cz).pow(2);
                    dist2.cmp(&dist1)
                });

                let list = LinkedHashSet::from_iter(pendings.into_iter());

                request.pending = list;
            }
        }
    }
}
