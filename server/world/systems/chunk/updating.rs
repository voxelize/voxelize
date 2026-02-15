use std::{cmp::Reverse, collections::VecDeque};

use hashbrown::HashMap;
use nanoid::nanoid;
use specs::{Entities, LazyUpdate, ReadExpect, System, WorldExt, WriteExpect};

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

fn compute_flood_bounds(
    queue: &VecDeque<LightNode>,
    max_light_level: u32,
) -> Option<(Vec3<i32>, Vec3<usize>)> {
    if queue.is_empty() {
        return None;
    }

    let mut min_x = i64::from(queue[0].voxel[0]);
    let mut min_y = i64::from(queue[0].voxel[1]);
    let mut min_z = i64::from(queue[0].voxel[2]);
    let mut max_x = min_x;
    let mut max_y = min_y;
    let mut max_z = min_z;

    for node in queue.iter() {
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
    current_tick: u64,
    max_updates: usize,
) -> Vec<UpdateProtocol> {
    let max_light_level = config.max_light_level;
    let max_height = if config.max_height > i32::MAX as usize {
        None
    } else {
        Some(config.max_height as i32)
    };

    chunks.flush_staged_updates();

    if chunks.updates.is_empty() {
        return Vec::new();
    }

    let total_updates = chunks.updates.len();
    let num_to_process = max_updates.min(total_updates);
    let mut results = Vec::with_capacity(num_to_process);

    let mut updates_by_chunk: HashMap<Vec2<i32>, Vec<(Vec3<i32>, u32)>> =
        HashMap::with_capacity(num_to_process);

    for _ in 0..num_to_process {
        let (voxel, raw) = chunks.updates.pop_front().unwrap();
        let Vec3(vx, vy, vz) = voxel;

        let updated_id = BlockUtils::extract_id(raw);
        if vy < 0
            || max_height.is_some_and(|world_max_height| vy >= world_max_height)
            || !registry.has_type(updated_id)
        {
            continue;
        }

        let coords = ChunkUtils::map_voxel_to_chunk(vx, vy, vz, config.chunk_size);
        updates_by_chunk.entry(coords).or_default().push((voxel, raw));
    }

    let mut removed_light_sources = Vec::with_capacity(num_to_process);
    let mut processed_updates = Vec::with_capacity(num_to_process);

    for (coords, chunk_updates) in updates_by_chunk {
        if !chunks.is_chunk_ready(&coords) {
            for (voxel, raw) in chunk_updates.into_iter().rev() {
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
            for (voxel, raw) in chunk_updates.into_iter().rev() {
                chunks.updates.push_front((voxel, raw));
            }
            continue;
        }

        for (voxel, raw) in chunk_updates {
            let Vec3(vx, vy, vz) = voxel;
            let updated_id = BlockUtils::extract_id(raw);
            let current_id = chunks.get_voxel(vx, vy, vz);

            if registry.is_air(updated_id) && registry.is_air(current_id) {
                continue;
            }

            let current_type = registry.get_block_by_id(current_id);
            let updated_type = registry.get_block_by_id(updated_id);

            let current_is_light = current_type.is_light_at(&voxel, &*chunks);
            let updated_is_light = updated_type.is_light_at(&voxel, &*chunks);

            let rotation = BlockUtils::extract_rotation(raw);
            let stage = BlockUtils::extract_stage(raw);

            if !chunks.set_voxel(vx, vy, vz, updated_id) {
                continue;
            }
            chunks.set_voxel_stage(vx, vy, vz, stage);

            if current_is_light && !updated_is_light {
                removed_light_sources.push((voxel, current_id));
            }

            let existing_entity = chunks.block_entities.remove(&Vec3(vx, vy, vz));
            if let Some(existing_entity) = existing_entity {
                lazy.exec_mut(move |world| {
                    world
                        .delete_entity(existing_entity)
                        .expect("Failed to delete entity");
                });
            }

            if updated_type.is_entity {
                let entity = entities.create();
                chunks.block_entities.insert(Vec3(vx, vy, vz), entity);
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
                let default_json = updated_type.default_entity_json.as_deref().unwrap_or("{}");
                lazy.insert(entity, JsonComp::new(default_json));
            }

            if updated_type.is_active {
                let ticks = (&updated_type.active_ticker.as_ref().unwrap())(
                    Vec3(vx, vy, vz),
                    &*chunks,
                    registry,
                );
                chunks.mark_voxel_active(&Vec3(vx, vy, vz), schedule_active_tick(current_tick, ticks));
            }

            for [ox, oy, oz] in VOXEL_NEIGHBORS_WITH_STAIRS {
                let Some(nx) = vx.checked_add(ox) else {
                    continue;
                };
                let Some(ny) = vy.checked_add(oy) else {
                    continue;
                };
                let Some(nz) = vz.checked_add(oz) else {
                    continue;
                };

                let neighbor_id = chunks.get_voxel(nx, ny, nz);
                let neighbor_block = registry.get_block_by_id(neighbor_id);

                let should_activate = neighbor_block.is_active
                    && (neighbor_block.is_fluid || !registry.is_air(neighbor_id));

                if should_activate {
                    let ticks = (&neighbor_block.active_ticker.as_ref().unwrap())(
                        Vec3(nx, ny, nz),
                        &*chunks,
                        registry,
                    );
                    chunks.mark_voxel_active(
                        &Vec3(nx, ny, nz),
                        schedule_active_tick(current_tick, ticks),
                    );
                }
            }

            if updated_type.rotatable || updated_type.y_rotatable {
                chunks.set_voxel_rotation(vx, vy, vz, &rotation);
            }

            update_chunk_column_height_for_voxel_update(
                chunks, &registry, vx, vy, vz, updated_id,
            );

            for coords in chunks.voxel_affected_chunks(vx, vy, vz) {
                chunks.cache.insert(coords);
            }

            processed_updates.push((voxel, raw, current_id, updated_id));

            results.push(UpdateProtocol {
                vx,
                vy,
                vz,
                voxel: 0,
                light: 0,
            });
        }
    }

    let mut red_removals = Vec::with_capacity(removed_light_sources.len());
    let mut green_removals = Vec::with_capacity(removed_light_sources.len());
    let mut blue_removals = Vec::with_capacity(removed_light_sources.len());

    for (voxel, light_block_id) in &removed_light_sources {
        let light_block = registry.get_block_by_id(*light_block_id);
        let red_level = light_block.get_torch_light_level_at(voxel, &*chunks, &RED);
        let green_level = light_block.get_torch_light_level_at(voxel, &*chunks, &GREEN);
        let blue_level = light_block.get_torch_light_level_at(voxel, &*chunks, &BLUE);

        if red_level > 0 {
            red_removals.push(*voxel);
        }
        if green_level > 0 {
            green_removals.push(*voxel);
        }
        if blue_level > 0 {
            blue_removals.push(*voxel);
        }

        let Vec3(vx, vy, vz) = *voxel;
        if light_block.is_opaque && chunks.get_sunlight(vx, vy, vz) != 0 {
            Lights::remove_light(&mut *chunks, voxel, &SUNLIGHT, config, registry);
        }
    }

    if !red_removals.is_empty() {
        Lights::remove_lights(&mut *chunks, &red_removals, &RED, config, registry);
    }
    if !green_removals.is_empty() {
        Lights::remove_lights(&mut *chunks, &green_removals, &GREEN, config, registry);
    }
    if !blue_removals.is_empty() {
        Lights::remove_lights(&mut *chunks, &blue_removals, &BLUE, config, registry);
    }

    let mut red_flood = VecDeque::new();
    let mut green_flood = VecDeque::new();
    let mut blue_flood = VecDeque::new();
    let mut sun_flood = VecDeque::new();

    for (voxel, raw, current_id, updated_id) in processed_updates {
        let Vec3(vx, vy, vz) = voxel;

        let current_type = registry.get_block_by_id(current_id);
        let updated_type = registry.get_block_by_id(updated_id);

        let current_is_light = current_type.is_light_at(&voxel, &*chunks);
        let updated_is_light = updated_type.is_light_at(&voxel, &*chunks);
        let is_removed_light_source = current_is_light && !updated_is_light;

        if is_removed_light_source && !current_type.is_opaque {
            continue;
        }

        let rotation = BlockUtils::extract_rotation(raw);
        let current_transparency = current_type.get_rotated_transparency(&rotation);
        let updated_transparency = if updated_type.rotatable || updated_type.y_rotatable {
            updated_type.get_rotated_transparency(&rotation)
        } else {
            updated_type.is_transparent
        };

        if updated_type.is_opaque || updated_type.light_reduce {
            if chunks.get_sunlight(vx, vy, vz) != 0 {
                Lights::remove_light(&mut *chunks, &voxel, &SUNLIGHT, config, registry);
            }
            if chunks.get_torch_light(vx, vy, vz, &RED) != 0 {
                Lights::remove_light(&mut *chunks, &voxel, &RED, config, registry);
            }
            if chunks.get_torch_light(vx, vy, vz, &GREEN) != 0 {
                Lights::remove_light(&mut *chunks, &voxel, &GREEN, config, registry);
            }
            if chunks.get_torch_light(vx, vy, vz, &BLUE) != 0 {
                Lights::remove_light(&mut *chunks, &voxel, &BLUE, config, registry);
            }
        } else {
            let mut remove_counts = 0;

            let light_data = [
                (&SUNLIGHT, chunks.get_sunlight(vx, vy, vz)),
                (&RED, chunks.get_red_light(vx, vy, vz)),
                (&GREEN, chunks.get_green_light(vx, vy, vz)),
                (&BLUE, chunks.get_blue_light(vx, vy, vz)),
            ];

            for &[ox, oy, oz] in VOXEL_NEIGHBORS.iter() {
                let Some(nvy) = vy.checked_add(oy) else {
                    continue;
                };
                if nvy < 0 || max_height.is_some_and(|world_max_height| nvy >= world_max_height) {
                    continue;
                }

                let Some(nvx) = vx.checked_add(ox) else {
                    continue;
                };
                let Some(nvz) = vz.checked_add(oz) else {
                    continue;
                };

                let n_block = registry.get_block_by_id(chunks.get_voxel(nvx, nvy, nvz));
                let n_transparency =
                    n_block.get_rotated_transparency(&chunks.get_voxel_rotation(nvx, nvy, nvz));

                if !(Lights::can_enter(&current_transparency, &n_transparency, ox, oy, oz)
                    && !Lights::can_enter(&updated_transparency, &n_transparency, ox, oy, oz))
                {
                    continue;
                }

                for &(color, source_level) in light_data.iter() {
                    let is_sunlight = *color == LightColor::Sunlight;

                    let n_level = if is_sunlight {
                        chunks.get_sunlight(nvx, nvy, nvz)
                    } else {
                        chunks.get_torch_light(nvx, nvy, nvz, color)
                    };

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
                            config,
                            registry,
                        );
                    }
                }
            }

            if remove_counts == 0 {
                if chunks.get_sunlight(vx, vy, vz) != 0 {
                    Lights::remove_light(&mut *chunks, &voxel, &SUNLIGHT, config, registry);
                }
                if chunks.get_torch_light(vx, vy, vz, &RED) != 0 {
                    Lights::remove_light(&mut *chunks, &voxel, &RED, config, registry);
                }
                if chunks.get_torch_light(vx, vy, vz, &GREEN) != 0 {
                    Lights::remove_light(&mut *chunks, &voxel, &GREEN, config, registry);
                }
                if chunks.get_torch_light(vx, vy, vz, &BLUE) != 0 {
                    Lights::remove_light(&mut *chunks, &voxel, &BLUE, config, registry);
                }
            }
        }

        if updated_is_light {
            let red_level = updated_type.get_torch_light_level_at(&voxel, &*chunks, &RED);
            let green_level = updated_type.get_torch_light_level_at(&voxel, &*chunks, &GREEN);
            let blue_level = updated_type.get_torch_light_level_at(&voxel, &*chunks, &BLUE);

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

                if max_height.is_some_and(|world_max_height| nvy >= world_max_height) {
                    if Lights::can_enter(&ALL_TRANSPARENT, &updated_transparency, ox, -1, oz) {
                        sun_flood.push_back(LightNode {
                            voxel: [nvx, vy, nvz],
                            level: max_light_level,
                        })
                    }
                    continue;
                }

                let n_block = registry.get_block_by_id(chunks.get_voxel(nvx, nvy, nvz));
                let n_transparency =
                    n_block.get_rotated_transparency(&chunks.get_voxel_rotation(nvx, nvy, nvz));

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

    if !red_flood.is_empty() {
        let bounds = compute_flood_bounds(&red_flood, max_light_level);
        Lights::flood_light(
            &mut *chunks,
            red_flood,
            &RED,
            registry,
            config,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !green_flood.is_empty() {
        let bounds = compute_flood_bounds(&green_flood, max_light_level);
        Lights::flood_light(
            &mut *chunks,
            green_flood,
            &GREEN,
            registry,
            config,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !blue_flood.is_empty() {
        let bounds = compute_flood_bounds(&blue_flood, max_light_level);
        Lights::flood_light(
            &mut *chunks,
            blue_flood,
            &BLUE,
            registry,
            config,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !sun_flood.is_empty() {
        let bounds = compute_flood_bounds(&sun_flood, max_light_level);
        Lights::flood_light(
            &mut *chunks,
            sun_flood,
            &SUNLIGHT,
            registry,
            config,
            bounds.as_ref().map(|b| &b.0),
            bounds.as_ref().map(|b| &b.1),
        );
    }

    if !chunks.cache.is_empty() {
        let mut cache = std::mem::take(&mut chunks.cache);
        let mut processes = Vec::with_capacity(cache.len());
        for coords in cache.drain() {
            chunks.add_chunk_to_save(&coords, true);
            if !chunks.is_chunk_ready(&coords) {
                continue;
            }
            if mesher.has_chunk(&coords) {
                mesher.mark_for_remesh(&coords);
                continue;
            }
            let space = chunks
                .make_space(&coords, config.max_light_level as usize)
                .needs_height_maps()
                .needs_voxels()
                .needs_lights()
                .build();
            let chunk = chunks.raw(&coords).unwrap().to_owned();
            processes.push((chunk, space));
        }

        mesher.process(processes, &MessageType::Update, registry, config);
    }

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

        chunks.clear_cache();

        // Collect all due active voxels
        let mut due_voxels = Vec::with_capacity(chunks.active_voxel_heap.len().min(256));
        while let Some(Reverse(active)) = chunks.active_voxel_heap.peek() {
            if active.tick > current_tick {
                break;
            }
            let Reverse(active) = chunks.active_voxel_heap.pop().unwrap();
            if chunks.active_voxel_set.remove(&active.voxel).is_some() {
                due_voxels.push(active.voxel);
            }
        }

        // Sort by position for deterministic ordering when multiple voxels are due at the same tick
        if due_voxels.len() > 1 {
            due_voxels.sort_by(|a, b| (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)));
        }

        // Process active voxels sequentially with immediate state application.
        // After each active voxel queues its updates, we fully process those updates
        // so the next active voxel sees the updated world state.
        // This is required for correct cellular automaton behavior (e.g., water removal cascades).
        let mut all_results = Vec::with_capacity(due_voxels.len());

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

            let results = process_pending_updates(
                &mut chunks,
                &mut mesher,
                &lazy,
                &entities,
                &config,
                &registry,
                current_tick,
                max_updates_per_tick,
            );
            all_results.extend(results);
        }

        // Process any remaining updates (from non-active sources like player actions)
        let results = process_pending_updates(
            &mut chunks,
            &mut mesher,
            &lazy,
            &entities,
            &config,
            &registry,
            current_tick,
            max_updates_per_tick,
        );
        all_results.extend(results);

        if !all_results.is_empty() {
            let new_message = Message::new(&MessageType::Update)
                .updates(&all_results)
                .build();
            message_queue.push((new_message, ClientFilter::All));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::{compute_flood_bounds, schedule_active_tick};
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
}
