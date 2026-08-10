//! The 3D density spine, held to its contract: genuine overhangs, arches,
//! shelves, and undercuts appear where the mask opens — restrained, band
//! bounded, connected to the ground body, silent around structures, and
//! consistent between the pure `ground_at` query and the generated
//! chunks. The fixture disables carvers so every cavity in the band is
//! the density term's own.

#[path = "fixtures/mod.rs"]
mod fixtures;

use fixtures::*;

use rayon::prelude::*;
use voxelize::{Vec3, VoxelAccess};
use voxelize_gen::*;

fn density_harness() -> Harness {
    let mut spec = density_fixture_spec();
    spec.carvers = vec![];
    harness_for(spec)
}

fn is_solid_id(harness: &Harness, id: u32) -> bool {
    if id == 0 {
        return false;
    }
    let block = harness.registry.get_block_by_id(id);
    !block.is_fluid && !block.is_passable
}

#[test]
fn density_chunks_are_order_and_thread_independent() {
    let harness = density_harness();
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

#[test]
fn density_produces_restrained_overhangs_and_undercuts() {
    let harness = density_harness();
    let generator = &harness.generator;
    let band = 5i32;

    let mut columns = 0usize;
    let mut overhang_columns = 0usize;
    let mut undercut_columns = 0usize;
    let mut lifted_columns = 0usize;

    for cx in -3..3 {
        for cz in -3..3 {
            let chunk = harness.generate_chunk(cx, cz);
            let Vec3(min_x, min_y, min_z) = chunk.min;
            let Vec3(max_x, _, max_z) = chunk.max;
            for x in min_x..max_x {
                for z in min_z..max_z {
                    columns += 1;
                    let surface = generator.surface_raw(x, z);

                    // Band bound: no solid above surface + band, no air
                    // below surface - band (carvers are off).
                    for y in (surface + band + 1)..(surface + band + 6) {
                        let id = chunk.get_voxel(x, y, z);
                        assert!(
                            !is_solid_id(&harness, id),
                            "solid above the density band at ({x},{y},{z}), surface {surface}"
                        );
                    }
                    for y in (min_y + 1)..(surface - band).max(min_y + 1) {
                        assert!(
                            chunk.get_voxel(x, y, z) != 0,
                            "air below the density band at ({x},{y},{z}), surface {surface}"
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
                    if is_solid_id(&harness, chunk.get_voxel(x, surface + 1, z)) {
                        lifted_columns += 1;
                    }
                }
            }
        }
    }

    let share = overhang_columns as f64 / columns as f64;
    println!(
        "density features: {overhang_columns} overhang columns ({share:.4} share), \
         {undercut_columns} undercuts, {lifted_columns} lifted lips over {columns} columns"
    );
    assert!(
        overhang_columns > 20,
        "the density band never produced overhangs: {overhang_columns}"
    );
    assert!(
        undercut_columns > 5,
        "the subtractive side never bit below the surface: {undercut_columns}"
    );
    assert!(
        lifted_columns > 5,
        "the additive side never grew above the surface: {lifted_columns}"
    );
    assert!(
        share < 0.20,
        "density must stay restrained: {share:.4} of columns carry overhangs"
    );
}

#[test]
fn no_floating_disconnected_components() {
    let harness = density_harness();
    // One 2x2-chunk window, solid-labeled and 6-connectivity flooded:
    // every solid component must touch the window floor or a side wall
    // (arch abutments may stand outside the window).
    let (min_x, min_z) = (0, 0);
    let (max_x, max_z) = (32, 32);
    let max_y = HEIGHT as i32;

    let mut solid = vec![false; (32 * 32 * HEIGHT) as usize];
    let index_of =
        |x: i32, y: i32, z: i32| ((x * 32 + z) * HEIGHT as i32 + y) as usize;
    for cx in 0..2 {
        for cz in 0..2 {
            let chunk = harness.generate_chunk(cx, cz);
            let Vec3(cmin_x, _, cmin_z) = chunk.min;
            let Vec3(cmax_x, _, cmax_z) = chunk.max;
            for x in cmin_x..cmax_x {
                for z in cmin_z..cmax_z {
                    for y in 0..max_y {
                        let id = chunk.get_voxel(x, y, z);
                        if is_solid_id(&harness, id) {
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
    let harness = density_harness();
    let generator = &harness.generator;
    let plans = generator.plans_in_reach((-64, -64), (96, 96));
    for cx in 0..2 {
        for cz in 0..2 {
            let chunk = harness.generate_chunk(cx, cz);
            let Vec3(min_x, min_y, min_z) = chunk.min;
            let Vec3(max_x, max_y, max_z) = chunk.max;
            for x in min_x..max_x {
                for z in min_z..max_z {
                    let is_structure_ground = plans.iter().any(|plan| {
                        x >= plan.bbox_min.0 - 8
                            && x < plan.bbox_max.0 + 8
                            && z >= plan.bbox_min.2 - 8
                            && z < plan.bbox_max.2 + 8
                    });
                    if is_structure_ground {
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
}

#[test]
fn structures_silence_the_density_term() {
    // With structures present, the term is masked out over every plan
    // footprint: platforms stay exactly the flat ground the adaptation
    // built, no lips, no undercuts.
    let mut spec = density_fixture_spec();
    spec.carvers = vec![];
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
                        // no air pocket from the density term.
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

    let mut zero_amp = density_fixture_spec();
    if let Some(density) = &mut zero_amp.density {
        density.amplitude = 0.5;
    }
    assert!(matches!(
        compile(&zero_amp, &registry, &config),
        Err(GenError::OutOfRange { .. })
    ));

    let mut wide_amp = density_fixture_spec();
    if let Some(density) = &mut wide_amp.density {
        density.amplitude = 9.0;
    }
    assert!(matches!(
        compile(&wide_amp, &registry, &config),
        Err(GenError::OutOfRange { .. })
    ));

    let mut bad_strata = density_fixture_spec();
    if let Some(density) = &mut bad_strata.density {
        density.strata = Some(DensityStrata {
            period: 1.0,
            contrast: 0.4,
        });
    }
    assert!(matches!(
        compile(&bad_strata, &registry, &config),
        Err(GenError::Invalid { .. })
    ));

    let mut salt_clash = density_fixture_spec();
    if let Some(density) = &mut salt_clash.density {
        density.salt = SaltPath("fixture.zones");
    }
    assert!(matches!(
        compile(&salt_clash, &registry, &config),
        Err(GenError::SaltCollision { .. })
    ));
}
