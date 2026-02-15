use specs::{ReadExpect, System, WriteExpect};

use crate::{BackgroundChunkSaver, Chunks, WorldConfig, WorldTimingContext};

pub struct ChunkSavingSystem;

impl<'a> System<'a> for ChunkSavingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Chunks>,
        ReadExpect<'a, BackgroundChunkSaver>,
        ReadExpect<'a, WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, mut chunks, bg_saver, timing) = data;
        let _t = timing.timer("chunk-saving");

        if !config.saving {
            return;
        }

        let max_saves_per_tick = config.max_saves_per_tick;
        if max_saves_per_tick == 0 {
            return;
        }
        let mut count = 0;
        while count < max_saves_per_tick {
            let Some(coords) = chunks.to_save.pop_front() else {
                break;
            };
            if let Some((chunk_name, chunk_id, voxels, height_map)) = chunks.prepare_save_data(&coords)
            {
                bg_saver.queue_save(coords, chunk_name, chunk_id, voxels, height_map);
                count += 1;
            }
        }
    }
}
