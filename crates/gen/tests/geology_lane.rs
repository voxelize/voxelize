//! The geology spine through the full public pipeline: chunk-order and
//! thread independence over solved tiles, deterministic tile digests,
//! water containment for lakes and drainage channels, the ground mosaic,
//! named-species ecology, and a generation cost smoke. The fixture is a
//! small, fast solve — the physics fidelity tests live with the solver's
//! unit suite.

#[path = "fixtures/mod.rs"]
mod fixtures;

use fixtures::*;

use rayon::prelude::*;
use voxelize::{Vec3, VoxelAccess};
use voxelize_gen::*;

fn region_digest(harness: &Harness, order: &[(i32, i32)]) -> Vec<((i32, i32), u64)> {
    let mut digests: Vec<((i32, i32), u64)> = order
        .iter()
        .map(|&(cx, cz)| ((cx, cz), harness.chunk_digest(&harness.generate_chunk(cx, cz))))
        .collect();
    digests.sort();
    digests
}

#[test]
fn geology_chunks_are_order_and_thread_independent() {
    let harness = harness_for(geology_fixture_spec());
    let mut coords: Vec<(i32, i32)> = (0..4)
        .flat_map(|cx| (0..4).map(move |cz| (cx, cz)))
        .collect();

    let forward = region_digest(&harness, &coords);

    coords.reverse();
    let reverse = region_digest(&harness, &coords);
    assert_eq!(forward, reverse, "reverse-order geology generation diverged");

    let mut parallel: Vec<((i32, i32), u64)> = coords
        .par_iter()
        .map(|&(cx, cz)| ((cx, cz), harness.chunk_digest(&harness.generate_chunk(cx, cz))))
        .collect();
    parallel.sort();
    assert_eq!(forward, parallel, "parallel geology generation diverged");

    let second = region_digest(&harness_for(geology_fixture_spec()), &coords);
    assert_eq!(forward, second, "fresh geology compile diverged");
}

#[test]
fn geology_tile_digests_are_deterministic() {
    let first = harness_for(geology_fixture_spec());
    let second = harness_for(geology_fixture_spec());
    for (tx, tz) in [(0i64, 0i64), (-1, 0), (0, -1), (1, 1)] {
        assert_eq!(
            first.generator.geology_tile_digest(tx, tz),
            second.generator.geology_tile_digest(tx, tz),
            "tile ({tx},{tz}) solved differently across compiles"
        );
    }
    assert!(
        first.generator.geology_tile_digest(0, 0).is_some(),
        "the geology spine must answer tile digests"
    );
}

#[test]
fn water_never_hangs_over_air() {
    let harness = harness_for(geology_fixture_spec());
    let water = harness.registry.get_block_by_name("Test Water").id;
    let mut water_voxels = 0usize;
    for cx in -3..3 {
        for cz in -3..3 {
            let chunk = harness.generate_chunk(cx, cz);
            let Vec3(min_x, min_y, min_z) = chunk.min;
            let Vec3(max_x, max_y, max_z) = chunk.max;
            for x in min_x..max_x {
                for z in min_z..max_z {
                    for y in (min_y + 1)..max_y {
                        if chunk.get_voxel(x, y, z) != water {
                            continue;
                        }
                        water_voxels += 1;
                        let below = chunk.get_voxel(x, y - 1, z);
                        assert!(
                            below != 0,
                            "water at ({x},{y},{z}) hangs over air: lake/channel containment broke"
                        );
                    }
                }
            }
        }
    }
    assert!(
        water_voxels > 500,
        "the geo fixture should hold real water somewhere in the window ({water_voxels})"
    );
}

#[test]
fn drainage_channels_exist_and_carry_contained_water() {
    let harness = harness_for(geology_fixture_spec());
    let generator = &harness.generator;
    let water = harness.registry.get_block_by_name("Test Water").id;

    // Find land channel columns via the public river query.
    let mut channel_columns: Vec<(i32, i32, i32, i32)> = Vec::new();
    let sea = generator.sea_level().expect("geo fixture has a sea");
    for x in (-640..640).step_by(4) {
        for z in (-640..640).step_by(4) {
            let Some(point) = generator.river_sample(x, z) else {
                continue;
            };
            if let RiverColumn::Channel { bed, water_y } = generator.river_column(&point) {
                if water_y > sea + 1 {
                    channel_columns.push((x, z, bed, water_y));
                }
            }
        }
    }
    assert!(
        channel_columns.len() > 20,
        "the solve should carve real above-sea drainage in +/-640 blocks ({} found)",
        channel_columns.len()
    );

    // Generate the chunks holding a sample of them and verify the cut.
    let mut is_wet = 0usize;
    for &(x, z, bed, water_y) in channel_columns.iter().take(12) {
        let (cx, cz) = (x.div_euclid(CHUNK as i32), z.div_euclid(CHUNK as i32));
        let chunk = harness.generate_chunk(cx, cz);
        if water_y > bed + 1 && chunk.get_voxel(x, water_y, z) == water {
            is_wet += 1;
        }
        assert!(
            chunk.get_voxel(x, bed, z) != 0,
            "channel bed at ({x},{bed},{z}) must be solid (waterproof floor)"
        );
    }
    assert!(
        is_wet * 2 >= 12,
        "most sampled channel columns should hold water ({is_wet}/12)"
    );
}

