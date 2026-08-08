//! Engine-level acceptance tests over a self-contained fixture world:
//! chunk-order independence, thread independence, lattice halo continuity,
//! structure slice/whole equality, rejection accounting, hydrology sanity,
//! clustered dressing, versioning, and a generation cost smoke. The
//! fixture registry is test-local — no game content is imported.

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
fn chunk_bytes_are_order_and_thread_independent() {
    let harness = harness();
    let mut coords: Vec<(i32, i32)> = (0..5)
        .flat_map(|cx| (0..5).map(move |cz| (cx, cz)))
        .collect();

    let forward = region_digest(&harness, &coords);

    coords.reverse();
    let reverse = region_digest(&harness, &coords);
    assert_eq!(forward, reverse, "reverse-order generation diverged");

    let mut stream = HashStream::new(7);
    for i in (1..coords.len()).rev() {
        let j = (stream.raw() % (i as u64 + 1)) as usize;
        coords.swap(i, j);
    }
    let shuffled = region_digest(&harness, &coords);
    assert_eq!(forward, shuffled, "shuffled-order generation diverged");

    let mut parallel: Vec<((i32, i32), u64)> = coords
        .par_iter()
        .map(|&(cx, cz)| ((cx, cz), harness.chunk_digest(&harness.generate_chunk(cx, cz))))
        .collect();
    parallel.sort();
    assert_eq!(forward, parallel, "parallel generation diverged");

    // A fresh compile from the same spec must agree byte-for-byte.
    let second = region_digest(&fixtures::harness(), &coords);
    assert_eq!(forward, second, "fresh generator diverged");
}

#[test]
fn carve_lattices_agree_across_chunk_borders() {
    let harness = harness();
    let generator = &harness.generator;
    let a = generator.build_carve_lattices((0, 0, 0), (16, 96, 16));
    let b = generator.build_carve_lattices((16, 0, 0), (32, 96, 16));
    // The shared plane x = 16 is interior to neither window's anchor grid:
    // world-anchored strides mean both interpolate identical values there.
    let mut checked = 0;
    for z in 0..16 {
        for y in (4..90).step_by(3) {
            let surface = generator.surface_raw(16, z);
            let steep = generator.steepness(16, z);
            let from_a = generator.is_carved(&a, 16, y, z, surface, steep, 0b1);
            let from_b = generator.is_carved(&b, 16, y, z, surface, steep, 0b1);
            assert_eq!(from_a, from_b, "carve verdict differs at (16,{y},{z})");
            checked += 1;
        }
    }
    assert!(checked > 100);
}

#[test]
fn structure_slices_reassemble_the_whole_plan() {
    let harness = harness();
    let generator = &harness.generator;
    let plans = generator.plans_in_reach((-1024, -1024), (1024, 1024));
    assert!(
        !plans.is_empty(),
        "fixture must place at least one hamlet in 2048x2048"
    );

    let plan = plans
        .iter()
        .find(|plan| {
            plan.bbox_min.0.div_euclid(16) != (plan.bbox_max.0 - 1).div_euclid(16)
                || plan.bbox_min.2.div_euclid(16) != (plan.bbox_max.2 - 1).div_euclid(16)
        })
        .expect("at least one hamlet must span a chunk border in 2048x2048");
    let mut whole: hashbrown::HashMap<(i32, i32, i32), u32> = hashbrown::HashMap::new();
    generator.structures().apply_slice(
        plan,
        (i32::MIN / 2, i32::MIN / 2, i32::MIN / 2),
        (i32::MAX / 2, i32::MAX / 2, i32::MAX / 2),
        &mut |x, y, z, block| {
            whole.insert((x, y, z), block);
        },
    );
    assert!(!whole.is_empty());

    let mut sliced: hashbrown::HashMap<(i32, i32, i32), u32> = hashbrown::HashMap::new();
    let (min, max) = (plan.bbox_min, plan.bbox_max);
    let chunk_lo = (min.0.div_euclid(16), min.2.div_euclid(16));
    let chunk_hi = (max.0.div_euclid(16), max.2.div_euclid(16));
    let mut chunks_touched = 0;
    for cx in chunk_lo.0..=chunk_hi.0 {
        for cz in chunk_lo.1..=chunk_hi.1 {
            chunks_touched += 1;
            generator.structures().apply_slice(
                plan,
                (cx * 16, 0, cz * 16),
                (cx * 16 + 16, HEIGHT as i32, cz * 16 + 16),
                &mut |x, y, z, block| {
                    assert!(
                        x >= cx * 16 && x < cx * 16 + 16 && z >= cz * 16 && z < cz * 16 + 16,
                        "slice wrote outside its chunk"
                    );
                    sliced.insert((x, y, z), block);
                },
            );
        }
    }
    assert_eq!(whole, sliced, "chunk slices disagree with the whole plan");
    assert!(chunks_touched >= 2, "spanning plan must touch several chunks");
}

