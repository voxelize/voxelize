use nanoid::nanoid;
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    Chunk, ChunkParams, ChunkUtils, Chunks, Pipeline, Registry, SeededNoise, Terrain, Vec2,
    WorldConfig,
};

/// An ECS system to pipeline chunks through different phases of generation.
pub struct ChunkPipeliningSystem;

impl<'a> System<'a> for ChunkPipeliningSystem {
    type SystemData = (
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, SeededNoise>,
        ReadExpect<'a, Terrain>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Chunks>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (registry, config, noise, terrain, mut pipeline, mut chunks) = data;

        let max_per_tick = config.max_chunks_per_tick;
        let chunk_size = config.chunk_size;

        if let Ok((list, new_changes)) = pipeline.results() {
            // Store the block changes that exceed to neighboring chunks.
            new_changes.into_iter().for_each(|(voxel, id)| {
                let coords = ChunkUtils::map_voxel_to_chunk(voxel.0, voxel.1, voxel.2, chunk_size);

                let mut already = pipeline.leftovers.remove(&coords).unwrap_or_else(|| vec![]);
                already.push((voxel, id));

                pipeline.leftovers.insert(coords, already);
            });

            // Advance each chunk's stage to the next stage. If the chunk is about to be meshed, then apply the changes
            // that the neighboring chunks have on it.
            list.into_iter().for_each(|mut chunk| {
                // Means chunk has gone through the pipeline, ready to be lit and meshed.
                if pipeline.advance(&mut chunk).is_none() {
                    // This means the chunk was pushed back into the pipeline for remeshing.
                    // Should send to users that has requested for these chunks for update.
                    chunk.calculate_max_height(&registry);
                    chunks.add_chunk_to_remesh(&chunk.coords, false);
                }

                chunks.renew(chunk);
            });
        }

        let mut processes = vec![];

        while processes.len() < max_per_tick && !pipeline.is_empty() {
            let (Vec2(cx, cz), index) = pipeline.pop().unwrap();

            let stage = pipeline.get_stage(index);

            // Calculate the radius that this stage requires to be loaded.
            let margin = stage.neighbors(&config);
            let r = (margin as f32 / chunk_size as f32).ceil() as i32;

            let coords = Vec2(cx, cz);
            let chunk = chunks.raw(&coords);

            // Chunk DNE, make one.
            if chunk.is_none() {
                if let Some(chunk) = chunks.try_load(&coords) {
                    pipeline.remove(&coords);

                    chunks.add(chunk);
                    chunks.add_chunk_to_remesh(&coords, false);

                    continue;
                }

                let new_chunk = Chunk::new(
                    &nanoid!(),
                    cx,
                    cz,
                    &ChunkParams {
                        max_height: config.max_height,
                        sub_chunks: config.sub_chunks,
                        size: config.chunk_size,
                    },
                );

                // Add this chunk to the pipeline with stage 0.
                pipeline.postpone(&new_chunk.coords, 0);
                chunks.add(new_chunk);

                continue;
            }

            let chunk = chunk.unwrap().clone();

            // Means chunk is already done.
            if chunk.stage.is_none() {
                continue;
            }

            // I don't even know why this would happen.
            if chunk.stage.unwrap() > index {
                continue;
            }

            // Check if chunk's neighbors are ready to be used.
            let mut ready = true;

            for x in -r..=r {
                for z in -r..=r {
                    if (x == 0 && z == 0) || (x * x + z * z > r * r) {
                        continue;
                    }

                    // OK cases are:
                    // - chunk's neighbor exist
                    // - neighbor's stage >= chunk's stage
                    let coords = Vec2(cx + x, cz + z);

                    // If chunk isn't within world borders, then it's fine to be absent.
                    if !chunks.is_within_world(&coords) {
                        continue;
                    }

                    if let Some(neighbor) = chunks.raw(&coords) {
                        if neighbor.stage.is_none()
                            || neighbor.stage.unwrap() >= chunk.stage.unwrap()
                        {
                            continue;
                        }
                    }

                    ready = false;
                    break;
                }

                if !ready {
                    break;
                }
            }

            // if this chunk cannot be processed yet, add it back to queue.
            if !ready {
                pipeline.postpone(&chunk.coords, index);
                continue;
            }

            // TODO: check if there are still block changes done on this chunk. If there are, remesh them in later ticks.

            // Create space that this stage requires.
            if let Some(data) = stage.needs_space() {
                let mut space = chunks.make_space(&chunk.coords, margin);

                if data.needs_voxels {
                    space = space.needs_voxels();
                }

                if data.needs_lights {
                    space = space.needs_lights();
                }

                if data.needs_height_maps {
                    space = space.needs_height_maps();
                }

                let space = space.build();

                processes.push((chunk, Some(space), index));
            } else {
                processes.push((chunk, None, index));
            }
        }

        // This part goes through all block changes (chunk coords -> list of changes) and see
        // if there are any leftover changes that are supposed to be applied to the chunks.

        if !processes.is_empty() {
            pipeline.process(processes, &registry, &config, &noise, &terrain);
        }
    }
}