#[test]
fn mosaic_paints_the_geo_surface() {
    let harness = harness_for(geology_fixture_spec());
    let id_of = |name: &str| harness.registry.get_block_by_name(name).id;
    let dry = id_of("Test Dry Grass");
    let lush = id_of("Test Lush Grass");
    let snow = id_of("Test Snow");
    let dirt = id_of("Test Dirt");

    let mut tone_blocks = 0usize;
    let mut snow_blocks = 0usize;
    let mut patch_blocks = 0usize;
    let mut high_ground = 0usize;
    for cx in -6..6 {
        for cz in -6..6 {
            let chunk = harness.generate_chunk(cx, cz);
            let Vec3(min_x, min_y, min_z) = chunk.min;
            let Vec3(max_x, max_y, max_z) = chunk.max;
            for x in min_x..max_x {
                for z in min_z..max_z {
                    let surface = harness.generator.surface_raw(x, z);
                    if surface >= 96 {
                        high_ground += 1;
                    }
                    let mut top = 0;
                    for y in (min_y..max_y).rev() {
                        let id = chunk.get_voxel(x, y, z);
                        if id != 0 {
                            top = id;
                            break;
                        }
                    }
                    if top == dry || top == lush {
                        tone_blocks += 1;
                    }
                    if top == snow {
                        snow_blocks += 1;
                    }
                    if top == dirt && surface > harness.generator.sea_level().unwrap_or(0) {
                        patch_blocks += 1;
                    }
                }
            }
        }
    }
    println!("mosaic: tones {tone_blocks}, snow {snow_blocks}, dirt patches {patch_blocks}, high ground {high_ground}");
    assert!(tone_blocks > 50, "moisture tone grading never engaged: {tone_blocks}");
    assert!(patch_blocks > 20, "substrate patches never engaged: {patch_blocks}");
    if high_ground > 200 {
        assert!(
            snow_blocks > 0,
            "columns above the snowline exist but no snow was painted"
        );
    }
}

#[test]
fn ecology_plants_named_species_on_the_geo_world() {
    let harness = harness_for(geology_fixture_spec());
    let log_a = harness.registry.get_block_by_name("Test Log A").id;
    let fern = harness.registry.get_block_by_name("Test Fern").id;
    let tuft = harness.registry.get_block_by_name("Test Tuft").id;
    let mut logs = 0usize;
    let mut floor = 0usize;
    for cx in -6..6 {
        for cz in -6..6 {
            let chunk = harness.generate_chunk(cx, cz);
            let Vec3(min_x, min_y, min_z) = chunk.min;
            let Vec3(max_x, max_y, max_z) = chunk.max;
            for x in min_x..max_x {
                for z in min_z..max_z {
                    for y in min_y..max_y {
                        let voxel = chunk.get_voxel(x, y, z);
                        if voxel == log_a {
                            logs += 1;
                        }
                        if voxel == fern || voxel == tuft {
                            floor += 1;
                        }
                    }
                }
            }
        }
    }
    println!("geo ecology: {logs} trunk voxels, {floor} floor plants");
    assert!(logs > 30, "the pine community never planted: {logs}");
    assert!(floor > 30, "community floors never carpeted: {floor}");
}

#[test]
fn geology_cost_smoke() {
    let harness = harness_for(geology_fixture_spec());
    // Warm the tile caches: the one-time solve is not the steady state.
    for cx in 0..2 {
        for cz in 0..2 {
            std::hint::black_box(harness.generate_chunk(cx, cz));
        }
    }
    let mut timings_us: Vec<u128> = Vec::new();
    for cx in 0..6 {
        for cz in 0..6 {
            let started = std::time::Instant::now();
            let chunk = harness.generate_chunk(cx, cz);
            timings_us.push(started.elapsed().as_micros());
            std::hint::black_box(chunk.get_voxel(cx * 16, 40, cz * 16));
        }
    }
    timings_us.sort();
    let p50 = timings_us[timings_us.len() / 2];
    let p95 = timings_us[timings_us.len() * 95 / 100];
    println!("geo chunk cost: p50={p50}us p95={p95}us");
    assert!(
        p95 < 500_000,
        "p95 geo chunk cost {p95}us blew the smoke bound"
    );
}
