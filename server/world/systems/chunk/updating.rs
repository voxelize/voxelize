use std::{cmp::Reverse, collections::VecDeque};

use hashbrown::{hash_map::RawEntryMut, HashMap};
use log::warn;
use nanoid::nanoid;
use specs::{Entities, LazyUpdate, ReadExpect, System, WorldExt, WriteExpect};

use crate::world::generators::light_config;
use super::height_updates::update_chunk_column_height_for_voxel_update;
use crate::{
    BlockUtils, ChunkUtils, Chunks, ClientFilter, CurrentChunkComp, ETypeComp, EntityFlag, IDComp,
    JsonComp, LightColor, LightNode, Lights, Mesher, Message, MessageQueues, MessageType,
    MetadataComp, Registry, Stats, UpdateProtocol, Vec2, Vec3, VoxelAccess, VoxelComp, WorldConfig,
};

pub const VOXEL_NEIGHBORS: [[i32; 3]; 6] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
];

const VOXEL_NEIGHBORS_WITH_STAIRS: [[i32; 3]; 14] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0],
    [1, 1, 0],
    [1, -1, 0],
    [-1, 1, 0],
    [-1, -1, 0],
    [0, 1, 1],
    [0, -1, 1],
    [0, 1, -1],
    [0, -1, -1],
];

const RED: LightColor = LightColor::Red;
const GREEN: LightColor = LightColor::Green;
const BLUE: LightColor = LightColor::Blue;
const SUNLIGHT: LightColor = LightColor::Sunlight;
const ALL_TRANSPARENT: [bool; 6] = [true, true, true, true, true, true];

#[inline]
fn schedule_active_tick(current_tick: u64, delay: u64) -> u64 {
    current_tick.saturating_add(delay)
}

#[inline]
fn clamp_i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

#[inline]
fn clamp_i64_to_usize(value: i64) -> usize {
    if value <= 0 {
        0
    } else if value as u128 > usize::MAX as u128 {
        usize::MAX
    } else {
        value as usize
    }
}

#[inline]
fn normalized_chunk_size(chunk_size: usize) -> usize {
    chunk_size.max(1)
}

fn compute_flood_bounds(
    queue: &VecDeque<LightNode>,
    max_light_level: u32,
) -> Option<(Vec3<i32>, Vec3<usize>)> {
    let mut queue_iter = queue.iter();
    let first_node = queue_iter.next()?;
    let mut min_x = i64::from(first_node.voxel[0]);
    let mut min_y = i64::from(first_node.voxel[1]);
    let mut min_z = i64::from(first_node.voxel[2]);
    let mut max_x = min_x;
    let mut max_y = min_y;
    let mut max_z = min_z;

    for node in queue_iter {
        let [x, y, z] = node.voxel;
        let x = i64::from(x);
        let y = i64::from(y);
        let z = i64::from(z);
        if x < min_x {
            min_x = x;
        }
        if y < min_y {
            min_y = y;
        }
        if z < min_z {
            min_z = z;
        }
        if x > max_x {
            max_x = x;
        }
        if y > max_y {
            max_y = y;
        }
        if z > max_z {
            max_z = z;
        }
    }

    let expand = i64::from(max_light_level);
    min_x = min_x.saturating_sub(expand);
    min_z = min_z.saturating_sub(expand);
    max_x = max_x.saturating_add(expand);
    max_z = max_z.saturating_add(expand);

    let shape_x = clamp_i64_to_usize(max_x.saturating_sub(min_x).saturating_add(1));
    let shape_y = clamp_i64_to_usize(max_y.saturating_sub(min_y).saturating_add(1));
    let shape_z = clamp_i64_to_usize(max_z.saturating_sub(min_z).saturating_add(1));

    Some((
        Vec3(
            clamp_i64_to_i32(min_x),
            clamp_i64_to_i32(min_y),
            clamp_i64_to_i32(min_z),
        ),
        Vec3(shape_x, shape_y, shape_z),
    ))
}

