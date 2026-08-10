//! The 3D density band, held to its contract on the geology spine:
//! genuine shelf overhangs and waterline undercuts appear where slope and
//! strata justify them — restrained, band bounded, connected to the
//! ground body, silent around structures, and consistent between the
//! pure `ground_at` query and the generated chunks.

#[path = "fixtures/mod.rs"]
mod fixtures;

use fixtures::*;

use rayon::prelude::*;
use voxelize::{Vec3, VoxelAccess};
use voxelize_gen::*;

fn is_solid_id(harness: &Harness, id: u32) -> bool {
    if id == 0 {
        return false;
    }
    let block = harness.registry.get_block_by_id(id);
    !block.is_fluid && !block.is_passable
}

/// The geo fixture stripped to bare terrain: no canopies, no floors —
/// the band invariants measure rock, not vegetation.
fn bare_geology_spec() -> voxelize_gen::GeneratorSpec {
    let mut spec = geology_fixture_spec();
    spec.ecology = None;
    spec.species = vec![];
    spec
}

fn is_river_or_lake(generator: &CompiledGenerator, x: i32, z: i32) -> bool {
    if generator.lake_level(x, z).is_some() {
        return true;
    }
    match generator.river_sample(x, z) {
        Some(point) => !matches!(generator.river_column(&point), RiverColumn::Outside),
        None => false,
    }
}

#[test]
fn density_chunks_are_order_and_thread_independent() {
    let harness = harness_for(geology_fixture_spec());
    let mut coords: Vec<(i32, i32)> = (0..4)
        .flat_map(|cx| (0..4).map(move |cz| (cx, cz)))
        .collect();
    let forward: Vec<((i32, i32), u64)> = coords
        .iter()
        .map(|&(cx, cz)| ((cx, cz), harness.chunk_digest(&harness.generate_chunk(cx, cz))))
        .collect();
    coords.reverse();
    let mut reverse: Vec<((i32, i32), u64)> = coords
        .par_iter()
        .map(|&(cx, cz)| ((cx, cz), harness.chunk_digest(&harness.generate_chunk(cx, cz))))
        .collect();
    reverse.sort();
    let mut forward_sorted = forward.clone();
    forward_sorted.sort();
    assert_eq!(forward_sorted, reverse, "density generation diverged across orders");
}

/// Steep candidate ground, located through the public queries so the
/// census counts where the term may engage at all.
fn steep_chunks(harness: &Harness, radius: i32) -> Vec<(i32, i32)> {
    let generator = &harness.generator;
    let sea = generator.sea_level().unwrap_or(0);
    let mut chunks: Vec<(i32, i32)> = Vec::new();
    for x in (-radius..radius).step_by(8) {
        for z in (-radius..radius).step_by(8) {
            if generator.surface_raw(x, z) <= sea {
                continue;
            }
            if generator.steepness(x, z) < 0.8 {
                continue;
            }
            let coords = (x.div_euclid(CHUNK as i32), z.div_euclid(CHUNK as i32));
            if !chunks.contains(&coords) {
                chunks.push(coords);
            }
        }
    }
    chunks
}

#[test]
fn density_produces_restrained_overhangs_and_undercuts() {
    let harness = harness_for(bare_geology_spec());
    let generator = &harness.generator;
    let band = generator
        .density()
        .expect("fixture carries density")
        .band()
        .ceil() as i32;

    let chunks = steep_chunks(&harness, 640);
    assert!(
        chunks.len() > 6,
        "the geo fixture should offer steep candidate ground ({} chunks)",
        chunks.len()
    );

    let mut columns = 0usize;
    let mut overhang_columns = 0usize;
    let mut undercut_columns = 0usize;
    for &(cx, cz) in chunks.iter().take(24) {
        let chunk = harness.generate_chunk(cx, cz);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;
        for x in min_x..max_x {
            for z in min_z..max_z {
                // River cuts and lake fills reshape their own columns.
                if is_river_or_lake(generator, x, z) {
                    continue;
                }
                columns += 1;
                let surface = generator.surface_raw(x, z);

                // Band bound: no solid above surface + band.
                for y in (surface + band + 1)..(surface + band + 6) {
                    let id = chunk.get_voxel(x, y, z);
                    assert!(
                        !is_solid_id(&harness, id),
                        "solid above the density band at ({x},{y},{z}), surface {surface}"
                    );
                }

                let mut has_overhang = false;
                let mut has_undercut = false;
                for y in (surface - band).max(min_y + 1)..=(surface + band) {
                    let here = chunk.get_voxel(x, y, z);
                    let above = chunk.get_voxel(x, y + 1, z);
                    if !is_solid_id(&harness, here) && is_solid_id(&harness, above) {
                        has_overhang = true;
                        if y <= surface {
                            has_undercut = true;
                        }
                    }
                }
                if has_overhang {
                    overhang_columns += 1;
                }
                if has_undercut {
                    undercut_columns += 1;
                }
            }
        }
    }

    let share = overhang_columns as f64 / columns.max(1) as f64;
    println!(
        "density features: {overhang_columns} overhang columns ({share:.4} share), \
         {undercut_columns} undercuts over {columns} steep-window columns"
    );
    assert!(
        overhang_columns > 10,
        "the density band never produced overhangs: {overhang_columns}"
    );
    assert!(
        undercut_columns > 3,
        "no undercut ever bit below a surface: {undercut_columns}"
    );
    assert!(
        share < 0.35,
        "density must stay restrained: {share:.4} of steep columns carry overhangs"
    );
}

