//! Walker rivers and the ecology/flora field on a heightfield world:
//! monotone water levels, channel cuts that hold contained water over
//! waterproof beds, containment of community species inside their own
//! patches, cross-window agreement of tree instances, community floors,
//! and the spec validation corpus.

#[path = "fixtures/mod.rs"]
mod fixtures;

use fixtures::*;

use voxelize::{Vec3, VoxelAccess};
use voxelize_gen::*;

fn walker_harness() -> Harness {
    harness_for(walker_fixture_spec())
}

fn flora_env<'a>(
    generator: &'a CompiledGenerator,
    surface: &'a dyn Fn(i32, i32) -> i32,
    steepness: &'a dyn Fn(i32, i32) -> f64,
    biome_key: &'a dyn Fn(i32, i32, i32) -> &'static str,
    river_dist: &'a dyn Fn(i32, i32) -> f64,
    moisture: &'a dyn Fn(i32, i32) -> f64,
) -> Env<'a> {
    Env {
        surface,
        steepness,
        biome_key,
        river_dist,
        moisture,
        sea_level: generator.sea_level(),
    }
}

#[test]
fn walker_water_levels_are_monotone_downstream() {
    let harness = walker_harness();
    let generator = &harness.generator;
    let rivers = generator.walker_rivers().expect("fixture has walker rivers");

    let height = |x: i32, z: i32| generator.surface_raw(x, z) as f64;
    let mut paths = 0usize;
    for tx in -2..=2i64 {
        for tz in -2..=2i64 {
            let tile = rivers.tile(tx, tz, &height);
            for (path, end) in &tile.paths {
                paths += 1;
                let mut previous = f64::MAX;
                for &(_, _, level) in path {
                    assert!(
                        level <= previous + 1e-9,
                        "water level climbed downstream ({level} after {previous}, end {end:?})"
                    );
                    previous = level;
                }
            }
        }
    }
    assert!(paths > 3, "the fixture should route real rivers ({paths} paths)");
}

