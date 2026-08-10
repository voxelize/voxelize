    use super::*;

    fn test_spec() -> GeologySpec {
        GeologySpec {
            salt: SaltPath("geo.test"),
            cell: 8,
            tile: 512,
            halo_cells: 48,
            plate_cell: 900.0,
            plate_jitter: 0.35,
            plate_warp_amp: 150.0,
            plate_warp_scale: 520.0,
            continental_share: 0.55,
            margin_width: 260.0,
            base_land: 22.0,
            base_ocean: 40.0,
            swell_amp: 20.0,
            swell_scale: 420.0,
            swell_octaves: 4,
            plateau_amp: 20.0,
            plateau_scale: 900.0,
            belt_collision: BeltSpec {
                height: 90.0,
                width: 240.0,
                segment_scale: 360.0,
                segment_depth: 0.5,
                uplift: 1.0,
                root_share: 0.4,
                root_width_factor: 2.2,
            },
            belt_arc: BeltSpec {
                height: 80.0,
                width: 220.0,
                segment_scale: 320.0,
                segment_depth: 0.5,
                uplift: 0.8,
                root_share: 0.35,
                root_width_factor: 2.0,
            },
            arc_inland_offset: 180.0,
            belt_island_arc: BeltSpec {
                height: 50.0,
                width: 140.0,
                segment_scale: 260.0,
                segment_depth: 0.6,
                uplift: 0.5,
                root_share: 0.3,
                root_width_factor: 1.8,
            },
            island_arc_offset: 50.0,
            rift_depth: 20.0,
            rift_width: 170.0,
            trench_depth: 18.0,
            trench_width: 110.0,
            convergence_floor: 0.15,
            belt_strength_span: 0.55,
            iterations: 10,
            fill_every: 3,
            erode_k: 0.05,
            erode_m: 0.5,
            dt: 20.0,
            interior_uplift: 0.04,
            diffusion: 0.006,
            high_diffusion_share: 0.3,
            talus: 6.0,
            uplift_rate: 0.1,
            seed_relief: 6.0,
            snowline: 150.0,
            glacial_iterations: 4,
            glacial_strength: 0.3,
            lake_min_depth: 2.5,
            ceiling_start: 190.0,
            ceiling_max: 240.0,
            channel_area: 60.0,
            channel_area_full: 2500.0,
            river_width: (2.0, 6.0),
            river_depth: (1.0, 3.0),
            river_bank: 4.0,
            detail_amp: 1.5,
            detail_scale: 24.0,
            detail_broad_amp: 1.2,
            detail_broad_scale: 70.0,
            detail_floor: 0.25,
            relief: ReliefSpec {
                rib_amp: 3.0,
                rib_scale: 18.0,
                rib_stretch: 2.5,
                rib_slope: (0.35, 1.0),
                bench_amp: 3.0,
                bench_spacing: 9.0,
                bench_tread: 0.34,
                bench_warp_amp: 7.0,
                bench_warp_scale: 90.0,
                bench_slope: (0.8, 1.6),
                calm_flow: 120.0,
                shore_calm_band: 6.0,
            },
            moisture: MoistureSpec {
                reach: 30.0,
                flow_half: 90.0,
                dry_height: 90.0,
                proximity_weight: 0.5,
                flow_weight: 0.25,
                elevation_weight: 0.25,
            },
            meander_amp: 1.1,
            meander_scale: 70.0,
            riffle_amp: 0.3,
            riffle_scale: 44.0,
            sea_level: 80,
        }
    }

    #[test]
    fn every_land_cell_drains_to_an_outlet() {
        let model = GeoModel::compile(&test_spec(), 77, "geo_test", 0.0).expect("compiles");
        let tile = model.tile(0, 0);
        let side = tile.side;
        let sea = model.spec.sea_level as f32;

        // Rebuild receivers from the tile's own filled surface — the
        // same data the solve used last.
        let filled: Vec<f64> = tile.filled.iter().map(|f| *f as f64).collect();
        let mut receiver = vec![u32::MAX; side * side];
        model.receivers(&filled, &mut receiver, side);

        let mut land = 0usize;
        let mut drained = 0usize;
        for start in 0..side * side {
            if tile.height[start] <= sea {
                continue;
            }
            land += 1;
            let mut current = start;
            let mut is_drained = false;
            for _ in 0..side * side {
                let next = receiver[current] as usize;
                let ix = current / side;
                let iz = current % side;
                let is_edge = ix == 0 || iz == 0 || ix == side - 1 || iz == side - 1;
                if tile.height[current] <= sea || is_edge || next == current {
                    // Sea, tile edge, or a filled-lake outlet plateau:
                    // all legitimate ends of a drainage walk.
                    is_drained = true;
                    break;
                }
                current = next;
            }
            if is_drained {
                drained += 1;
            }
        }
        let share = drained as f64 / land.max(1) as f64;
        println!("drainage: {drained}/{land} land cells reach an outlet ({share:.4})");
        assert!(share >= 0.999, "non-draining terrain: {share:.4}");
    }

    #[test]
    fn fused_surface_is_continuous_across_tile_boundaries() {
        let model = GeoModel::compile(&test_spec(), 91, "geo_seam", 0.0).expect("compiles");
        let boundary = model.spec.tile; // x = 512 is a stride boundary
        let mut worst_at_boundary = 0.0f64;
        let mut worst_elsewhere = 0.0f64;
        for z in (-200..200).step_by(7) {
            let mut previous = model.surface_f(boundary - 40, z);
            for x in (boundary - 39)..(boundary + 40) {
                let here = model.surface_f(x, z);
                let step = (here - previous).abs();
                if (x - boundary).abs() <= 1 {
                    worst_at_boundary = worst_at_boundary.max(step);
                } else {
                    worst_elsewhere = worst_elsewhere.max(step);
                }
                previous = here;
            }
        }
        println!(
            "fusion continuity: worst step at boundary {worst_at_boundary:.2}, elsewhere {worst_elsewhere:.2}"
        );
        // The boundary must not introduce steps beyond what the terrain
        // itself produces anywhere else in the band.
        assert!(
            worst_at_boundary <= worst_elsewhere * 1.5 + 1.0,
            "tile seam visible: {worst_at_boundary:.2} vs {worst_elsewhere:.2}"
        );
    }

    #[test]
    fn channel_levels_are_continuous_across_tile_boundaries() {
        let model = GeoModel::compile(&test_spec(), 91, "geo_seam", 0.0).expect("compiles");
        let boundary = model.spec.tile; // x = 512 is a stride boundary

        // Wherever a channel crosses the seam, the water level sampled
        // just west and just east of it must agree to the pool-and-drop
        // quantum. Before levels derived from the fused surface, the
        // two tiles' own fills disagreed by up to the inter-tile
        // erosion divergence — five-block walls of water at the seam.
        let mut crossings = 0;
        let mut worst = 0.0f64;
        for z in (-1500..1500).step_by(4) {
            let west = model.river_sample(boundary - 2, z);
            let east = model.river_sample(boundary + 2, z);
            let (Some(west), Some(east)) = (west, east) else {
                continue;
            };
            if west.dist > west.half_width || east.dist > east.half_width {
                continue;
            }
            crossings += 1;
            worst = worst.max((west.water_y - east.water_y).abs());
        }
        println!("seam crossings: {crossings}, worst level step {worst:.2}");
        assert!(crossings > 0, "no channel crossed the test seam; widen the scan");
        assert!(
            worst <= 2.0,
            "channel water level jumps {worst:.2} blocks at a tile seam"
        );
    }

    #[test]
    fn contested_seam_basins_answer_dry_on_both_sides() {
        let model = GeoModel::compile(&test_spec(), 91, "geo_seam", 0.0).expect("compiles");
        let cell = model.spec.cell as f64;
        let boundary = model.spec.tile;

        // Wherever the two windows disagree about a lake in the seam
        // band, the verdict must silence both: a lake placed on one
        // side of a belief boundary spills against the other side
        // forever. Agreement means both answer, disagreement means
        // neither does.
        let mut disputed = 0;
        let mut agreed = 0;
        for x in (boundary - 400..boundary + 400).step_by(4) {
            for z in (-1200..1200).step_by(4) {
                let west_tile = model.tile(
                    ((x as f64) / model.spec.tile as f64).floor() as i64 - 1,
                    (z as f64 / model.spec.tile as f64).floor() as i64,
                );
                let own_tile = model.tile(
                    ((x as f64) / model.spec.tile as f64).floor() as i64,
                    (z as f64 / model.spec.tile as f64).floor() as i64,
                );
                let own = own_tile.lake_level_at(cell, x as f64, z as f64);
                let is_covered = west_tile.slot_at(cell, x as f64, z as f64).is_some();
                if !is_covered {
                    continue; // the neighbor holds no belief here
                }
                let neighbor = west_tile.lake_level_at(cell, x as f64, z as f64);
                match (own, neighbor) {
                    (Some((_, a)), Some((_, b))) if (a - b).abs() <= 1.0 => {
                        agreed += 1;
                    }
                    (Some(_), Some(_)) | (Some(_), None) => {
                        // Contested (level clash, or the neighbor
                        // covers this ground without the lake): the
                        // model must not water it.
                        if model.lake_level(x, z).is_some() {
                            disputed += 1;
                        }
                    }
                    _ => {}
                }
            }
        }
        println!("agreed lake cells: {agreed}, contested-but-watered: {disputed}");
        assert_eq!(
            disputed, 0,
            "{disputed} contested seam lake cells still answer with water"
        );
    }

    #[test]
    fn rejected_seam_basins_keep_their_rivers() {
        // The dry verdict silences the lake, not the drainage: a cell
        // in a rejected basin that carries channel-grade flow must
        // still sample a river channel, or seam disputes turn whole
        // reaches into empty depressions. Rejected basins with real
        // flow are rare, so walk a deterministic seed ladder until one
        // window holds evidence.
        let mut rejected_channel_cells = 0usize;
        let mut wet = 0usize;
        for seed in [91u32, 17, 23, 47, 65] {
            let model = GeoModel::compile(&test_spec(), seed, "geo_seam", 0.0).expect("compiles");
            let spec = model.spec.clone();
            let cell = spec.cell as f64;
            let halo = spec.halo_cells as usize;
            let sea = spec.sea_level as f64;
            for tile_x in -2..=2i64 {
                for tile_z in -2..=2i64 {
                    let tile = model.tile(tile_x, tile_z);
                    let hydro = model.hydro(tile_x, tile_z);
                    let side = tile.side;
                    for ix in halo..side - halo {
                        for iz in halo..side - halo {
                            let index = ix * side + iz;
                            if !tile.lake[index] || hydro.lake_keep[index] {
                                continue;
                            }
                            if (tile.flow[index] as f64) < spec.channel_area
                                || (tile.filled[index] as f64) <= sea
                            {
                                continue;
                            }
                            let x = tile.origin_x as f64 + (ix as f64 + 0.5) * cell;
                            let z = tile.origin_z as f64 + (iz as f64 + 0.5) * cell;
                            if model.fused_height_raw(x, z) <= sea {
                                continue;
                            }
                            rejected_channel_cells += 1;
                            if model
                                .river_sample(x.round() as i32, z.round() as i32)
                                .is_some()
                            {
                                wet += 1;
                            }
                        }
                    }
                }
            }
            if rejected_channel_cells > 0 {
                println!("evidence found at seed {seed}");
                break;
            }
        }
        println!(
            "rejected-basin channel cells: {rejected_channel_cells}, still carrying a channel: {wet}"
        );
        assert!(
            rejected_channel_cells > 0,
            "scan window found no rejected-basin channel cells; widen the window or move the seed so this test tests something"
        );
        assert!(
            wet * 10 >= rejected_channel_cells * 9,
            "{}/{} rejected-basin channel cells lost their river",
            rejected_channel_cells - wet,
            rejected_channel_cells
        );
    }

    #[test]
    fn geology_is_query_order_independent() {
        let spec = test_spec();
        let forward = GeoModel::compile(&spec, 123, "geo_order", 0.0).expect("compiles");
        let reverse = GeoModel::compile(&spec, 123, "geo_order", 0.0).expect("compiles");

        let points: Vec<(i32, i32)> = (0..60)
            .map(|i| (((i * 97) % 1400) - 700, ((i * 61) % 1400) - 700))
            .collect();

        let heights_forward: Vec<f64> =
            points.iter().map(|(x, z)| forward.surface_f(*x, *z)).collect();
        let heights_reverse: Vec<f64> = points
            .iter()
            .rev()
            .map(|(x, z)| reverse.surface_f(*x, *z))
            .collect();

        for (index, (x, z)) in points.iter().enumerate() {
            let a = heights_forward[index];
            let b = heights_reverse[points.len() - 1 - index];
            assert!(
                a.to_bits() == b.to_bits(),
                "query order changed the surface at ({x},{z}): {a} vs {b}"
            );
        }
        assert_eq!(forward.tile_digest(0, 0), reverse.tile_digest(0, 0));
    }
