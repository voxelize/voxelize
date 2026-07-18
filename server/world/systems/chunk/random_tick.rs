//! Minecraft-style subchunk random-tick sampler.
//!
//! Each world tick, for every **loaded + interested** chunk that is `Ready`,
//! each 16x16x(section_height) subchunk section samples
//! [`WorldConfig::random_tick_speed`] random positions (MC default: 3).
//! If the block at that position is `is_random_tickable` and has an
//! `active_updater`, it is scheduled via [`Chunks::mark_voxel_active`] at the
//! **current tick** (earliest-deadline upsert) so the existing active queue
//! runs the updater -- no Town-side full plant scan.
//!
//! Budget: total samples across all sections in one tick are capped by
//! [`WorldConfig::max_random_ticks_per_tick`]. The scheduled
//! `active_voxel_heap` always runs in `ChunkUpdatingSystem` independently;
//! this sampler only *enqueues* work and cannot starve copper neighbor updates.
//!
//! Sampling is deterministic given `(seed, tick, chunk_x, chunk_z, section)`.

use crate::{ChunkInterests, ChunkStatus, Chunks, Registry, Vec2, Vec3, VoxelAccess, WorldConfig};

/// Run one random-tick pass. Returns how many samples were taken (not how
/// many blocks actually opted in / were marked active).
pub fn sample_random_ticks(
    chunks: &mut Chunks,
    registry: &Registry,
    interests: &ChunkInterests,
    config: &WorldConfig,
    current_tick: u64,
) -> usize {
    let speed = config.random_tick_speed;
    if speed == 0 {
        return 0;
    }

    let budget = config.max_random_ticks_per_tick;
    if budget == 0 {
        return 0;
    }

    let chunk_size = config.chunk_size;
    let max_height = config.max_height;
    let sub_chunks = config.sub_chunks.max(1);
    let section_height = max_height / sub_chunks;
    if section_height == 0 || chunk_size == 0 {
        return 0;
    }

    let seed = config.seed;
    let mut samples_taken = 0usize;

    // Snapshot interested coords so we do not hold a borrow across mutation.
    let interested: Vec<Vec2<i32>> = interests.map.keys().cloned().collect();

    for coords in interested {
        if samples_taken >= budget {
            break;
        }
        if !chunks.is_chunk_ready(&coords) {
            continue;
        }
        // Confirm still Ready (is_chunk_ready already checks) and present.
        let Some(chunk) = chunks.raw(&coords) else {
            continue;
        };
        if chunk.status != ChunkStatus::Ready {
            continue;
        }

        let min = chunk.min.clone();
        // Drop chunk borrow before mark_voxel_active.
        drop(chunk);

        for section in 0..sub_chunks {
            if samples_taken >= budget {
                break;
            }
            let remaining = budget - samples_taken;
            let n = speed.min(remaining);
            for i in 0..n {
                let (lx, ly_local, lz) =
                    sample_position(seed, current_tick, coords.0, coords.1, section as u32, i as u32, chunk_size, section_height);
                let vx = min.0 + lx as i32;
                let vy = (section * section_height + ly_local) as i32;
                let vz = min.2 + lz as i32;

                samples_taken += 1;

                let id = chunks.get_voxel(vx, vy, vz);
                if id == 0 {
                    continue;
                }
                let block = registry.get_block_by_id(id);
                if !block.is_random_tickable || !block.is_active {
                    continue;
                }
                // Schedule at current tick so the same ChunkUpdatingSystem pass
                // (or the next pop) can run the updater. Earliest-deadline
                // upsert means a copper neighbor wake still wins if sooner.
                chunks.mark_voxel_active(&Vec3(vx, vy, vz), current_tick);
            }
        }
    }

    samples_taken
}

/// Deterministic local position inside a section.
/// Returns (local_x, local_y_in_section, local_z).
pub fn sample_position(
    seed: u32,
    tick: u64,
    cx: i32,
    cz: i32,
    section: u32,
    sample_index: u32,
    chunk_size: usize,
    section_height: usize,
) -> (usize, usize, usize) {
    // SplitMix64-ish mix; stable across platforms (no HashMap iteration).
    let mut state = mix64(
        seed as u64
            ^ tick.wrapping_mul(0x9E37_79B9_7F4A_7C15)
            ^ ((cx as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F))
            ^ ((cz as u64).wrapping_mul(0x1656_67B1_9E37_79F9))
            ^ ((section as u64) << 32)
            ^ (sample_index as u64).wrapping_mul(0x85EB_CA77_C2B2_AE63),
    );
    let x = (state as usize) % chunk_size;
    state = mix64(state);
    let y = (state as usize) % section_height;
    state = mix64(state);
    let z = (state as usize) % chunk_size;
    let _ = state;
    (x, y, z)
}

