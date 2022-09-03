use hashbrown::HashMap;
use rayon::prelude::{IntoParallelIterator, ParallelIterator};
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    Chunks, Geometry, MeshProtocol, Mesher, MessageType, Registry, Vec2, Vec3, WorldConfig,
};

pub struct ChunkCachingSystem;

impl<'a> System<'a> for ChunkCachingSystem {
    type SystemData = (
        ReadExpect<'a, Registry>,
        ReadExpect<'a, WorldConfig>,
        WriteExpect<'a, Chunks>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (registry, config, mut chunks) = data;

        if !chunks.cache.is_empty() {
            let cache = chunks.cache.drain().collect::<Vec<Vec2<i32>>>();

            cache.into_iter().for_each(|coords| {
                if !chunks.is_chunk_ready(&coords) {
                    return;
                }

                // Remesh chunk
                let space = chunks
                    .make_space(&coords, config.max_light_level as usize)
                    .needs_height_maps()
                    .needs_voxels()
                    .needs_lights()
                    .build();

                let chunk = chunks.raw_mut(&coords).unwrap();

                let Vec3(min_x, _, min_z) = chunk.min;
                let Vec3(max_x, _, max_z) = chunk.max;

                let blocks_per_sub_chunk =
                    (space.params.max_height / space.params.sub_chunks) as i32;

                let sub_chunks: Vec<_> = chunk.updated_levels.clone().into_iter().collect();

                sub_chunks
                    .into_par_iter()
                    .map(|level| {
                        let level = level as i32;

                        let min = Vec3(min_x, level * blocks_per_sub_chunk, min_z);
                        let max = Vec3(max_x, (level + 1) * blocks_per_sub_chunk, max_z);

                        let opaque = Mesher::mesh_space(&min, &max, &space, &registry, false);
                        let transparent =
                            Mesher::typed_mesh_space(&min, &max, &space, &registry, true);

                        (opaque, transparent, level)
                    })
                    .collect::<Vec<(Option<Geometry>, Vec<Geometry>, i32)>>()
                    .into_iter()
                    .for_each(|(opaque, transparent, level)| {
                        if chunk.meshes.is_none() {
                            chunk.meshes = Some(HashMap::new());
                        }

                        chunk.meshes.as_mut().unwrap().insert(
                            level as u32,
                            MeshProtocol {
                                level,
                                opaque,
                                transparent,
                            },
                        );
                    });

                if config.saving {
                    chunks.add_chunk_to_save(&coords, true);
                }

                chunks.add_chunk_to_send(&coords, &MessageType::Update, true);
            });
        }

        chunks.cache.clear();
    }
}