#[test]
fn no_floating_disconnected_components() {
    let harness = harness_for(bare_geology_spec());
    let chunks = steep_chunks(&harness, 512);
    let &(cx, cz) = chunks.first().expect("steep ground exists");

    // A 2x2-chunk window around steep ground, solid-labeled and
    // 6-connectivity flooded: every solid component must touch the window
    // floor or a side wall (abutments may stand outside the window).
    let (min_x, min_z) = (cx * 16, cz * 16);
    let (max_x, max_z) = (min_x + 32, min_z + 32);
    let max_y = HEIGHT as i32;

    let mut solid = vec![false; (32 * 32 * HEIGHT) as usize];
    let index_of = |x: i32, y: i32, z: i32| {
        (((x - min_x) * 32 + (z - min_z)) * HEIGHT as i32 + y) as usize
    };
    for dcx in 0..2 {
        for dcz in 0..2 {
            let chunk = harness.generate_chunk(cx + dcx, cz + dcz);
            let Vec3(cmin_x, _, cmin_z) = chunk.min;
            let Vec3(cmax_x, _, cmax_z) = chunk.max;
            for x in cmin_x..cmax_x {
                for z in cmin_z..cmax_z {
                    for y in 0..max_y {
                        if is_solid_id(&harness, chunk.get_voxel(x, y, z)) {
                            solid[index_of(x, y, z)] = true;
                        }
                    }
                }
            }
        }
    }

    let mut label = vec![u32::MAX; solid.len()];
    let mut floaters = 0usize;
    let mut component = 0u32;
    for start_x in min_x..max_x {
        for start_z in min_z..max_z {
            for start_y in 0..max_y {
                let start = index_of(start_x, start_y, start_z);
                if !solid[start] || label[start] != u32::MAX {
                    continue;
                }
                let mut is_grounded = false;
                let mut stack = vec![(start_x, start_y, start_z)];
                label[start] = component;
                let mut size = 0usize;
                while let Some((x, y, z)) = stack.pop() {
                    size += 1;
                    if y == 0
                        || x == min_x
                        || x == max_x - 1
                        || z == min_z
                        || z == max_z - 1
                    {
                        is_grounded = true;
                    }
                    for (dx, dy, dz) in
                        [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
                    {
                        let (nx, ny, nz) = (x + dx, y + dy, z + dz);
                        if nx < min_x || nx >= max_x || nz < min_z || nz >= max_z || ny < 0
                            || ny >= max_y
                        {
                            continue;
                        }
                        let n = index_of(nx, ny, nz);
                        if solid[n] && label[n] == u32::MAX {
                            label[n] = component;
                            stack.push((nx, ny, nz));
                        }
                    }
                }
                if !is_grounded {
                    floaters += 1;
                    println!("floating component of {size} voxels near ({start_x},{start_y},{start_z})");
                }
                component += 1;
            }
        }
    }
    assert_eq!(floaters, 0, "{floaters} floating solid components found");
}

#[test]
fn ground_at_matches_generated_chunks() {
    let harness = harness_for(bare_geology_spec());
    let generator = &harness.generator;
    let chunks = steep_chunks(&harness, 512);
    for &(cx, cz) in chunks.iter().take(3) {
        let chunk = harness.generate_chunk(cx, cz);
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        for x in min_x..max_x {
            for z in min_z..max_z {
                // The river stage re-cuts channels and raises levees after
                // the shape stage; ground_at answers the pre-river spine.
                if is_river_or_lake(generator, x, z) {
                    continue;
                }
                let mut top_solid = min_y;
                for y in (min_y..max_y).rev() {
                    if is_solid_id(&harness, chunk.get_voxel(x, y, z)) {
                        top_solid = y;
                        break;
                    }
                }
                assert_eq!(
                    generator.ground_at(x, z),
                    top_solid,
                    "ground_at disagrees with the generated chunk at ({x},{z})"
                );
            }
        }
    }
}

#[test]
fn structures_silence_the_density_term() {
    // With structures added to the geo fixture, the term is masked out
    // over every plan footprint: platforms stay exactly the flat ground
    // the adaptation built — no pockets under huts.
    let mut spec = geology_fixture_spec();
    let base = fixture_spec();
    spec.biomes.registry[0].tags = vec!["is_settled"];
    spec.pieces = base.pieces;
    spec.pools = base.pools;
    spec.structures = base.structures;
    if let Some(set) = spec.structures.first_mut() {
        set.constraints = vec![
            PlacementConstraint::BiomeTag("is_settled"),
            PlacementConstraint::MaxSlope(1.2),
            PlacementConstraint::SurfaceHeight { min: 61, max: 110 },
        ];
    }
    let harness = harness_for(spec);
    let generator = &harness.generator;
    let plans = generator.plans_in_reach((-512, -512), (512, 512));
    assert!(
        !plans.is_empty(),
        "the fixture should place hamlets inside +/-512"
    );

    let mut checked_columns = 0usize;
    for plan in plans.iter().take(3) {
        let (cx_lo, cx_hi) = (
            plan.bbox_min.0.div_euclid(CHUNK as i32),
            (plan.bbox_max.0 - 1).div_euclid(CHUNK as i32),
        );
        let (cz_lo, cz_hi) = (
            plan.bbox_min.2.div_euclid(CHUNK as i32),
            (plan.bbox_max.2 - 1).div_euclid(CHUNK as i32),
        );
        for cx in cx_lo..=cx_hi {
            for cz in cz_lo..=cz_hi {
                let chunk = harness.generate_chunk(cx, cz);
                let Vec3(min_x, min_y, min_z) = chunk.min;
                let Vec3(max_x, _, max_z) = chunk.max;
                for x in plan.bbox_min.0.max(min_x)..plan.bbox_max.0.min(max_x) {
                    for z in plan.bbox_min.2.max(min_z)..plan.bbox_max.2.min(max_z) {
                        checked_columns += 1;
                        // Below the structure the ground must be compact:
                        // no density pocket under a platform.
                        let ground = {
                            let mut y = plan.bbox_min.1 - 1;
                            while y > min_y && chunk.get_voxel(x, y, z) == 0 {
                                y -= 1;
                            }
                            y
                        };
                        for y in (min_y + 1)..ground {
                            assert!(
                                chunk.get_voxel(x, y, z) != 0,
                                "density pocket under a structure at ({x},{y},{z})"
                            );
                        }
                    }
                }
            }
        }
    }
    assert!(checked_columns > 25, "structure columns checked: {checked_columns}");
}

#[test]
fn invalid_density_specs_die_at_compile() {
    let registry = fixture_registry();
    let config = fixture_config();

    let mut narrow_band = geology_fixture_spec();
    if let Some(density) = &mut narrow_band.density {
        density.band = 2.0;
    }
    assert!(compile(&narrow_band, &registry, &config).is_err());

    let mut oversized_amp = geology_fixture_spec();
    if let Some(density) = &mut oversized_amp.density {
        density.amp = density.band + 1.0;
    }
    assert!(compile(&oversized_amp, &registry, &config).is_err());

    let mut bad_shelf = geology_fixture_spec();
    if let Some(density) = &mut bad_shelf.density {
        if let Some(shelf) = &mut density.shelf {
            shelf.spacing = 1.0;
        }
    }
    assert!(compile(&bad_shelf, &registry, &config).is_err());

    let mut no_geology = fixture_spec();
    no_geology.density = geology_fixture_spec().density;
    assert!(
        compile(&no_geology, &registry, &config).is_err(),
        "density without geology must refuse"
    );

    let mut salt_clash = geology_fixture_spec();
    if let Some(density) = &mut salt_clash.density {
        density.salt = SaltPath("geofix.backbone");
    }
    assert!(matches!(
        compile(&salt_clash, &registry, &config),
        Err(GenError::SaltCollision { .. })
    ));
}