fn mix64(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Block, BlockUtils, Chunk, ChunkOptions, WorldConfig};

    fn ready_chunk(cx: i32, cz: i32, size: usize, max_height: usize, sub_chunks: usize) -> Chunk {
        let mut chunk = Chunk::new(
            "test",
            cx,
            cz,
            &ChunkOptions {
                size,
                max_height,
                sub_chunks,
            },
        );
        chunk.status = ChunkStatus::Ready;
        chunk
    }

    fn growth_block(id: u32) -> Block {
        Block::new("Test Crop")
            .id(id)
            .is_plant(true)
            .is_random_tickable(true)
            .active_fn(
                |_, _, _| 0,
                move |voxel, _, _| {
                    // Bump stage bit via raw rewrite marker: set id+0 stays,
                    // return a no-op-looking update that tests can observe by
                    // checking mark_voxel_active was called (deadline set).
                    let _ = voxel;
                    vec![]
                },
            )
            .build()
    }

    #[test]
    fn sample_position_is_deterministic() {
        let a = sample_position(123, 10, 0, 0, 0, 0, 16, 16);
        let b = sample_position(123, 10, 0, 0, 0, 0, 16, 16);
        assert_eq!(a, b);
        let c = sample_position(123, 11, 0, 0, 0, 0, 16, 16);
        assert_ne!(a, c);
    }

    #[test]
    fn random_tick_marks_opt_in_block_in_interested_ready_chunk() {
        let config = WorldConfig::new()
            .chunk_size(16)
            .max_height(16)
            .sub_chunks(1)
            .random_tick_speed(16 * 16 * 16) // sample entire section eventually within budget
            .max_random_ticks_per_tick(16 * 16 * 16)
            .seed(1)
            .build();

        let mut registry = Registry::new();
        let crop = growth_block(42);
        registry.register_block(&crop);

        let mut chunks = Chunks::new(&config);
        let mut chunk = ready_chunk(0, 0, 16, 16, 1);
        // Place crop at a known local cell; with full-section sampling it will
        // be hit within one pass when speed == volume.
        let vx = 3;
        let vy = 4;
        let vz = 5;
        let raw = BlockUtils::insert_id(0, 42);
        assert!(chunk.set_raw_voxel(vx, vy, vz, raw));
        chunks.add(chunk);

        let mut interests = ChunkInterests::new();
        interests.add("tester", &Vec2(0, 0));

        let taken = sample_random_ticks(&mut chunks, &registry, &interests, &config, 7);
        assert_eq!(taken, 16 * 16 * 16);
        assert_eq!(
            chunks.active_voxel_deadline(&Vec3(vx, vy, vz)),
            Some(7),
            "opt-in crop in loaded interested chunk must be scheduled at current tick"
        );
    }

    #[test]
    fn random_tick_skips_chunks_without_interest() {
        let config = WorldConfig::new()
            .chunk_size(16)
            .max_height(16)
            .sub_chunks(1)
            .random_tick_speed(64)
            .max_random_ticks_per_tick(64)
            .seed(1)
            .build();

        let mut registry = Registry::new();
        registry.register_block(&growth_block(42));

        let mut chunks = Chunks::new(&config);
        let mut chunk = ready_chunk(0, 0, 16, 16, 1);
        let raw = BlockUtils::insert_id(0, 42);
        assert!(chunk.set_raw_voxel(1, 1, 1, raw));
        chunks.add(chunk);

        let interests = ChunkInterests::new(); // no interest
        let taken = sample_random_ticks(&mut chunks, &registry, &interests, &config, 1);
        assert_eq!(taken, 0);
        assert!(chunks.active_voxel_deadline(&Vec3(1, 1, 1)).is_none());
    }

    #[test]
    fn random_tick_budget_caps_samples() {
        let config = WorldConfig::new()
            .chunk_size(16)
            .max_height(16)
            .sub_chunks(1)
            .random_tick_speed(100)
            .max_random_ticks_per_tick(7)
            .seed(1)
            .build();

        let registry = Registry::new();
        let mut chunks = Chunks::new(&config);
        chunks.add(ready_chunk(0, 0, 16, 16, 1));
        let mut interests = ChunkInterests::new();
        interests.add("tester", &Vec2(0, 0));

        let taken = sample_random_ticks(&mut chunks, &registry, &interests, &config, 1);
        assert_eq!(taken, 7);
    }

    #[test]
    fn non_random_tickable_active_block_not_marked() {
        let config = WorldConfig::new()
            .chunk_size(16)
            .max_height(16)
            .sub_chunks(1)
            .random_tick_speed(16 * 16 * 16)
            .max_random_ticks_per_tick(16 * 16 * 16)
            .seed(1)
            .build();

        let mut registry = Registry::new();
        // Active but NOT random_tickable (copper-like).
        let wire = Block::new("Wire")
            .id(99)
            .active_fn(|_, _, _| 1, |_, _, _| vec![])
            .build();
        assert!(wire.is_active);
        assert!(!wire.is_random_tickable);
        registry.register_block(&wire);

        let mut chunks = Chunks::new(&config);
        let mut chunk = ready_chunk(0, 0, 16, 16, 1);
        assert!(chunk.set_raw_voxel(2, 2, 2, BlockUtils::insert_id(0, 99)));
        chunks.add(chunk);
        let mut interests = ChunkInterests::new();
        interests.add("tester", &Vec2(0, 0));

        sample_random_ticks(&mut chunks, &registry, &interests, &config, 3);
        assert!(chunks.active_voxel_deadline(&Vec3(2, 2, 2)).is_none());
    }
}
