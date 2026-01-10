use specs::{ReadExpect, ReadStorage, System, WriteStorage};

use crate::{ChunkUtils, CurrentChunkComp, PositionComp, Vec3, WorldConfig, WorldTimingContext};

pub struct CurrentChunkSystem;

impl<'a> System<'a> for CurrentChunkSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadStorage<'a, PositionComp>,
        WriteStorage<'a, CurrentChunkComp>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        use rayon::prelude::*;
        use specs::ParJoin;

        let (config, positions, mut curr_chunks, timing) = data;
        let _t = timing.timer("current-chunk");

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
    }
}
