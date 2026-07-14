//! Placing water after generation must attenuate voxel sunlight exactly like
//! water that existed at generation time, and draining it must restore the
//! pre-water field. These tests drive the same light-engine entry points the
//! chunk updating system uses: one batched `remove_lights` per color over
//! every placed voxel, re-flooding from the genuinely lit fringe.

use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, LightColor, Lights, Registry, Vec2, Vec3, VoxelAccess,
    WorldConfig,
};

const STONE: u32 = 1;
const WATER: u32 = 2;

const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 64;

const WATER_MIN: i32 = 2;
const WATER_MAX: i32 = 13;
const WATER_BOTTOM: i32 = 1;
const WATER_TOP: i32 = 40;

fn create_registry() -> Registry {
    let mut registry = Registry::new();

    registry.register_block(&Block::new("stone").id(STONE).build());
    registry.register_block(
        &Block::new("water")
            .id(WATER)
            .is_transparent(true)
            .is_passable(true)
            .light_reduce(true)
            .build(),
    );

    registry
}

fn create_config() -> WorldConfig {
    WorldConfig {
        chunk_size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        max_light_level: 15,
        sub_chunks: 4,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        ..Default::default()
    }
}

fn for_each_water_voxel(mut callback: impl FnMut(i32, i32, i32)) {
    for x in WATER_MIN..=WATER_MAX {
        for z in WATER_MIN..=WATER_MAX {
            for y in WATER_BOTTOM..=WATER_TOP {
                callback(x, y, z);
            }
        }
    }
}

fn make_world(registry: &Registry, config: &WorldConfig, is_with_water: bool) -> Chunks {
    let mut chunks = Chunks::new(config);

    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", 0, 0, &chunk_opts);

    for x in 0..CHUNK_SIZE as i32 {
        for z in 0..CHUNK_SIZE as i32 {
            chunk.set_voxel(x, 0, z, STONE);
        }
    }

    if is_with_water {
        for_each_water_voxel(|x, y, z| {
            chunk.set_voxel(x, y, z, WATER);
        });
    }

    chunk.calculate_max_height(registry);
    chunks.add(chunk);

    chunks
}

fn run_generation_lighting(chunks: &mut Chunks, registry: &Registry, config: &WorldConfig) {
    let min = Vec3(0, 0, 0);
    let shape = Vec3(CHUNK_SIZE, MAX_HEIGHT, CHUNK_SIZE);

    let queues = Lights::propagate(chunks, &min, &shape, registry, config);
    let colors = [
        LightColor::Sunlight,
        LightColor::Red,
        LightColor::Green,
        LightColor::Blue,
    ];

    for (queue, color) in queues.into_iter().zip(colors.iter()) {
        if !queue.is_empty() {
            Lights::flood_light(
                chunks,
                queue,
                color,
                registry,
                config,
                Some(&min),
                Some(&shape),
            );
        }
    }
}

fn assert_sunlight_fields_match(actual: &Chunks, expected: &Chunks, context: &str) {
    for x in 0..CHUNK_SIZE as i32 {
        for z in 0..CHUNK_SIZE as i32 {
            for y in 0..MAX_HEIGHT as i32 {
                assert_eq!(
                    actual.get_sunlight(x, y, z),
                    expected.get_sunlight(x, y, z),
                    "{context}: sunlight mismatch at ({x}, {y}, {z})"
                );
            }
        }
    }
}

#[test]
fn bulk_water_placement_matches_generation_lighting() {
    let registry = create_registry();
    let config = create_config();

    let mut generated = make_world(&registry, &config, true);
    run_generation_lighting(&mut generated, &registry, &config);

    let mut placed = make_world(&registry, &config, false);
    run_generation_lighting(&mut placed, &registry, &config);

    let mut removals = Vec::new();
    for_each_water_voxel(|x, y, z| {
        placed.set_voxel(x, y, z, WATER);
        if placed.get_max_height(x, z) < y as u32 {
            placed.set_max_height(x, z, y as u32);
        }
        if placed.get_sunlight(x, y, z) != 0 {
            removals.push(Vec3(x, y, z));
        }
    });

    Lights::remove_lights(
        &mut placed,
        &removals,
        &LightColor::Sunlight,
        &config,
        &registry,
    );

    assert_sunlight_fields_match(&placed, &generated, "placed water vs generated water");

    let surface = generated.get_sunlight(7, WATER_TOP, 7);
    let interior = generated.get_sunlight(7, 20, 7);
    assert!(
        surface < config.max_light_level && surface > 0,
        "water surface should be attenuated but lit, got {surface}"
    );
    assert!(
        interior < surface,
        "deep interior ({interior}) should be darker than the surface ({surface})"
    );
}