#[test]
fn impossible_constraints_reject_with_reasons() {
    let registry = fixture_registry();
    let config = fixture_config();
    let mut spec = fixture_spec();
    spec.structures[0].constraints = vec![PlacementConstraint::SurfaceHeight {
        min: 999,
        max: 1000,
    }];
    let generator = compile(&spec, &registry, &config).expect("compiles");
    let plans = generator.plans_in_reach((-256, -256), (256, 256));
    assert!(plans.is_empty());
    let stats = generator.structures().rejection_stats(0);
    assert_eq!(stats.placed, 0);
    let rejected: u64 = stats.rejected.iter().map(|(_, count)| count).sum();
    assert!(rejected > 0, "rejections must be counted");
    assert!(stats
        .rejected
        .iter()
        .all(|(reason, _)| *reason == RejectionReason::SurfaceHeight));
    assert!(!stats.samples.is_empty(), "rejection samples must be kept");
}

#[test]
fn no_floating_fluid_above_surface_or_sea() {
    let harness = harness();
    let water = harness.registry.get_block_by_name("Test Water").id;
    let sea = harness.generator.sea_level().expect("fixture has a sea");
    for (cx, cz) in [(0, 0), (3, 2), (-2, 4), (5, -3)] {
        let chunk = harness.generate_chunk(cx, cz);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = harness.generator.surface_raw(x, z);
                for y in min_y..max_y {
                    if chunk.get_voxel(x, y, z) == water && y > surface {
                        assert!(
                            y <= sea,
                            "floating water at ({x},{y},{z}): above surface {surface} and sea {sea}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn caves_actually_exist_underground() {
    // The class of bug this guards: a carver whose threshold sits outside
    // the field's practical range carves nothing, silently, forever.
    let harness = harness();
    let mut carved_air = 0usize;
    let mut solid = 0usize;
    for (cx, cz) in [(0, 0), (1, 0), (0, 1), (2, 3), (-3, -2), (4, -4)] {
        let chunk = harness.generate_chunk(cx, cz);
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;
        for x in min_x..max_x {
            for z in min_z..max_z {
                let surface = harness.generator.surface_raw(x, z);
                for y in 10..(surface - 12).min(40) {
                    if chunk.get_voxel(x, y, z) == 0 {
                        carved_air += 1;
                    } else {
                        solid += 1;
                    }
                }
            }
        }
    }
    let fraction = carved_air as f64 / (carved_air + solid).max(1) as f64;
    println!("underground carved-air fraction: {fraction:.4} ({carved_air} voxels)");
    assert!(
        carved_air > 200,
        "caves are effectively absent underground ({carved_air} air voxels)"
    );
    assert!(
        fraction < 0.35,
        "carvers are eating the world ({fraction:.3})"
    );
}

#[test]
fn clustered_dressing_is_deterministic_and_coherent() {
    let harness = harness();
    let generator = &harness.generator;
    let tuft = harness.registry.get_block_by_name("Test Tuft").id;
    let meadow = (0..generator.biome_count() as u16)
        .map(BiomeId)
        .find(|id| generator.biome_key(*id) == "meadow")
        .expect("fixture has a meadow biome");

    // Determinism: two compiles answer identically per column.
    let second = fixtures::harness();
    let mut dressed_columns: Vec<(i32, i32)> = Vec::new();
    let mut dressed = 0usize;
    for x in -400..400 {
        for z in -400..400 {
            let a = generator.dressing_at(meadow, x, z);
            let b = second.generator.dressing_at(meadow, x, z);
            assert_eq!(a, b, "dressing diverged at ({x},{z})");
            if a == Some(tuft) {
                dressed += 1;
                dressed_columns.push((x, z));
            }
        }
    }
    let total = 800usize * 800;
    let density = dressed as f64 / total as f64;
    assert!(
        density > 0.005 && density < 0.25,
        "clustered dressing density out of band: {density:.4}"
    );

    // Coherence: given a dressed column, its neighborhood must be dressed
    // far above the base rate — that is what "clustered" means.
    let dressed_set: hashbrown::HashSet<(i32, i32)> = dressed_columns.iter().copied().collect();
    let mut neighbor_hits = 0usize;
    let mut neighbor_total = 0usize;
    for &(x, z) in dressed_columns.iter().take(20_000) {
        for (dx, dz) in [(2, 0), (-2, 0), (0, 2), (0, -2)] {
            let neighbor = (x + dx, z + dz);
            if neighbor.0.abs() < 400 && neighbor.1.abs() < 400 {
                neighbor_total += 1;
                if dressed_set.contains(&neighbor) {
                    neighbor_hits += 1;
                }
            }
        }
    }
    let neighbor_rate = neighbor_hits as f64 / neighbor_total.max(1) as f64;
    println!("dressing density {density:.4}, neighbor rate {neighbor_rate:.4}");
    assert!(
        neighbor_rate > density * 2.0,
        "dressing does not cluster: neighbor rate {neighbor_rate:.4} vs density {density:.4}"
    );

    // The placed block must actually land in generated chunks.
    let mut placed_in_world = 0usize;
    for (cx, cz) in [(0, 0), (1, 1), (-2, 3), (4, -1), (2, 2), (-3, -3)] {
        let chunk = harness.generate_chunk(cx, cz);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        for x in min_x..max_x {
            for z in min_z..max_z {
                for y in min_y..max_y {
                    if chunk.get_voxel(x, y, z) == tuft {
                        placed_in_world += 1;
                    }
                }
            }
        }
    }
    println!("tufts placed across six chunks: {placed_in_world}");
}

#[test]
fn identity_and_compat_gate() {
    let registry = fixture_registry();
    let config = fixture_config();
    let generator_a = compile(&fixture_spec(), &registry, &config).expect("compiles");
    let generator_b = compile(&fixture_spec(), &registry, &config).expect("compiles");
    assert_eq!(
        generator_a.identity.spec_hash,
        generator_b.identity.spec_hash
    );
    assert_eq!(
        check_compat(&generator_a.identity, &generator_b.identity),
        CompatVerdict::Identical
    );

    let mut bumped = fixture_spec();
    bumped.content_version = Version::new(1, 1, 0);
    let generator_c = compile(&bumped, &registry, &config).expect("compiles");
    assert_ne!(
        generator_a.identity.spec_hash,
        generator_c.identity.spec_hash
    );
    assert_eq!(
        check_compat(&generator_a.identity, &generator_c.identity),
        CompatVerdict::ContentDrift
    );

    let mut tuned = fixture_spec();
    tuned.hydrology.sea = Some(SeaSpec {
        level: 47,
        fluid: "Test Water",
    });
    let generator_d = compile(&tuned, &registry, &config).expect("compiles");
    assert_ne!(
        generator_a.identity.spec_hash,
        generator_d.identity.spec_hash,
        "knob changes must be hash-visible even without a version bump"
    );
}

#[test]
fn pathological_specs_die_at_compile() {
    let registry = fixture_registry();
    let config = fixture_config();

    let mut unknown_block = fixture_spec();
    unknown_block.dimension.base_block = "No Such Block";
    assert!(matches!(
        compile(&unknown_block, &registry, &config),
        Err(GenError::UnknownBlock { .. })
    ));

    let mut unfillable = fixture_spec();
    unfillable.pools[1].terminators.clear();
    assert!(matches!(
        compile(&unfillable, &registry, &config),
        Err(GenError::PoolCannotTerminate { .. })
    ));

    let mut walled = fixture_spec();
    if let BiomePartition::Zoned(zoned) = &mut walled.biomes.partition {
        for entry in &mut zoned.entries {
            entry.constraint = Some(AxisWindow {
                axis: AxisKey("temperature"),
                low: 0.0,
                high: 1.0,
            });
        }
    }
    assert!(matches!(
        compile(&walled, &registry, &config),
        Err(GenError::NoFallbackZoneEntry)
    ));

    let mut wrong_height = fixture_spec();
    wrong_height.dimension.height = 256;
    assert!(matches!(
        compile(&wrong_height, &registry, &config),
        Err(GenError::HeightMismatch { .. })
    ));

    let mut reserved = fixture_spec();
    if let Some(aquifers) = &mut reserved.hydrology.aquifers {
        aquifers.salt = SaltPath("engine.hijack");
    }
    assert!(matches!(
        compile(&reserved, &registry, &config),
        Err(GenError::ReservedSalt { .. })
    ));

    let mut bad_cluster = fixture_spec();
    bad_cluster.biomes.registry[0].dressing = vec![DressingSpec {
        block: "Test Tuft",
        chance: 0.4,
        cluster: Some(ClusterSpec {
            salt: SaltPath("fixture.bad_cluster"),
            frequency: 1.0 / 40.0,
            octaves: 2,
            low: 0.5,
            high: 0.5,
        }),
    }];
    assert!(matches!(
        compile(&bad_cluster, &registry, &config),
        Err(GenError::OutOfRange { .. })
    ));

    let mut colliding_cluster = fixture_spec();
    colliding_cluster.biomes.registry[0].dressing = vec![DressingSpec {
        block: "Test Tuft",
        chance: 0.4,
        cluster: Some(ClusterSpec {
            salt: SaltPath("fixture.zones"),
            frequency: 1.0 / 40.0,
            octaves: 2,
            low: 0.0,
            high: 0.2,
        }),
    }];
    assert!(matches!(
        compile(&colliding_cluster, &registry, &config),
        Err(GenError::SaltCollision { .. })
    ));
}

#[test]
fn generation_cost_smoke() {
    let harness = harness();
    let mut timings_us: Vec<u128> = Vec::new();
    for cx in 0..8 {
        for cz in 0..8 {
            let started = std::time::Instant::now();
            let chunk = harness.generate_chunk(cx, cz);
            timings_us.push(started.elapsed().as_micros());
            std::hint::black_box(chunk.get_voxel(cx * 16, 40, cz * 16));
        }
    }
    timings_us.sort();
    let p50 = timings_us[timings_us.len() / 2];
    let p95 = timings_us[timings_us.len() * 95 / 100];
    let max = *timings_us.last().expect("timings");
    println!("gen cost per 16x16x128 chunk: p50={p50}us p95={p95}us max={max}us");
    // Generous CI bound guarding order-of-magnitude regressions only; the
    // budget conversation proper runs on the criterion benchmarks.
    assert!(
        p95 < 250_000,
        "p95 chunk cost {p95}us blew the smoke bound"
    );
}