#[test]
fn river_stage_cuts_channels_and_contains_water() {
    let harness = walker_harness();
    let generator = &harness.generator;
    let water = harness.registry.get_block_by_name("Test Water").id;
    let bed_block = harness.registry.get_block_by_name("Test Cobble").id;
    let bank_block = harness.registry.get_block_by_name("Test Sand").id;
    let sea = generator.sea_level().expect("fixture has a sea");

    // Locate real channel ground first (channels are sparse at tile
    // scale), then generate exactly the chunks that hold it.
    let mut channel_chunks: Vec<(i32, i32)> = Vec::new();
    for x in (-768..768).step_by(8) {
        for z in (-768..768).step_by(8) {
            let Some(point) = generator.river_sample(x, z) else {
                continue;
            };
            if matches!(generator.river_column(&point), RiverColumn::Channel { water_y, .. } if water_y > sea + 1)
            {
                let coords = (x.div_euclid(CHUNK as i32), z.div_euclid(CHUNK as i32));
                if !channel_chunks.contains(&coords) {
                    channel_chunks.push(coords);
                }
            }
        }
    }
    assert!(
        channel_chunks.len() > 4,
        "no above-sea channel ground found in +/-768 blocks ({} chunks)",
        channel_chunks.len()
    );

    let mut channel_water = 0usize;
    let mut deep_beds = 0usize;
    let mut bank_columns = 0usize;
    for &(cx, cz) in channel_chunks.iter().take(24) {
        let chunk = harness.generate_chunk(cx, cz);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        for x in min_x..max_x {
            for z in min_z..max_z {
                // No water anywhere may hang over air.
                for y in (min_y + 1)..max_y {
                    if chunk.get_voxel(x, y, z) == water {
                        assert!(
                            chunk.get_voxel(x, y - 1, z) != 0,
                            "water hangs over air at ({x},{y},{z})"
                        );
                    }
                }
                let Some(point) = generator.river_sample(x, z) else {
                    continue;
                };
                match generator.river_column(&point) {
                    RiverColumn::Channel { bed, water_y } if water_y > sea + 1 => {
                        if bed + 1 <= water_y
                            && bed >= min_y
                            && water_y < max_y
                            && chunk.get_voxel(x, water_y, z) == water
                        {
                            channel_water += 1;
                            assert!(
                                chunk.get_voxel(x, bed, z) != 0,
                                "wet channel bed must be solid at ({x},{bed},{z})"
                            );
                            if water_y - bed >= 3 {
                                deep_beds += 1;
                                assert_eq!(
                                    chunk.get_voxel(x, bed, z),
                                    bed_block,
                                    "deep channel bed material at ({x},{bed},{z})"
                                );
                            }
                        }
                    }
                    RiverColumn::Bank { raise_to, .. } => {
                        let ground = generator.surface_raw(x, z);
                        if ground < raise_to && raise_to >= min_y && raise_to < max_y {
                            bank_columns += 1;
                            assert_eq!(
                                chunk.get_voxel(x, raise_to, z),
                                bank_block,
                                "containment levee missing at ({x},{raise_to},{z})"
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    println!("rivers: {channel_water} wet channel columns, {deep_beds} deep beds, {bank_columns} levee columns");
    assert!(channel_water > 30, "channels never held water: {channel_water}");
    assert!(deep_beds > 0, "no deep pool got its bed material");
    assert!(bank_columns > 0, "no containment levee was ever needed/built");
}

#[test]
fn community_species_never_leak_their_patches() {
    let harness = walker_harness();
    let generator = &harness.generator;
    let ecology = generator.ecology().expect("fixture has ecology");

    let surface = |x: i32, z: i32| -> i32 {
        let ground = generator.ground_at(x, z);
        match generator
            .river_sample(x, z)
            .map(|point| generator.river_column(&point))
        {
            Some(RiverColumn::Bank { raise_to, .. }) => ground.max(raise_to),
            _ => ground,
        }
    };
    let steepness = |x: i32, z: i32| generator.steepness(x, z);
    let biome_key = |x: i32, y: i32, z: i32| -> &'static str {
        let blend = generator.blend_at(x, z, y);
        generator.biome_key(blend.primary)
    };
    let river_dist = |x: i32, z: i32| generator.river_distance(x, z);
    let moisture = |x: i32, z: i32| generator.moisture_at(x, z);
    let env = flora_env(generator, &surface, &steepness, &biome_key, &river_dist, &moisture);

    let oakwood = ecology
        .communities()
        .iter()
        .position(|community| community.key == "oakwood")
        .expect("oakwood exists");
    let birch_fringe = ecology
        .communities()
        .iter()
        .position(|community| community.key == "birch_fringe")
        .expect("birch_fringe exists");

    let mut cache = CellCache::default();
    let trees = generator.flora().trees_in((-600, -600), (600, 600), &env, Some(ecology), &mut cache);
    assert!(
        trees.len() > 60,
        "the window should carry a real tree census ({} trees)",
        trees.len()
    );

    let species = walker_fixture_spec().species;
    let mut checked = 0usize;
    for tree in &trees {
        let key = species[tree.species].key;
        if key == "snag" {
            // Azonal riparian scatter: bound to the channel, not a patch.
            let dist = river_dist(tree.x, tree.z);
            assert!(
                (3.0..=10.0).contains(&dist),
                "riparian snag at ({}, {}) sits {dist:.1} blocks from the channel",
                tree.x,
                tree.z
            );
            continue;
        }
        let owner = ecology
            .owner_at(tree.x, tree.z, &env, &mut cache)
            .unwrap_or_else(|| {
                panic!(
                    "community tree ({key}) stands on unowned ground at ({}, {})",
                    tree.x, tree.z
                )
            });
        match key {
            "oak" => assert_eq!(
                owner.community, oakwood,
                "an oak escaped the oakwood at ({}, {})",
                tree.x, tree.z
            ),
            "birch" => assert!(
                owner.community == birch_fringe || owner.community == oakwood,
                "a birch stands outside both communities that may carry it at ({}, {})",
                tree.x,
                tree.z
            ),
            other => panic!("unexpected species {other}"),
        }
        checked += 1;
    }
    println!("containment: {checked} community trees verified over {} total", trees.len());
    assert!(checked > 40, "too few community trees to trust the gate: {checked}");
}

#[test]
fn tree_instances_agree_across_windows() {
    let harness = walker_harness();
    let generator = &harness.generator;
    let ecology = generator.ecology();

    let surface = |x: i32, z: i32| generator.ground_at(x, z);
    let steepness = |x: i32, z: i32| generator.steepness(x, z);
    let biome_key = |x: i32, y: i32, z: i32| -> &'static str {
        let blend = generator.blend_at(x, z, y);
        generator.biome_key(blend.primary)
    };
    let river_dist = |x: i32, z: i32| generator.river_distance(x, z);
    let moisture = |x: i32, z: i32| generator.moisture_at(x, z);
    let env = flora_env(generator, &surface, &steepness, &biome_key, &river_dist, &moisture);

    // Two windows sharing a 64-block overlap band, like two neighboring
    // chunks with their pads: every tree whose trunk falls in the band
    // must appear identically in both.
    let mut cache_a = CellCache::default();
    let west = generator
        .flora()
        .trees_in((-256, -128), (32, 128), &env, ecology, &mut cache_a);
    let mut cache_b = CellCache::default();
    let east = generator
        .flora()
        .trees_in((-32, -128), (256, 128), &env, ecology, &mut cache_b);

    let in_band = |tree: &&TreeInstance| tree.x >= -32 && tree.x < 32;
    let mut west_band: Vec<(i32, i32, i32, usize, u64)> = west
        .iter()
        .filter(in_band)
        .map(|tree| (tree.x, tree.y, tree.z, tree.species, tree.seed))
        .collect();
    let mut east_band: Vec<(i32, i32, i32, usize, u64)> = east
        .iter()
        .filter(in_band)
        .map(|tree| (tree.x, tree.y, tree.z, tree.species, tree.seed))
        .collect();
    west_band.sort();
    east_band.sort();
    assert!(
        !west_band.is_empty(),
        "the overlap band should carry trees; widen the fixture window"
    );
    assert_eq!(
        west_band, east_band,
        "the two windows disagree about trees in their shared band"
    );
}

#[test]
fn community_floors_carpet_owned_ground() {
    let harness = walker_harness();
    let fern = harness.registry.get_block_by_name("Test Fern").id;
    let tuft = harness.registry.get_block_by_name("Test Tuft").id;
    let mut floor_plants = 0usize;
    for cx in -4..4 {
        for cz in -4..4 {
            let chunk = harness.generate_chunk(cx, cz);
            let Vec3(min_x, min_y, min_z) = chunk.min;
            let Vec3(max_x, max_y, max_z) = chunk.max;
            for x in min_x..max_x {
                for z in min_z..max_z {
                    for y in min_y..max_y {
                        let voxel = chunk.get_voxel(x, y, z);
                        if voxel == fern || voxel == tuft {
                            floor_plants += 1;
                            assert!(
                                chunk.get_voxel(x, y - 1, z) != 0,
                                "floor plant floats at ({x},{y},{z})"
                            );
                        }
                    }
                }
            }
        }
    }
    println!("community floors: {floor_plants} plants");
    assert!(floor_plants > 40, "understory never carpeted: {floor_plants}");
}

#[test]
fn river_and_flora_specs_validate() {
    let registry = fixture_registry();
    let config = fixture_config();

    let mut rivers_on_geology = geology_fixture_spec();
    rivers_on_geology.rivers = walker_fixture_spec().rivers;
    assert!(
        compile(&rivers_on_geology, &registry, &config).is_err(),
        "walker rivers on a geology world must refuse"
    );

    let mut no_materials = walker_fixture_spec();
    no_materials.river_materials = None;
    assert!(
        compile(&no_materials, &registry, &config).is_err(),
        "rivers without materials must refuse"
    );

    let mut orphan_materials = fixture_spec();
    orphan_materials.river_materials = walker_fixture_spec().river_materials;
    assert!(
        compile(&orphan_materials, &registry, &config).is_err(),
        "materials without rivers must refuse"
    );

    let mut unknown_water = walker_fixture_spec();
    if let Some(materials) = &mut unknown_water.river_materials {
        materials.water = "No Such Fluid";
    }
    assert!(matches!(
        compile(&unknown_water, &registry, &config),
        Err(GenError::UnknownBlock { .. })
    ));

    let mut tiny_tile = walker_fixture_spec();
    if let Some(rivers) = &mut tiny_tile.rivers {
        rivers.tile = 64;
    }
    assert!(compile(&tiny_tile, &registry, &config).is_err());

    let mut unknown_species = walker_fixture_spec();
    unknown_species.flora[0].species = vec![("ghost_tree", 1.0)];
    assert!(compile(&unknown_species, &registry, &config).is_err());

    let mut bad_ecotone = walker_fixture_spec();
    if let Some(ecology) = &mut bad_ecotone.ecology {
        ecology.ecotone = 0.7;
    }
    assert!(compile(&bad_ecotone, &registry, &config).is_err());

    let mut unknown_mosaic_block = geology_fixture_spec();
    if let Some(mosaic) = &mut unknown_mosaic_block.mosaic {
        mosaic.grass_block = "No Such Grass";
    }
    assert!(compile(&unknown_mosaic_block, &registry, &config).is_err());

    let mut clashing_salts = walker_fixture_spec();
    if let Some(ecology) = &mut clashing_salts.ecology {
        ecology.salt = SaltPath("fixture.rivers");
    }
    assert!(matches!(
        compile(&clashing_salts, &registry, &config),
        Err(GenError::SaltCollision { .. })
    ));
}
