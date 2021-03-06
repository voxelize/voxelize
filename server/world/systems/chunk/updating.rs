use std::{collections::VecDeque, time::Instant};

use hashbrown::HashMap;
use log::info;
use rayon::iter::{IntoParallelIterator, ParallelIterator};
use specs::{ReadExpect, System, WriteExpect};

use crate::{
    Block, BlockUtils, ChunkUtils, Chunks, ClientFilter, Geometry, LightColor, LightNode, Lights,
    MeshProtocol, Mesher, Message, MessageQueue, MessageType, Registry, UpdateProtocol, Vec2, Vec3,
    VoxelAccess, WorldConfig,
};

pub const VOXEL_NEIGHBORS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
];

const RED: LightColor = LightColor::Red;
const GREEN: LightColor = LightColor::Green;
const BLUE: LightColor = LightColor::Blue;
const SUNLIGHT: LightColor = LightColor::Sunlight;

pub struct ChunkUpdatingSystem;

impl<'a> System<'a> for ChunkUpdatingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Registry>,
        WriteExpect<'a, MessageQueue>,
        WriteExpect<'a, Chunks>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (config, registry, mut message_queue, mut chunks) = data;

        if chunks.to_update.is_empty() {
            return;
        }

        let mut count = 0;

        let max_height = config.max_height as i32;
        let max_light_level = config.max_light_level;

        chunks.clear_cache();

        let mut results = vec![];

        let mut red_flood = VecDeque::default();
        let mut green_flood = VecDeque::default();
        let mut blue_flood = VecDeque::default();
        let mut sun_flood = VecDeque::default();

        while count < config.max_updates_per_tick && !chunks.to_update.is_empty() {
            count += 1;

            let (voxel, raw) = chunks.to_update.pop_front().unwrap();
            let Vec3(vx, vy, vz) = voxel;

            let updated_id = BlockUtils::extract_id(raw);
            let rotation = BlockUtils::extract_rotation(raw);
            let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, config.chunk_size);

            if vy < 0 || vy >= config.max_height as i32 || !registry.has_type(updated_id) {
                continue;
            }

            if !chunks.is_chunk_ready(&coords) {
                continue;
            }

            for neighbor in chunks.light_traversed_chunks(&coords) {
                if !chunks.is_chunk_ready(&neighbor) {
                    chunks.to_update.push_back((voxel.to_owned(), raw));
                }
            }

            let current_id = chunks.get_voxel(vx, vy, vz);
            if registry.is_air(updated_id) && registry.is_air(current_id) {
                continue;
            }

            // Actually updating the voxel.
            let height = chunks.get_max_height(vx, vz);

            let current_type = registry.get_block_by_id(current_id);
            let updated_type = registry.get_block_by_id(updated_id);

            let current_transparency = current_type.get_rotated_transparency(&rotation);
            let updated_transparency = if updated_type.rotatable {
                updated_type.get_rotated_transparency(&rotation)
            } else {
                [
                    updated_type.is_px_transparent,
                    updated_type.is_py_transparent,
                    updated_type.is_pz_transparent,
                    updated_type.is_nx_transparent,
                    updated_type.is_ny_transparent,
                    updated_type.is_nz_transparent,
                ]
            };

            chunks.set_voxel(vx, vy, vz, updated_id);

            if updated_type.rotatable {
                chunks.set_voxel_rotation(vx, vy, vz, &rotation);
            }

            // updating the height map
            if registry.is_air(updated_id) {
                if vy == height as i32 {
                    // on max height, should set max height to lower
                    for y in (0..vy).rev() {
                        if y == 0 || registry.check_height(chunks.get_voxel(vx, y, vz)) {
                            chunks.set_max_height(vx, vz, y as u32);
                            break;
                        }
                    }
                }
            } else if height < vy as u32 {
                chunks.set_max_height(vx, vz, vy as u32);
            }

            // Updating light levels...

            // Straight up updating to a solid opaque block, remove all lights.
            if updated_type.is_opaque {
                if chunks.get_sunlight(vx, vy, vz) != 0 {
                    Lights::remove_light(&mut *chunks, &voxel, &SUNLIGHT, &config, &registry);
                }
                if chunks.get_torch_light(vx, vy, vz, &RED) != 0 {
                    Lights::remove_light(&mut *chunks, &voxel, &RED, &config, &registry);
                }
                if chunks.get_torch_light(vx, vy, vz, &GREEN) != 0 {
                    Lights::remove_light(&mut *chunks, &voxel, &GREEN, &config, &registry);
                }
                if chunks.get_torch_light(vx, vy, vz, &BLUE) != 0 {
                    Lights::remove_light(&mut *chunks, &voxel, &BLUE, &config, &registry);
                }
            }
            // Otherwise, check if light could originally go from source to neighbor, but not in the updated block. Also, check
            // to see if neighbor light source is not zero and is less than the block itself, or if its sunlight and its going
            // downwards and both are max light levels.
            else {
                let mut remove_counts = 0;

                let light_data = [
                    (&SUNLIGHT, chunks.get_sunlight(vx, vy, vz)),
                    (&RED, chunks.get_red_light(vx, vy, vz)),
                    (&GREEN, chunks.get_green_light(vx, vy, vz)),
                    (&BLUE, chunks.get_blue_light(vx, vy, vz)),
                ];

                VOXEL_NEIGHBORS.iter().for_each(|&[ox, oy, oz]| {
                    let nvy = vy + oy;
                    if nvy < 0 || nvy >= max_height {
                        return;
                    }

                    let nvx = vx + ox;
                    let nvz = vz + oz;

                    let n_block = registry.get_block_by_id(chunks.get_voxel(nvx, nvy, nvz));
                    let n_transparency =
                        n_block.get_rotated_transparency(&chunks.get_voxel_rotation(nvx, nvy, nvz));

                    // See if light could originally go from source to neighbor, but not in the updated block. If not, move on.
                    if !(Lights::can_enter(&current_transparency, &n_transparency, ox, oy, oz)
                        && !Lights::can_enter(&updated_transparency, &n_transparency, ox, oy, oz))
                    {
                        return;
                    }

                    light_data.iter().for_each(|&(color, source_level)| {
                        let is_sunlight = *color == LightColor::Sunlight;

                        let n_level = if is_sunlight {
                            chunks.get_sunlight(nvx, nvy, nvz)
                        } else {
                            chunks.get_torch_light(nvx, nvy, nvz, color)
                        };

                        // See if neighbor level is less than self, or if sunlight is propagating downwards.
                        if n_level < source_level
                            || (oy == -1
                                && is_sunlight
                                && n_level == max_light_level
                                && source_level == max_light_level)
                        {
                            remove_counts += 1;
                            Lights::remove_light(
                                &mut *chunks,
                                &Vec3(nvx, nvy, nvz),
                                color,
                                &config,
                                &registry,
                            );
                        }
                    });
                });

                // If nothing happened with this semi-transparent block, treat it as opaque.
                if remove_counts == 0 {
                    if chunks.get_sunlight(vx, vy, vz) != 0 {
                        Lights::remove_light(&mut *chunks, &voxel, &SUNLIGHT, &config, &registry);
                    }
                    if chunks.get_torch_light(vx, vy, vz, &RED) != 0 {
                        Lights::remove_light(&mut *chunks, &voxel, &RED, &config, &registry);
                    }
                    if chunks.get_torch_light(vx, vy, vz, &GREEN) != 0 {
                        Lights::remove_light(&mut *chunks, &voxel, &GREEN, &config, &registry);
                    }
                    if chunks.get_torch_light(vx, vy, vz, &BLUE) != 0 {
                        Lights::remove_light(&mut *chunks, &voxel, &BLUE, &config, &registry);
                    }
                }
            }

            // Placing a light
            if updated_type.is_light {
                if updated_type.red_light_level > 0 {
                    chunks.set_torch_light(vx, vy, vz, updated_type.red_light_level, &RED);
                    red_flood.push_back(LightNode {
                        voxel: [voxel.0, voxel.1, voxel.2],
                        level: updated_type.red_light_level,
                    });
                }
                if updated_type.green_light_level > 0 {
                    chunks.set_torch_light(vx, vy, vz, updated_type.green_light_level, &GREEN);
                    green_flood.push_back(LightNode {
                        voxel: [voxel.0, voxel.1, voxel.2],
                        level: updated_type.green_light_level,
                    });
                }
                if updated_type.blue_light_level > 0 {
                    chunks.set_torch_light(vx, vy, vz, updated_type.blue_light_level, &BLUE);
                    blue_flood.push_back(LightNode {
                        voxel: [voxel.0, voxel.1, voxel.2],
                        level: updated_type.blue_light_level,
                    });
                }
            }
            // Solid block removed.
            else {
                // Check the six neighbors.
                VOXEL_NEIGHBORS.iter().for_each(|&[ox, oy, oz]| {
                    let nvy = vy + oy;

                    if nvy < 0 || nvy >= max_height {
                        return;
                    }

                    let nvx = vx + ox;
                    let nvz = vz + oz;

                    let n_block = registry.get_block_by_id(chunks.get_voxel(nvx, nvy, nvz));
                    let n_transparency =
                        n_block.get_rotated_transparency(&chunks.get_voxel_rotation(nvx, nvy, nvz));

                    let n_voxel = [nvx, nvy, nvz];

                    // See if light couldn't originally go from source to neighbor, but now can in the updated block. If not, move on.
                    if !(!Lights::can_enter(&current_transparency, &n_transparency, ox, oy, oz)
                        && Lights::can_enter(&updated_transparency, &n_transparency, ox, oy, oz))
                    {
                        return;
                    }

                    let level = chunks.get_sunlight(nvx, nvy, nvz);
                    if level != 0 {
                        sun_flood.push_back(LightNode {
                            voxel: n_voxel,
                            level,
                        })
                    }

                    let red_level = chunks.get_torch_light(nvx, nvy, nvz, &RED);
                    if red_level != 0 && n_block.is_light {
                        red_flood.push_back(LightNode {
                            voxel: n_voxel,
                            level: red_level,
                        })
                    }

                    let green_level = chunks.get_torch_light(nvx, nvy, nvz, &GREEN);
                    if green_level != 0 && n_block.is_light {
                        green_flood.push_back(LightNode {
                            voxel: n_voxel,
                            level: green_level,
                        })
                    }

                    let blue_level = chunks.get_torch_light(nvx, nvy, nvz, &BLUE);
                    if blue_level != 0 && n_block.is_light {
                        blue_flood.push_back(LightNode {
                            voxel: n_voxel,
                            level: blue_level,
                        })
                    }
                });
            }

            chunks
                .voxel_affected_chunks(vx, vy, vz)
                .into_iter()
                .for_each(|c| {
                    chunks.cache.insert(c);
                });

            results.push(UpdateProtocol {
                vx,
                vy,
                vz,
                voxel: 0,
                light: 0,
            })
        }

        if !red_flood.is_empty() {
            Lights::flood_light(
                &mut *chunks,
                red_flood,
                &RED,
                &registry,
                &config,
                None,
                None,
            );
        }

        if !green_flood.is_empty() {
            Lights::flood_light(
                &mut *chunks,
                green_flood,
                &GREEN,
                &registry,
                &config,
                None,
                None,
            );
        }

        if !blue_flood.is_empty() {
            Lights::flood_light(
                &mut *chunks,
                blue_flood,
                &BLUE,
                &registry,
                &config,
                None,
                None,
            );
        }

        if !sun_flood.is_empty() {
            Lights::flood_light(
                &mut *chunks,
                sun_flood,
                &SUNLIGHT,
                &registry,
                &config,
                None,
                None,
            );
        }

        let results = results
            .into_iter()
            .map(|mut update| {
                update.voxel = chunks.get_raw_voxel(update.vx, update.vy, update.vz);
                update.light = chunks.get_raw_light(update.vx, update.vy, update.vz);
                update
            })
            .collect::<Vec<UpdateProtocol>>();

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
                        let transparent = Mesher::mesh_space(&min, &max, &space, &registry, true);

                        (opaque, transparent, level)
                    })
                    .collect::<Vec<(Option<Geometry>, Option<Geometry>, i32)>>()
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
                    chunks.to_save.push_back(coords.clone());
                }

                chunks.to_send.push_front((coords, MessageType::Update));
            });
        }

        if !results.is_empty() {
            let new_message = Message::new(&MessageType::Update).updates(&results).build();
            message_queue.push((new_message, ClientFilter::All));
        }
    }
}