#[test]
fn slab_by_slab_water_placement_matches_generation_lighting() {
    let registry = create_registry();
    let config = create_config();

    let mut generated = make_world(&registry, &config, true);
    run_generation_lighting(&mut generated, &registry, &config);

    let mut placed = make_world(&registry, &config, false);
    run_generation_lighting(&mut placed, &registry, &config);

    // Mirrors a bulk fill that commits across several server ticks: each tick
    // places one x-slab of the tank and runs one batched removal.
    for x in WATER_MIN..=WATER_MAX {
        let mut removals = Vec::new();
        for z in WATER_MIN..=WATER_MAX {
            for y in WATER_BOTTOM..=WATER_TOP {
                placed.set_voxel(x, y, z, WATER);
                if placed.get_max_height(x, z) < y as u32 {
                    placed.set_max_height(x, z, y as u32);
                }
                if placed.get_sunlight(x, y, z) != 0 {
                    removals.push(Vec3(x, y, z));
                }
            }
        }

        Lights::remove_lights(
            &mut placed,
            &removals,
            &LightColor::Sunlight,
            &config,
            &registry,
        );
    }

    assert_sunlight_fields_match(
        &placed,
        &generated,
        "slab-by-slab placed water vs generated water",
    );
}

#[test]
fn tick_sliced_water_placement_matches_generation_lighting() {
    let registry = create_registry();
    let config = create_config();

    let mut generated = make_world(&registry, &config, true);
    run_generation_lighting(&mut generated, &registry, &config);

    let mut placed = make_world(&registry, &config, false);
    run_generation_lighting(&mut placed, &registry, &config);

    // Mirrors the live update queue: a bulk fill enqueued in x-outer, y-mid,
    // z-inner order, committed in fixed-size per-tick batches whose
    // boundaries land mid-column, leaving wedge-shaped intermediate states.
    let mut pending = Vec::new();
    for x in WATER_MIN..=WATER_MAX {
        for y in WATER_BOTTOM..=WATER_TOP {
            for z in WATER_MIN..=WATER_MAX {
                pending.push(Vec3(x, y, z));
            }
        }
    }

    const UPDATES_PER_TICK: usize = 100;

    for batch in pending.chunks(UPDATES_PER_TICK) {
        let mut removals = Vec::new();
        for &Vec3(x, y, z) in batch {
            placed.set_voxel(x, y, z, WATER);
            if placed.get_max_height(x, z) < y as u32 {
                placed.set_max_height(x, z, y as u32);
            }
            if placed.get_sunlight(x, y, z) != 0 {
                removals.push(Vec3(x, y, z));
            }
        }

        Lights::remove_lights(
            &mut placed,
            &removals,
            &LightColor::Sunlight,
            &config,
            &registry,
        );
    }

    assert_sunlight_fields_match(
        &placed,
        &generated,
        "tick-sliced placed water vs generated water",
    );
}

#[test]
fn randomized_batch_water_placement_matches_generation_lighting() {
    let registry = create_registry();
    let config = create_config();

    let mut generated = make_world(&registry, &config, true);
    run_generation_lighting(&mut generated, &registry, &config);

    let mut placed = make_world(&registry, &config, false);
    run_generation_lighting(&mut placed, &registry, &config);

    // The live update queue drains through a hash map, so per-tick batches
    // are spatially arbitrary subsets of the fill. Shuffle deterministically
    // to mirror that.
    let mut pending = Vec::new();
    for_each_water_voxel(|x, y, z| pending.push(Vec3(x, y, z)));

    let mut state: u64 = 0x9E3779B97F4A7C15;
    for i in (1..pending.len()).rev() {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        let j = (state >> 33) as usize % (i + 1);
        pending.swap(i, j);
    }

    const UPDATES_PER_TICK: usize = 100;

    for batch in pending.chunks(UPDATES_PER_TICK) {
        let mut removals = Vec::new();
        for &Vec3(x, y, z) in batch {
            placed.set_voxel(x, y, z, WATER);
            if placed.get_max_height(x, z) < y as u32 {
                placed.set_max_height(x, z, y as u32);
            }
            if placed.get_sunlight(x, y, z) != 0 {
                removals.push(Vec3(x, y, z));
            }
        }

        Lights::remove_lights(
            &mut placed,
            &removals,
            &LightColor::Sunlight,
            &config,
            &registry,
        );
    }

    assert_sunlight_fields_match(
        &placed,
        &generated,
        "randomized batch placed water vs generated water",
    );
}

#[test]
fn draining_water_restores_generation_lighting() {
    let registry = create_registry();
    let config = create_config();

    let mut pristine = make_world(&registry, &config, false);
    run_generation_lighting(&mut pristine, &registry, &config);

    let mut drained = make_world(&registry, &config, true);
    run_generation_lighting(&mut drained, &registry, &config);

    let mut removals = Vec::new();
    for_each_water_voxel(|x, y, z| {
        drained.set_voxel(x, y, z, 0);
        if drained.get_sunlight(x, y, z) != 0 {
            removals.push(Vec3(x, y, z));
        }
    });

    Lights::remove_lights(
        &mut drained,
        &removals,
        &LightColor::Sunlight,
        &config,
        &registry,
    );

    assert_sunlight_fields_match(&drained, &pristine, "drained water vs pristine air");
}
