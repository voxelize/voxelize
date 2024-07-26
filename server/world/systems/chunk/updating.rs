use std::collections::VecDeque;

use log::info;
use nanoid::nanoid;
use rayon::prelude::{IntoParallelIterator, ParallelIterator};
use specs::{Entities, LazyUpdate, ReadExpect, System, WorldExt, WriteExpect};

use crate::{
    BlockUtils, ChunkUtils, Chunks, ClientFilter, CollisionsComp, CurrentChunkComp, ETypeComp,
    EntityFlag, IDComp, JsonComp, LightColor, LightNode, Lights, Mesher, Message, MessageQueue,
    MessageType, MetadataComp, Registry, Stats, UpdateProtocol, Vec2, Vec3, VoxelAccess, VoxelComp,
    VoxelUpdate, WorldConfig,
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
const ALL_TRANSPARENT: [bool; 6] = [true, true, true, true, true, true];

pub struct ChunkUpdatingSystem;

impl<'a> System<'a> for ChunkUpdatingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, Stats>,
        WriteExpect<'a, MessageQueue>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, Mesher>,
        ReadExpect<'a, LazyUpdate>,
        Entities<'a>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            config,
            registry,
            stats,
            mut message_queue,
            mut chunks,
            mut mesher,
            mut lazy,
            mut entities,
        ) = data;

        let current_tick = stats.tick as u64;
        let max_height = config.max_height as i32;
        let max_light_level = config.max_light_level;
        let max_updates_per_tick = config.max_updates_per_tick;

        chunks.clear_cache();

        let mut results = vec![];

        let mut red_flood = VecDeque::default();
        let mut green_flood = VecDeque::default();
        let mut blue_flood = VecDeque::default();
        let mut sun_flood = VecDeque::default();

        if !chunks.updates.is_empty() {
            let mut updates = VecDeque::default();
            let total_updates = chunks.updates.len();

            for _ in 0..max_updates_per_tick.min(total_updates) {
                updates.push_back(chunks.updates.pop_front().unwrap());
            }

            while let Some((voxel, raw)) = updates.pop_front() {
                let Vec3(vx, vy, vz) = voxel;

                let updated_id = BlockUtils::extract_id(raw);
                let rotation = BlockUtils::extract_rotation(raw);
                let stage = BlockUtils::extract_stage(raw);
                let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, config.chunk_size);

                if vy < 0 || vy >= config.max_height as i32 || !registry.has_type(updated_id) {
                    continue;
                }

                if !chunks.is_chunk_ready(&coords) {
                    continue;
                }

                if mesher.map.contains(&coords) {
                    chunks.update_voxel(&voxel, raw);
                    continue;
                }

                let mut ready = true;

                for neighbor in chunks.light_traversed_chunks(&coords) {
                    if ready && !chunks.is_chunk_ready(&neighbor) {
                        ready = false;
                    }
                }

                if !ready {
                    chunks.update_voxel(&voxel, raw);
                    continue;
                }

                let current_id = chunks.get_voxel(vx, vy, vz);
                if registry.is_air(updated_id) && registry.is_air(current_id) {
                    continue;
                }

                // Actually updating the voxel.
                let height = chunks.get_max_height(vx, vz);

                let current_type = registry.get_block_by_id(current_id);
                let updated_type = registry.get_block_by_id(updated_id);

                let existing_entity = chunks.block_entities.remove(&Vec3(vx, vy, vz));
                if let Some(existing_entity) = existing_entity {
                    lazy.exec_mut(move |world| {
                        world
                            .delete_entity(existing_entity)
                            .expect("Failed to delete entity");
                    });
                }

                // need to add an entity
                if updated_type.is_entity {
                    let entity = entities.create();
                    chunks.block_entities.insert(voxel.clone(), entity);
                    lazy.insert(entity, IDComp::new(&nanoid!()));
                    lazy.insert(entity, EntityFlag::default());
                    lazy.insert(
                        entity,
                        ETypeComp::new(
                            &format!(
                                "block::{}",
                                &updated_type
                                    .name
                                    .to_lowercase()
                                    .trim_start_matches("block::")
                            ),
                            true,
                        ),
                    );
                    lazy.insert(entity, MetadataComp::new());
                    lazy.insert(entity, VoxelComp::new(voxel.0, voxel.1, voxel.2));
                    lazy.insert(entity, CurrentChunkComp::default());
                    lazy.insert(entity, JsonComp::new("{}"));
                }

                let current_transparency = current_type.get_rotated_transparency(&rotation);
                let updated_transparency = if updated_type.rotatable || updated_type.y_rotatable {
                    updated_type.get_rotated_transparency(&rotation)
                } else {
                    updated_type.is_transparent
                };

                chunks.set_voxel(vx, vy, vz, updated_id);

                if stage != 0 {
                    chunks.set_voxel_stage(vx, vy, vz, stage);
                }

                if updated_type.is_active {
                    let ticks = (&updated_type.active_ticker.as_ref().unwrap())(
                        Vec3(vx, vy, vz),
                        &*chunks,
                        &registry,
                    );
                    chunks.mark_voxel_active(&Vec3(vx, vy, vz), ticks + current_tick);
                }

                if updated_type.rotatable || updated_type.y_rotatable {
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
                if updated_type.is_opaque || updated_type.light_reduce {
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
                        let n_transparency = n_block
                            .get_rotated_transparency(&chunks.get_voxel_rotation(nvx, nvy, nvz));

                        // See if light could originally go from source to neighbor, but not in the updated block. If not, move on.
                        if !(Lights::can_enter(&current_transparency, &n_transparency, ox, oy, oz)
                            && !Lights::can_enter(
                                &updated_transparency,
                                &n_transparency,
                                ox,
                                oy,
                                oz,
                            ))
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
                            Lights::remove_light(
                                &mut *chunks,
                                &voxel,
                                &SUNLIGHT,
                                &config,
                                &registry,
                            );
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

                        if nvy < 0 {
                            return;
                        }

                        // Sunlight should propagate downwards here.
                        if nvy >= max_height {
                            // Light can go downwards into this block.
                            if Lights::can_enter(
                                &ALL_TRANSPARENT,
                                &updated_transparency,
                                ox,
                                -1,
                                oz,
                            ) {
                                sun_flood.push_back(LightNode {
                                    voxel: [vx + ox, vy, vz + oz],
                                    level: max_light_level,
                                })
                            }

                            return;
                        }

                        let nvx = vx + ox;
                        let nvz = vz + oz;

                        let n_block = registry.get_block_by_id(chunks.get_voxel(nvx, nvy, nvz));
                        let n_transparency = n_block
                            .get_rotated_transparency(&chunks.get_voxel_rotation(nvx, nvy, nvz));

                        let n_voxel = [nvx, nvy, nvz];

                        // See if light couldn't originally go from source to neighbor, but now can in the updated block. If not, move on.
                        if !(n_block.has_torch_light())
                            && !(!Lights::can_enter(
                                &current_transparency,
                                &n_transparency,
                                ox,
                                oy,
                                oz,
                            ) && Lights::can_enter(
                                &updated_transparency,
                                &n_transparency,
                                ox,
                                oy,
                                oz,
                            ))
                        {
                            return;
                        }

                        let level = chunks.get_sunlight(nvx, nvy, nvz)
                            - if updated_type.light_reduce { 1 } else { 0 };
                        if level != 0 {
                            sun_flood.push_back(LightNode {
                                voxel: n_voxel,
                                level,
                            })
                        }

                        let red_level = chunks.get_torch_light(nvx, nvy, nvz, &RED)
                            - if updated_type.light_reduce { 1 } else { 0 };
                        if red_level != 0 {
                            red_flood.push_back(LightNode {
                                voxel: n_voxel,
                                level: red_level,
                            })
                        }

                        let green_level = chunks.get_torch_light(nvx, nvy, nvz, &GREEN)
                            - if updated_type.light_reduce { 1 } else { 0 };
                        if green_level != 0 {
                            green_flood.push_back(LightNode {
                                voxel: n_voxel,
                                level: green_level,
                            })
                        }

                        let blue_level = chunks.get_torch_light(nvx, nvy, nvz, &BLUE)
                            - if updated_type.light_reduce { 1 } else { 0 };
                        if blue_level != 0 {
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
                });
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

            if !chunks.cache.is_empty() {
                let cache = chunks.cache.drain().collect::<Vec<Vec2<i32>>>();

                cache.iter().for_each(|coords| {
                    chunks.add_chunk_to_save(coords, true);
                });

                let processes = cache
                    .into_iter()
                    .filter(|coords| chunks.is_chunk_ready(coords))
                    .map(|coords| {
                        let space = chunks
                            .make_space(&coords, config.max_light_level as usize)
                            .needs_height_maps()
                            .needs_voxels()
                            .needs_lights()
                            .build();
                        let chunk = chunks.raw(&coords).unwrap().to_owned();

                        return (chunk, space);
                    })
                    .collect::<Vec<_>>();

                mesher.process(processes, &MessageType::Update, &registry, &config);
            }

            let results = results
                .into_iter()
                .map(|mut update| {
                    update.voxel = chunks.get_raw_voxel(update.vx, update.vy, update.vz);
                    update.light = chunks.get_raw_light(update.vx, update.vy, update.vz);
                    update
                })
                .collect::<Vec<UpdateProtocol>>();

            if !results.is_empty() {
                let new_message = Message::new(&MessageType::Update).updates(&results).build();
                message_queue.push((new_message, ClientFilter::All));
            }
        }

        let active_voxels = chunks.active_voxels.clone();

        let active_voxels: Vec<(Option<(u64, Vec3<i32>)>, Vec<VoxelUpdate>)> = active_voxels
            .into_par_iter()
            .map(|(active_at, voxel)| {
                if active_at > current_tick {
                    return (Some((active_at, voxel)), vec![]);
                }

                let Vec3(vx, vy, vz) = voxel;
                let id = chunks.get_voxel(vx, vy, vz);
                let block = registry.get_block_by_id(id);

                if block.active_updater.is_none() {
                    return (None, vec![]);
                }

                let updates = (&block.active_updater.as_ref().unwrap())(
                    Vec3(vx, vy, vz),
                    &*chunks,
                    &registry,
                );

                (None, updates)
            })
            .collect();

        let active_voxels: Vec<(u64, Vec3<i32>)> = active_voxels
            .into_iter()
            .filter_map(|(active_at, updates)| {
                if !updates.is_empty() {
                    chunks.update_voxels(&updates);
                }

                if let Some((active_at, voxel)) = active_at {
                    return Some((active_at, voxel));
                }

                None
            })
            .collect();

        chunks.active_voxels = active_voxels;
    }
}
