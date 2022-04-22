use log::info;
use nanoid::nanoid;
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    chunk::{Chunk, ChunkParams},
    chunks::Chunks,
    pipeline::Pipeline,
    vec::Vec2,
    world::{registry::Registry, WorldConfig},
};

pub struct PipeliningSystem;

impl<'a> System<'a> for PipeliningSystem {
    type SystemData = (
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Pipeline>,
        WriteExpect<'a, Chunks>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (registry, config, mut pipeline, mut chunks) = data;

        let max_per_tick = config.max_chunk_per_tick;
        let chunk_size = config.chunk_size;

        if let Ok(list) = pipeline.results() {
            list.into_iter().for_each(|mut chunk| {
                pipeline.advance(&mut chunk);
                chunks.renew(chunk);
            })
        }

        let mut processes = vec![];

        let mut processed = 0;

        while processed < max_per_tick {
            processed += 1;

            if pipeline.is_empty() {
                break;
            }

            let (Vec2(cx, cz), index) = pipeline.pop().unwrap();
            let stage = pipeline.get_stage(index);

            // Calculate the radius that this stage requires to be loaded.
            let margin = stage.neighbors(&config);
            let r = (margin as f32 / chunk_size as f32).ceil() as i32;

            let chunk = chunks.raw(&Vec2(cx, cz));

            // Chunk DNE, make one.
            if chunk.is_none() {
                let new_chunk = Chunk::new(
                    &nanoid!(),
                    cx,
                    cz,
                    &ChunkParams {
                        max_height: config.max_height,
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
                    if x == 0 && z == 0 {
                        break;
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

            // Create space that this stage requires.
            if let Some(data) = stage.needs_space() {
                let mut space = chunks.make_space(cx, cz, margin);

                if data.needs_voxels {
                    space.needs_voxels();
                }

                if data.needs_lights {
                    space.needs_lights();
                }

                if data.needs_height_maps {
                    space.needs_height_maps();
                }

                let space = space.build();

                processes.push((chunk, Some(space), index));
            } else {
                processes.push((chunk, None, index))
            }
        }

        if !processes.is_empty() {
            pipeline.process(processes, &registry, &config);
        }
    }
}