fn process_pending_updates(
    chunks: &mut Chunks,
    mesher: &mut Mesher,
    lazy: &LazyUpdate,
    entities: &Entities,
    config: &WorldConfig,
    registry: &Registry,
    light_registry: &voxelize_lighter::LightRegistry,
    light_cfg: &voxelize_lighter::LightConfig,
    max_light_level: u32,
    max_height: Option<i32>,
    chunk_size: usize,
    current_tick: u64,
    max_updates: usize,
) -> Vec<UpdateProtocol> {
    let has_max_height_limit = max_height.is_some();
    let max_height_limit = max_height.unwrap_or(i32::MAX);

    chunks.flush_staged_updates();

    if chunks.updates.is_empty() {
        return Vec::new();
    }

    let total_updates = chunks.updates.len();
    let num_to_process = max_updates.min(total_updates);
    if num_to_process == 0 {
        return Vec::new();
    }
    let mut results: Option<Vec<UpdateProtocol>> = None;

    let mut updates_by_chunk: HashMap<Vec2<i32>, Vec<(Vec3<i32>, u32, u32, &crate::Block)>> =
        HashMap::with_capacity(num_to_process.min(128));
    let mut last_updated_id: Option<u32> = None;
    let mut last_updated_type: Option<&crate::Block> = None;

    for _ in 0..num_to_process {
        let Some((voxel, raw)) = chunks.updates.pop_front() else {
            break;
        };
        let Vec3(vx, vy, vz) = voxel;

        let updated_id = BlockUtils::extract_id(raw);
        if vy < 0 || (has_max_height_limit && vy >= max_height_limit) {
            continue;
        }
        let updated_type = if last_updated_id == Some(updated_id) {
            if let Some(updated_type) = last_updated_type {
                updated_type
            } else {
                continue;
            }
        } else {
            let Some(updated_type) = registry.get_known_block_by_id(updated_id) else {
                last_updated_id = Some(updated_id);
                last_updated_type = None;
                continue;
            };
            last_updated_id = Some(updated_id);
            last_updated_type = Some(updated_type);
            updated_type
        };

        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, chunk_size);
        match updates_by_chunk.raw_entry_mut().from_key(&coords) {
            RawEntryMut::Occupied(mut entry) => {
                entry
                    .get_mut()
                    .push((voxel, raw, updated_id, updated_type))
            }
            RawEntryMut::Vacant(entry) => {
                let mut chunk_updates = Vec::with_capacity(1);
                chunk_updates.push((voxel, raw, updated_id, updated_type));
                entry.insert(coords, chunk_updates);
            }
        }
    }
    if updates_by_chunk.is_empty() {
        return results.unwrap_or_default();
    }

    let removed_light_sources_initial_capacity = num_to_process.min(32);
    let processed_updates_initial_capacity = num_to_process.min(64);
    let results_initial_capacity = num_to_process.min(64);
    let mut removed_light_sources: Option<Vec<(Vec3<i32>, u32, u32, u32, bool)>> = None;
    let mut processed_updates: Option<Vec<(
        Vec3<i32>,
        Option<crate::BlockRotation>,
        &crate::Block,
        &crate::Block,
        bool,
        bool,
        bool,
        bool,
        bool,
        bool,
    )>> = None;

    for (coords, chunk_updates) in updates_by_chunk {
        if !chunks.is_chunk_ready(&coords) {
            for (voxel, raw, _, _) in chunk_updates.into_iter().rev() {
                chunks.updates.push_front((voxel, raw));
            }
            continue;
        }

        let mut neighbors_ready = true;
        if let Some((min_x, max_x, min_z, max_z)) = chunks.light_traversed_bounds(&coords) {
            'neighbors: for x in min_x..=max_x {
                for z in min_z..=max_z {
                    if !chunks.is_chunk_ready(&Vec2(x, z)) {
                        neighbors_ready = false;
                        break 'neighbors;
                    }
                }
            }
        } else {
            neighbors_ready = false;
        }

        if !neighbors_ready {
            for (voxel, raw, _, _) in chunk_updates.into_iter().rev() {
                chunks.updates.push_front((voxel, raw));
            }
            continue;
        }

        for (voxel, raw, updated_id, updated_type) in chunk_updates {
            let Vec3(vx, vy, vz) = voxel;
            let current_raw = chunks.get_raw_voxel(vx, vy, vz);
            if current_raw == raw {
                continue;
            }
            let current_id = BlockUtils::extract_id(current_raw);
            let current_type = if current_id == updated_id {
                updated_type
            } else {
                registry.get_block_by_id(current_id)
            };
            if updated_type.id == 0 && current_type.id == 0 {
                continue;
            }

            let needs_transparency =
                !updated_type.is_opaque && (!updated_type.light_reduce || current_type.is_opaque);
            let updated_rotatable = updated_type.rotatable || updated_type.y_rotatable;
            let current_rotatable =
                needs_transparency && (current_type.rotatable || current_type.y_rotatable);
            let rotation = if updated_rotatable || current_rotatable {
                Some(BlockUtils::extract_rotation(raw))
            } else {
                None
            };

            let current_has_dynamic_patterns = current_type.dynamic_patterns.is_some();
            let updated_has_dynamic_patterns = updated_type.dynamic_patterns.is_some();
            let current_is_light = if current_has_dynamic_patterns {
                current_type.is_light_at(&voxel, &*chunks)
            } else {
                current_type.is_light
            };
            let stored_updated_is_light = if updated_has_dynamic_patterns {
                false
            } else {
                updated_type.is_light
            };
            let updated_is_light_for_removal = if current_is_light {
                if updated_has_dynamic_patterns {
                    updated_type.is_light_at(&voxel, &*chunks)
                } else {
                    stored_updated_is_light
                }
            } else {
                false
            };
            let is_removed_light_source = current_is_light && !updated_is_light_for_removal;
            let removed_source_levels = if is_removed_light_source {
                if current_has_dynamic_patterns {
                    Some((
                        current_type.get_torch_light_level_at(&voxel, &*chunks, &RED),
                        current_type.get_torch_light_level_at(&voxel, &*chunks, &GREEN),
                        current_type.get_torch_light_level_at(&voxel, &*chunks, &BLUE),
                    ))
                } else {
                    Some((
                        current_type.red_light_level,
                        current_type.green_light_level,
                        current_type.blue_light_level,
                    ))
                }
            } else {
                None
            };

            if !chunks.set_voxel(vx, vy, vz, updated_id) {
                continue;
            }
            let stage = BlockUtils::extract_stage(raw);
            if stage != 0 {
                chunks.set_voxel_stage(vx, vy, vz, stage);
            }

            if let Some((red_level, green_level, blue_level)) = removed_source_levels {
                removed_light_sources
                    .get_or_insert_with(|| {
                        Vec::with_capacity(removed_light_sources_initial_capacity)
                    })
                    .push((
                        voxel,
                        red_level,
                        green_level,
                        blue_level,
                        current_type.is_opaque,
                    ));
            }

            let existing_entity = chunks.block_entities.remove(&voxel);
            if let Some(existing_entity) = existing_entity {
                lazy.exec_mut(move |world| {
                    if let Err(error) = world.delete_entity(existing_entity) {
                        warn!("Failed to delete existing block entity {:?}: {:?}", existing_entity, error);
                    }
                });
            }

            if updated_type.is_entity {
                let entity = entities.create();
                chunks.block_entities.insert(voxel, entity);
                lazy.insert(entity, IDComp::new(&nanoid!()));
                lazy.insert(entity, EntityFlag::default());
                let block_name = registry.get_name_by_id(updated_id);
                let normalized_block_name = block_name.strip_prefix("block::").unwrap_or(block_name);
                let mut entity_type = String::with_capacity(7 + normalized_block_name.len());
                entity_type.push_str("block::");
                entity_type.push_str(normalized_block_name);
                lazy.insert(entity, ETypeComp(entity_type, true));
                lazy.insert(entity, MetadataComp::new());
                lazy.insert(entity, VoxelComp::new(voxel.0, voxel.1, voxel.2));
                lazy.insert(entity, CurrentChunkComp::default());
                let default_json = updated_type.default_entity_json.as_deref().unwrap_or("{}");
                lazy.insert(entity, JsonComp::new(default_json));
            }

            if updated_type.is_active {
                if let Some(active_ticker) = updated_type.active_ticker.as_ref() {
                    let ticks = active_ticker(voxel, &*chunks, registry);
                    chunks.mark_voxel_active(
                        &voxel,
                        schedule_active_tick(current_tick, ticks),
                    );
                }
            }

            for [ox, oy, oz] in VOXEL_NEIGHBORS_WITH_STAIRS {
                let Some(nx) = vx.checked_add(ox) else {
                    continue;
                };
                let Some(ny) = vy.checked_add(oy) else {
                    continue;
                };
                if ny < 0 || (has_max_height_limit && ny >= max_height_limit) {
                    continue;
                }
                let Some(nz) = vz.checked_add(oz) else {
                    continue;
                };

                let neighbor_id = chunks.get_voxel(nx, ny, nz);
                if neighbor_id == 0 {
                    continue;
                }
                let neighbor_block = registry.get_block_by_id(neighbor_id);
                let should_activate = neighbor_block.is_active;

                if should_activate {
                    if let Some(active_ticker) = neighbor_block.active_ticker.as_ref() {
                        let neighbor_voxel = Vec3(nx, ny, nz);
                        let ticks = active_ticker(neighbor_voxel, &*chunks, registry);
                        chunks.mark_voxel_active(
                            &neighbor_voxel,
                            schedule_active_tick(current_tick, ticks),
                        );
                    }
                }
            }

            if updated_rotatable {
                if let Some(rotation) = rotation.as_ref() {
                    chunks.set_voxel_rotation(vx, vy, vz, rotation);
                }
            }

            update_chunk_column_height_for_voxel_update(
                chunks, &registry, vx, vy, vz, updated_id,
            );

            chunks.cache_voxel_affected_chunks(vx, vy, vz);

            processed_updates
                .get_or_insert_with(|| {
                    Vec::with_capacity(processed_updates_initial_capacity)
                })
                .push((
                    voxel,
                    rotation,
                    current_type,
                    updated_type,
                    stored_updated_is_light,
                    is_removed_light_source,
                    current_rotatable,
                    updated_rotatable,
                    needs_transparency,
                    updated_has_dynamic_patterns,
                ));

            results
                .get_or_insert_with(|| Vec::with_capacity(results_initial_capacity))
                .push(UpdateProtocol {
                    vx,
                    vy,
                    vz,
                    voxel: 0,
                    light: 0,
                });
        }
    }

    if processed_updates.is_none() {
        return results.unwrap_or_default();
    }

    let removed_light_source_count = removed_light_sources.as_ref().map_or(0, Vec::len);
    let removal_initial_capacity = removed_light_source_count.min(32);
    let mut red_removals: Option<Vec<Vec3<i32>>> = None;
    let mut green_removals: Option<Vec<Vec3<i32>>> = None;
    let mut blue_removals: Option<Vec<Vec3<i32>>> = None;

    if let Some(removed_light_sources) = removed_light_sources.as_ref() {
        for &(voxel, red_level, green_level, blue_level, is_opaque) in removed_light_sources {
            if red_level > 0 {
                red_removals
                    .get_or_insert_with(|| Vec::with_capacity(removal_initial_capacity))
                    .push(voxel);
            }
            if green_level > 0 {
                green_removals
                    .get_or_insert_with(|| Vec::with_capacity(removal_initial_capacity))
                    .push(voxel);
            }
            if blue_level > 0 {
                blue_removals
                    .get_or_insert_with(|| Vec::with_capacity(removal_initial_capacity))
                    .push(voxel);
            }

            let Vec3(vx, vy, vz) = voxel;
            if is_opaque && chunks.get_sunlight(vx, vy, vz) != 0 {
                Lights::remove_light_with_light_config(
                    &mut *chunks,
                    &voxel,
                    &SUNLIGHT,
                    light_registry,
                    light_cfg,
                );
            }
        }
    }

    if let Some(red_removals) = red_removals.as_ref() {
        Lights::remove_lights_with_light_config(
            &mut *chunks,
            red_removals,
            &RED,
            light_registry,
            light_cfg,
        );
    }
    if let Some(green_removals) = green_removals.as_ref() {
        Lights::remove_lights_with_light_config(
            &mut *chunks,
            green_removals,
            &GREEN,
            light_registry,
            light_cfg,
        );
    }
    if let Some(blue_removals) = blue_removals.as_ref() {
        Lights::remove_lights_with_light_config(
            &mut *chunks,
            blue_removals,
            &BLUE,
            light_registry,
            light_cfg,
        );
    }

    let mut red_flood = VecDeque::new();
    let mut green_flood = VecDeque::new();
    let mut blue_flood = VecDeque::new();
    let mut sun_flood = VecDeque::new();

    if let Some(processed_updates) = processed_updates {
        for (
            voxel,
            rotation,
            current_type,
            updated_type,
            stored_updated_is_light,
            is_removed_light_source,
            current_rotatable,
            updated_rotatable,
            needs_transparency,
            updated_has_dynamic_patterns,
        ) in processed_updates
        {
            let Vec3(vx, vy, vz) = voxel;
            let updated_is_light = if updated_has_dynamic_patterns {
                updated_type.is_light_at(&voxel, &*chunks)
            } else {
                stored_updated_is_light
            };

            if is_removed_light_source && !current_type.is_opaque {
                continue;
            }

            let (current_transparency, updated_transparency) = if needs_transparency {
                let current_transparency = if current_rotatable {
                    match rotation.as_ref() {
                        Some(rotation) => current_type.get_rotated_transparency(rotation),
                        None => current_type.is_transparent,
                    }
                } else {
                    current_type.is_transparent
                };
                let updated_transparency = if updated_rotatable {
                    match rotation.as_ref() {
                        Some(rotation) => updated_type.get_rotated_transparency(rotation),
                        None => updated_type.is_transparent,
                    }
                } else {
                    updated_type.is_transparent
                };
                (current_transparency, updated_transparency)
            } else {
                (current_type.is_transparent, updated_type.is_transparent)
            };

            if updated_type.is_opaque || updated_type.light_reduce {
                let sunlight_level = chunks.get_sunlight(vx, vy, vz);
                let red_level = chunks.get_red_light(vx, vy, vz);
                let green_level = chunks.get_green_light(vx, vy, vz);
                let blue_level = chunks.get_blue_light(vx, vy, vz);

                if sunlight_level != 0 {
                    Lights::remove_light_with_light_config(
                        &mut *chunks,
                        &voxel,
                        &SUNLIGHT,
                        light_registry,
                        light_cfg,
                    );
                }
                if red_level != 0 {
                    Lights::remove_light_with_light_config(
                        &mut *chunks,
                        &voxel,
                        &RED,
                        light_registry,
                        light_cfg,
                    );
                }
                if green_level != 0 {
                    Lights::remove_light_with_light_config(
                        &mut *chunks,
                        &voxel,
                        &GREEN,
                        light_registry,
                        light_cfg,
                    );
                }
                if blue_level != 0 {
                    Lights::remove_light_with_light_config(
                        &mut *chunks,
                        &voxel,
                        &BLUE,
                        light_registry,
                        light_cfg,
                    );
                }
            } else {
                let mut remove_counts = 0;
                let sunlight_level = chunks.get_sunlight(vx, vy, vz);
                let red_level = chunks.get_red_light(vx, vy, vz);
                let green_level = chunks.get_green_light(vx, vy, vz);
                let blue_level = chunks.get_blue_light(vx, vy, vz);

                let light_data = [
                    (None, sunlight_level),
                    (Some(&RED), red_level),
                    (Some(&GREEN), green_level),
                    (Some(&BLUE), blue_level),
                ];

                for &[ox, oy, oz] in VOXEL_NEIGHBORS.iter() {
                    let Some(nvy) = vy.checked_add(oy) else {
                        continue;
                    };
                    if nvy < 0 || (has_max_height_limit && nvy >= max_height_limit) {
                        continue;
                    }

                    let Some(nvx) = vx.checked_add(ox) else {
                        continue;
                    };
                    let Some(nvz) = vz.checked_add(oz) else {
                        continue;
                    };

                    let n_raw = chunks.get_raw_voxel(nvx, nvy, nvz);
                    let n_block = registry.get_block_by_id(BlockUtils::extract_id(n_raw));
                    let n_transparency = if n_block.rotatable || n_block.y_rotatable {
                        let n_rotation = BlockUtils::extract_rotation(n_raw);
                        n_block.get_rotated_transparency(&n_rotation)
                    } else {
                        n_block.is_transparent
                    };

                    if !(Lights::can_enter(&current_transparency, &n_transparency, ox, oy, oz)
                        && !Lights::can_enter(&updated_transparency, &n_transparency, ox, oy, oz))
                    {
                        continue;
                    }

                    let neighbor_voxel = Vec3(nvx, nvy, nvz);
                    for &(torch_color, source_level) in light_data.iter() {
                        if source_level == 0 {
                            continue;
                        }
                        let n_level = if let Some(color) = torch_color {
                            chunks.get_torch_light(nvx, nvy, nvz, color)
                        } else {
                            chunks.get_sunlight(nvx, nvy, nvz)
                        };

                        if n_level < source_level
                            || (oy == -1
                                && torch_color.is_none()
                                && n_level == max_light_level
                                && source_level == max_light_level)
                        {
                            remove_counts += 1;
                            let color = torch_color.unwrap_or(&SUNLIGHT);
                            Lights::remove_light_with_light_config(
                                &mut *chunks,
                                &neighbor_voxel,
                                color,
                                light_registry,
                                light_cfg,
                            );
                        }
                    }
                }

                if remove_counts == 0 {
                    if sunlight_level != 0 {
                        Lights::remove_light_with_light_config(
                            &mut *chunks,
                            &voxel,
                            &SUNLIGHT,
                            light_registry,
                            light_cfg,
                        );
                    }
                    if red_level != 0 {
                        Lights::remove_light_with_light_config(
                            &mut *chunks,
                            &voxel,
                            &RED,
                            light_registry,
                            light_cfg,
                        );
                    }
                    if green_level != 0 {
                        Lights::remove_light_with_light_config(
                            &mut *chunks,
                            &voxel,
                            &GREEN,
                            light_registry,
                            light_cfg,
                        );
                    }
                    if blue_level != 0 {
                        Lights::remove_light_with_light_config(
                            &mut *chunks,
                            &voxel,
                            &BLUE,
                            light_registry,
                            light_cfg,
                        );
                    }
                }
            }

            if updated_is_light {
                let (red_level, green_level, blue_level) = if updated_has_dynamic_patterns {
                    (
                        updated_type.get_torch_light_level_at(&voxel, &*chunks, &RED),
                        updated_type.get_torch_light_level_at(&voxel, &*chunks, &GREEN),
                        updated_type.get_torch_light_level_at(&voxel, &*chunks, &BLUE),
                    )
                } else {
                    (
                        updated_type.red_light_level,
                        updated_type.green_light_level,
                        updated_type.blue_light_level,
                    )
                };

                if red_level > 0 {
                    chunks.set_torch_light(vx, vy, vz, red_level, &RED);
                    red_flood.push_back(LightNode {
                        voxel: [voxel.0, voxel.1, voxel.2],
                        level: red_level,
                    });
                }
                if green_level > 0 {
                    chunks.set_torch_light(vx, vy, vz, green_level, &GREEN);
                    green_flood.push_back(LightNode {
                        voxel: [voxel.0, voxel.1, voxel.2],
                        level: green_level,
                    });
                }
                if blue_level > 0 {
                    chunks.set_torch_light(vx, vy, vz, blue_level, &BLUE);
                    blue_flood.push_back(LightNode {
                        voxel: [voxel.0, voxel.1, voxel.2],
                        level: blue_level,
                    });
                }
            } else if current_type.is_opaque && !updated_type.is_opaque {
                for &[ox, oy, oz] in VOXEL_NEIGHBORS.iter() {
                let Some(nvy) = vy.checked_add(oy) else {
                    continue;
                };
                let Some(nvx) = vx.checked_add(ox) else {
                    continue;
                };
                let Some(nvz) = vz.checked_add(oz) else {
                    continue;
                };

                if nvy < 0 {
                    continue;
                }

                if has_max_height_limit && nvy >= max_height_limit {
                    if Lights::can_enter(&ALL_TRANSPARENT, &updated_transparency, ox, -1, oz) {
                        sun_flood.push_back(LightNode {
                            voxel: [nvx, vy, nvz],
                            level: max_light_level,
                        })
                    }
                    continue;
                }

                    let n_raw = chunks.get_raw_voxel(nvx, nvy, nvz);
                    let n_block = registry.get_block_by_id(BlockUtils::extract_id(n_raw));
                    let n_transparency = if n_block.rotatable || n_block.y_rotatable {
                        let n_rotation = BlockUtils::extract_rotation(n_raw);
                        n_block.get_rotated_transparency(&n_rotation)
                    } else {
                        n_block.is_transparent
                    };

                    let n_voxel = [nvx, nvy, nvz];

                    if !Lights::can_enter(&current_transparency, &n_transparency, ox, oy, oz)
                        && Lights::can_enter(&updated_transparency, &n_transparency, ox, oy, oz)
                    {
                        let reduce = if updated_type.light_reduce { 1 } else { 0 };
                        let sun_val = chunks.get_sunlight(nvx, nvy, nvz);
                        if sun_val > reduce {
                            sun_flood.push_back(LightNode {
                                voxel: n_voxel,
                                level: sun_val - reduce,
                            })
                        }

                        if !is_removed_light_source {
                            let red_val = chunks.get_torch_light(nvx, nvy, nvz, &RED);
                            if red_val > reduce {
                                red_flood.push_back(LightNode {
                                    voxel: n_voxel,
                                    level: red_val - reduce,
                                })
                            }

                            let green_val = chunks.get_torch_light(nvx, nvy, nvz, &GREEN);
                            if green_val > reduce {
                                green_flood.push_back(LightNode {
                                    voxel: n_voxel,
                                    level: green_val - reduce,
                                })
                            }

                            let blue_val = chunks.get_torch_light(nvx, nvy, nvz, &BLUE);
                            if blue_val > reduce {
                                blue_flood.push_back(LightNode {
                                    voxel: n_voxel,
                                    level: blue_val - reduce,
                                })
                            }
                        }
                    }
                }
            }
        }
    }

    if !red_flood.is_empty() {
        let bounds = compute_flood_bounds(&red_flood, max_light_level);
        Lights::flood_light_with_light_config(
            &mut *chunks,
            red_flood,
            &RED,
            light_registry,
            light_cfg,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !green_flood.is_empty() {
        let bounds = compute_flood_bounds(&green_flood, max_light_level);
        Lights::flood_light_with_light_config(
            &mut *chunks,
            green_flood,
            &GREEN,
            light_registry,
            light_cfg,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !blue_flood.is_empty() {
        let bounds = compute_flood_bounds(&blue_flood, max_light_level);
        Lights::flood_light_with_light_config(
            &mut *chunks,
            blue_flood,
            &BLUE,
            light_registry,
            light_cfg,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !sun_flood.is_empty() {
        let bounds = compute_flood_bounds(&sun_flood, max_light_level);
        Lights::flood_light_with_light_config(
            &mut *chunks,
            sun_flood,
            &SUNLIGHT,
            light_registry,
            light_cfg,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !chunks.cache.is_empty() {
        let cache_capacity = chunks.cache.capacity();
        let mut cache = std::mem::replace(
            &mut chunks.cache,
            hashbrown::HashSet::with_capacity(cache_capacity),
        );
        let process_initial_capacity = cache.len().min(64);
        let mut processes = None;
        for coords in cache.drain() {
            chunks.add_chunk_to_save(&coords, true);
            if !chunks.is_chunk_ready(&coords) {
                continue;
            }
            if mesher.mark_for_remesh(&coords) {
                continue;
            }
            let space = chunks
                .make_space(&coords, config.max_light_level as usize)
                .needs_height_maps()
                .needs_voxels()
                .needs_lights()
                .build();
            let Some(chunk) = chunks.raw(&coords).cloned() else {
                continue;
            };
            processes
                .get_or_insert_with(|| Vec::with_capacity(process_initial_capacity))
                .push((chunk, space));
        }

        if let Some(processes) = processes {
            mesher.process(processes, &MessageType::Update, registry, config);
        }
    }

    let mut results = results.unwrap_or_default();
    for update in &mut results {
        update.voxel = chunks.get_raw_voxel(update.vx, update.vy, update.vz);
        update.light = chunks.get_raw_light(update.vx, update.vy, update.vz);
    }
    results
}

pub struct ChunkUpdatingSystem;

impl<'a> System<'a> for ChunkUpdatingSystem {
    type SystemData = (
        ReadExpect<'a, WorldConfig>,
        ReadExpect<'a, Registry>,
        ReadExpect<'a, Stats>,
        WriteExpect<'a, MessageQueues>,
        WriteExpect<'a, Chunks>,
        WriteExpect<'a, Mesher>,
        ReadExpect<'a, LazyUpdate>,
        Entities<'a>,
        ReadExpect<'a, crate::WorldTimingContext>,
    );

    fn run(&mut self, data: Self::SystemData) {
        let (
            config,
            registry,
            stats,
            mut message_queue,
            mut chunks,
            mut mesher,
            lazy,
            entities,
            timing,
        ) = data;
        let _t = timing.timer("chunk-updating");

        let current_tick = stats.tick as u64;
        let max_updates_per_tick = config.max_updates_per_tick;
        let max_light_level = config.max_light_level;
        let max_height = if config.max_height > i32::MAX as usize {
            None
        } else {
            Some(config.max_height as i32)
        };
        let chunk_size = normalized_chunk_size(config.chunk_size);
        let light_registry = registry.lighter_registry_ref().as_ref();
        let light_config = light_config(&config);

        chunks.clear_cache();
        if chunks.active_voxel_heap.is_empty()
            && chunks.updates_staging.is_empty()
            && chunks.updates.is_empty()
        {
            return;
        }

        // Collect all due active voxels
        let due_voxels_initial_capacity = chunks.active_voxel_heap.len().min(256);
        let mut due_voxels: Option<Vec<Vec3<i32>>> = None;
        while let Some(Reverse(active)) = chunks.active_voxel_heap.peek() {
            if active.tick > current_tick {
                break;
            }
            let Some(Reverse(active)) = chunks.active_voxel_heap.pop() else {
                break;
            };
            if chunks.active_voxel_set.remove(&active.voxel).is_some() {
                due_voxels
                    .get_or_insert_with(|| Vec::with_capacity(due_voxels_initial_capacity))
                    .push(active.voxel);
            }
        }

        // Sort by position for deterministic ordering when multiple voxels are due at the same tick
        if let Some(due_voxels) = due_voxels.as_mut() {
            if due_voxels.len() > 1 {
                due_voxels.sort_unstable_by(|a, b| {
                    a.0
                        .cmp(&b.0)
                        .then_with(|| a.1.cmp(&b.1))
                        .then_with(|| a.2.cmp(&b.2))
                });
            }
        }

        // Process active voxels sequentially with immediate state application.
        // After each active voxel queues its updates, we fully process those updates
        // so the next active voxel sees the updated world state.
        // This is required for correct cellular automaton behavior (e.g., water removal cascades).
        let mut all_results: Option<Vec<UpdateProtocol>> = None;

        if let Some(due_voxels) = due_voxels.as_ref() {
            for voxel in due_voxels.iter() {
                let Vec3(vx, vy, vz) = *voxel;
                let id = chunks.get_voxel(vx, vy, vz);
                let block = registry.get_block_by_id(id);

                if let Some(updater) = &block.active_updater {
                    let updates = updater(Vec3(vx, vy, vz), &*chunks, &registry);
                    for (pos, val) in updates {
                        chunks.update_voxel(&pos, val);
                    }
                }
                if chunks.updates_staging.is_empty() && chunks.updates.is_empty() {
                    continue;
                }

                let mut results = process_pending_updates(
                    &mut chunks,
                    &mut mesher,
                    &lazy,
                    &entities,
                    &config,
                    &registry,
                    light_registry,
                    &light_config,
                    max_light_level,
                    max_height,
                    chunk_size,
                    current_tick,
                    max_updates_per_tick,
                );
                if results.is_empty() {
                    continue;
                }
                if let Some(all_results) = all_results.as_mut() {
                    all_results.append(&mut results);
                } else {
                    all_results = Some(results);
                }
            }
        }

        // Process any remaining updates (from non-active sources like player actions)
        if !chunks.updates_staging.is_empty() || !chunks.updates.is_empty() {
            let mut results = process_pending_updates(
                &mut chunks,
                &mut mesher,
                &lazy,
                &entities,
                &config,
                &registry,
                light_registry,
                &light_config,
                max_light_level,
                max_height,
                chunk_size,
                current_tick,
                max_updates_per_tick,
            );
            if !results.is_empty() {
                if let Some(all_results) = all_results.as_mut() {
                    all_results.append(&mut results);
                } else {
                    all_results = Some(results);
                }
            }
        }

        if let Some(all_results) = all_results {
            let new_message = if all_results.len() == 1 {
                let mut all_results = all_results;
                let Some(single_update) = all_results.pop() else {
                    return;
                };
                Message::new(&MessageType::Update)
                    .update_owned(single_update)
                    .build()
            } else {
                Message::new(&MessageType::Update)
                    .updates_owned(all_results)
                    .build()
            };
            message_queue.push((new_message, ClientFilter::All));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::{compute_flood_bounds, normalized_chunk_size, schedule_active_tick};
    use crate::{LightNode, Vec3};

    #[test]
    fn schedule_active_tick_saturates_on_overflow() {
        assert_eq!(schedule_active_tick(u64::MAX - 1, 10), u64::MAX);
    }

    #[test]
    fn schedule_active_tick_preserves_non_overflow_sum() {
        assert_eq!(schedule_active_tick(100, 25), 125);
    }

    #[test]
    fn compute_flood_bounds_returns_none_for_empty_queues() {
        let queue = VecDeque::new();
        assert_eq!(compute_flood_bounds(&queue, 15), None);
    }

    #[test]
    fn compute_flood_bounds_clamps_extreme_expansion_without_wrapping() {
        let queue = VecDeque::from([LightNode {
            voxel: [i32::MAX, i32::MAX, i32::MAX],
            level: 15,
        }]);

        let bounds = compute_flood_bounds(&queue, u32::MAX).expect("bounds should exist");
        assert_eq!(bounds.0, Vec3(i32::MIN, i32::MAX, i32::MIN));
        assert!(bounds.1.0 > i32::MAX as usize);
        assert_eq!(bounds.1.1, 1);
        assert!(bounds.1.2 > i32::MAX as usize);
    }

    #[test]
    fn normalized_chunk_size_guards_zero() {
        assert_eq!(normalized_chunk_size(0), 1);
        assert_eq!(normalized_chunk_size(32), 32);
    }
}
