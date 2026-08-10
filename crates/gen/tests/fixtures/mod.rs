//! Shared, content-free fixtures for integration tests and benchmarks: a
//! test-local block registry, a generator spec exercising every mechanism,
//! and the layered reference terrain stack that gates the field layer's
//! expressiveness. Nothing here is game content — blocks are `Test *`
//! placeholders and salts live under a `fixture.`/`ref.` namespace.

// Each test/bench target compiles this module and uses a subset of it.
#![allow(dead_code)]

use std::sync::Arc;

use voxelize::{
    Block, BlockFaces, Chunk, ChunkOptions, ChunkStage, Registry, Resources, Vec3, VoxelAccess,
    WorldConfig,
};
use voxelize_gen::*;

pub const CHUNK: usize = 16;
pub const HEIGHT: usize = 128;
pub const SEED: u32 = 424242;

pub fn fixture_registry() -> Registry {
    let mut registry = Registry::new();
    let simple = |name: &str, id: u32| {
        Block::new(name)
            .id(id)
            .faces(&BlockFaces::six_faces().build())
            .build()
    };
    registry.register_blocks(&[
        simple("Test Stone", 1),
        simple("Test Dirt", 2),
        simple("Test Grass", 3),
        simple("Test Sand", 4),
        Block::new("Test Water")
            .id(5)
            .is_fluid(true)
            .is_passable(true)
            .faces(&BlockFaces::six_faces().build())
            .build(),
        simple("Test Plank", 6),
        simple("Test Cobble", 7),
        Block::new("Test Tuft")
            .id(8)
            .is_passable(true)
            .faces(&BlockFaces::six_faces().build())
            .build(),
        simple("Test Dry Grass", 9),
        simple("Test Lush Grass", 10),
        simple("Test Snow", 11),
        simple("Test Log A", 12),
        Block::new("Test Leaves A")
            .id(13)
            .is_passable(true)
            .faces(&BlockFaces::six_faces().build())
            .build(),
        simple("Test Log B", 14),
        Block::new("Test Leaves B")
            .id(15)
            .is_passable(true)
            .faces(&BlockFaces::six_faces().build())
            .build(),
        Block::new("Test Fern")
            .id(16)
            .is_passable(true)
            .faces(&BlockFaces::six_faces().build())
            .build(),
    ]);
    registry
}

pub fn fixture_config() -> WorldConfig {
    WorldConfig::new()
        .seed(SEED)
        .chunk_size(CHUNK)
        .max_height(HEIGHT)
        .sub_chunks(4)
        .build()
}

pub fn hut_piece() -> PieceDef {
    PieceBuilder::new("hut", 5, 5, 5)
        .fill((0, 0, 0), (4, 0, 4), "Test Cobble")
        .walls((0, 1, 0), (4, 3, 4), "Test Plank")
        .fill((0, 4, 0), (4, 4, 4), "Test Plank")
        .clear((2, 1, 0), (2, 2, 0))
        .socket("door", (2, 1, 0), Dir4::North, "paths")
        .anchor((2, 0, 2))
        .build()
}

pub fn path_piece() -> PieceDef {
    PieceBuilder::new("path", 3, 1, 3)
        .fill((0, 0, 0), (2, 0, 2), "Test Cobble")
        .socket("in", (1, 0, 2), Dir4::South, "paths")
        .socket("out", (1, 0, 0), Dir4::North, "paths")
        .anchor((1, 0, 1))
        .build()
}

pub fn path_end_piece() -> PieceDef {
    PieceBuilder::new("path_end", 1, 1, 1)
        .fill((0, 0, 0), (0, 0, 0), "Test Cobble")
        .socket("in", (0, 0, 0), Dir4::South, "paths")
        .anchor((0, 0, 0))
        .build()
}

pub fn fixture_spec() -> GeneratorSpec {
    let base_height = {
        let mut b = FieldGraphBuilder::new();
        let n = b.fbm("fixture.continent", 1.0 / 300.0, 5, 0.5, 2.0);
        let wx = b.fbm("fixture.warp_x", 1.0 / 140.0, 2, 0.5, 2.0);
        let wz = b.fbm("fixture.warp_z", 1.0 / 140.0, 2, 0.5, 2.0);
        let warped = b.warp(n, wx, wz, 24.0);
        b.spline(
            warped,
            &[(-1.0, 34.0), (-0.2, 44.0), (0.1, 52.0), (0.6, 66.0), (1.0, 84.0)],
        );
        b.build()
    };
    let mountains_gate = {
        let mut b = FieldGraphBuilder::new();
        let n = b.fbm("fixture.mtn_gate", 1.0 / 500.0, 3, 0.5, 2.0);
        let unit = b.scale(n, 4.0);
        b.gate(unit, 0.4, 1.0);
        b.build()
    };
    let mountains_lift = {
        let mut b = FieldGraphBuilder::new();
        let n = b.ridged("fixture.mtn", 1.0 / 160.0, 4, 0.5, 2.0);
        let shifted = b.offset(n, -0.55);
        let crest = b.clamp(shifted, 0.0, 0.4);
        b.scale(crest, 90.0);
        b.build()
    };
    let temperature = {
        let mut b = FieldGraphBuilder::new();
        b.fbm("fixture.temperature", 1.0 / 400.0, 3, 0.5, 2.0);
        b.build()
    };

    GeneratorSpec {
        preset: "fixture",
        format_version: FORMAT_VERSION,
        content_version: Version::new(1, 0, 0),
        dimension: DimensionSpec {
            key: "fixture_dim",
            height: HEIGHT as u32,
            base_block: "Test Stone",
            sky_presentation_key: "default",
            capabilities: DimCapabilities {
                has_open_sky: true,
                has_global_sea: true,
                is_fall_from_world_fatal: false,
                tags: vec![],
            },
        },
        topology: TopologySpec::Heightfield(HeightfieldLane {
            base_height,
            relief: vec![ReliefLayer {
                key: "mountains",
                gate: mountains_gate,
                lift: mountains_lift,
            }],
            slope_probe: 2,
        }),
        climate: ClimateSpec {
            axes: vec![(AxisKey("temperature"), temperature)],
        },
        biomes: BiomeSetSpec {
            registry: vec![
                BiomeGenParams {
                    key: BiomeKey("meadow"),
                    surface_table: "meadow",
                    carver_mask: 0b1,
                    tags: vec!["is_settled"],
                    dressing: vec![DressingSpec {
                        block: "Test Tuft",
                        chance: 0.4,
                        cluster: Some(ClusterSpec {
                            salt: SaltPath("fixture.tuft_groves"),
                            frequency: 1.0 / 40.0,
                            octaves: 2,
                            low: 0.02,
                            high: 0.14,
                        }),
                    }],
                },
                BiomeGenParams {
                    key: BiomeKey("dunes"),
                    surface_table: "dunes",
                    carver_mask: 0b1,
                    tags: vec![],
                    dressing: vec![],
                },
                BiomeGenParams {
                    key: BiomeKey("shore"),
                    surface_table: "dunes",
                    carver_mask: 0,
                    tags: vec![],
                    dressing: vec![],
                },
            ],
            partition: BiomePartition::Zoned(ZonedPartition {
                salt: SaltPath("fixture.zones"),
                cell_size: 180.0,
                jitter: 0.35,
                warp_amplitude: 20.0,
                entries: vec![
                    ZoneEntry {
                        biome: BiomeKey("meadow"),
                        weight: 0.7,
                        constraint: None,
                    },
                    ZoneEntry {
                        biome: BiomeKey("dunes"),
                        weight: 0.3,
                        constraint: Some(AxisWindow {
                            axis: AxisKey("temperature"),
                            low: 0.0,
                            high: 1.0,
                        }),
                    },
                ],
                transition: TransitionSpec { width: 16.0 },
            }),
            overlays: vec![OverlayRule::ShoreBand {
                biome: BiomeKey("shore"),
                from_below_sea: 2,
                to_above_sea: 2,
            }],
        },
        surface: SurfaceSpec {
            tables: vec![
                (
                    "meadow",
                    SurfaceTable {
                        rules: vec![
                            SurfaceRule {
                                when: vec![
                                    SurfaceCond::DepthBelowTop { min: 0, max: 0 },
                                    SurfaceCond::IsAboveFluid,
                                    SurfaceCond::SteepnessBelow { max: 1.6 },
                                ],
                                place: "Test Grass",
                            },
                            SurfaceRule {
                                when: vec![SurfaceCond::DepthBelowTop { min: 0, max: 2 }],
                                place: "Test Dirt",
                            },
                            SurfaceRule {
                                when: vec![],
                                place: "Test Stone",
                            },
                        ],
                    },
                ),
                (
                    "dunes",
                    SurfaceTable {
                        rules: vec![
                            SurfaceRule {
                                when: vec![SurfaceCond::DepthBelowTop { min: 0, max: 3 }],
                                place: "Test Sand",
                            },
                            SurfaceRule {
                                when: vec![],
                                place: "Test Stone",
                            },
                        ],
                    },
                ),
            ],
            patch_fields: vec![],
        },
        carvers: vec![
            CarverSpec::TunnelPair(TunnelPairSpec {
                salt: SaltPath("fixture.tunnels"),
                frequency: 1.0 / 60.0,
                y_squash: 0.6,
                half_width: 0.07,
                width_mod_frequency: 1.0 / 48.0,
                width_mod_amplitude: 0.4,
                floor_y: 6,
                floor_fade: 4,
                min_roof_depth: 8,
                roof_fade: 6,
                deep_widen: Some((20, 1.4)),
                entrances: EntranceSpec {
                    is_enabled: true,
                    min_slope: 0.8,
                    full_slope: 1.6,
                    window: (0.5, 0.75),
                    mouth_widen: 0.4,
                },
                mask_bit: 0,
            }),
            CarverSpec::Cavern(CavernSpec {
                salt: SaltPath("fixture.halls"),
                frequency: 1.0 / 90.0,
                y_squash: 0.55,
                threshold: 0.20,
                max_y: 34,
                min_roof_depth: 12,
                detail_frequency: 1.0 / 14.0,
                detail_amplitude: 0.04,
                mask_bit: 0,
            }),
        ],
        hydrology: HydrologySpec {
            sea: Some(SeaSpec {
                level: 46,
                fluid: "Test Water",
            }),
            aquifers: Some(AquiferSpec {
                salt: SaltPath("fixture.aquifer"),
                cell: 64.0,
                level_range: (18, 40),
                min_roof: 10,
                fluid: "Test Water",
            }),
            lava: None,
        },
        pieces: vec![hut_piece(), path_piece(), path_end_piece()],
        pools: vec![
            Pool {
                key: "huts",
                entries: vec![("hut", 1.0)],
                terminators: vec!["path_end"],
            },
            Pool {
                key: "paths",
                entries: vec![("path", 1.0)],
                terminators: vec!["path_end"],
            },
        ],
        structures: vec![StructureSetSpec {
            key: "hamlets",
            salt: SaltPath("structure.fixture_hamlets"),
            members: vec![StructureMember {
                key: "hamlet",
                weight: 1.0,
                source: StructureSource::Pooled {
                    start_pool: "huts",
                    max_depth: 3,
                    max_pieces: 6,
                },
            }],
            placement: PlacementPolicy::CellSites {
                cell: 96.0,
                chance: 0.6,
                jitter: 0.3,
            },
            constraints: vec![
                PlacementConstraint::BiomeTag("is_settled"),
                PlacementConstraint::MaxSlope(1.2),
                PlacementConstraint::SurfaceHeight { min: 47, max: 100 },
            ],
            adaptation: AdaptationSpec::Platform { falloff: 4 },
            max_reach: (24, 16, 24),
            phase: PopulatePhase::Major,
        }],
        geology: None,
        density: None,
        rivers: None,
        river_materials: None,
        flora: vec![],
        species: vec![],
        ecology: None,
        mosaic: None,
    }
}

/// The layered multi-scale reference stack: continents shaped by a smooth
/// spline, an erosion control damping mid/high-frequency detail, mountain
/// chains from anisotropic ridged-multifractal noise under two nested
/// domain warps confined to belts, curvature-derived valley cuts through
/// those chains, and high-frequency billow detail. Built purely from
/// engine primitives — the acceptance gates in `terrain_quality.rs` hold
/// this stack (and therefore the API) to professional terrain standards.
pub fn reference_stack() -> FieldGraph {
    let mut b = FieldGraphBuilder::new();

    let continents = b.fbm("ref.continents", 1.0 / 1400.0, 3, 0.5, 2.0);
    let continent_shape = b.smooth_spline(
        continents,
        &[
            (-0.28, -42.0),
            (-0.12, -16.0),
            (-0.04, -5.0),
            (0.02, 4.0),
            (0.10, 13.0),
            (0.22, 26.0),
            (0.32, 38.0),
        ],
    );

    let erosion = b.fbm("ref.erosion", 1.0 / 700.0, 3, 0.5, 2.0);
    let erosion_damp = b.smooth_spline(
        erosion,
        &[(-0.25, 1.0), (-0.05, 0.72), (0.08, 0.34), (0.25, 0.10)],
    );

    let hills = b.fbm("ref.hills", 1.0 / 180.0, 5, 0.5, 2.0);
    let hills_scaled = b.scale(hills, 55.0);
    let hills_eroded = b.mul(hills_scaled, erosion_damp);

    let chains_raw = b.ridged_multi("ref.chains", 1.0 / 420.0, 5, 0.5, 2.0, 1.0, 2.0);
    // Orient the chains off-axis with unit vectors (0.8, 0.6) and stretch
    // them 1.6:1 along the ridge direction.
    let chains_oriented = b.affine(chains_raw, 0.5, 0.375, -0.96, 1.28, 0.0, 0.0);
    let wx_micro = b.fbm("ref.warp.micro.x", 1.0 / 130.0, 3, 0.5, 2.0);
    let wz_micro = b.fbm("ref.warp.micro.z", 1.0 / 130.0, 3, 0.5, 2.0);
    let chains_wobbled = b.warp(chains_oriented, wx_micro, wz_micro, 24.0);
    let wx_macro = b.fbm("ref.warp.macro.x", 1.0 / 1100.0, 2, 0.5, 2.0);
    let wz_macro = b.fbm("ref.warp.macro.z", 1.0 / 1100.0, 2, 0.5, 2.0);
    let chains = b.warp(chains_wobbled, wx_macro, wz_macro, 300.0);

    let belts = b.fbm("ref.belts", 1.0 / 900.0, 2, 0.5, 2.0);
    let belt_gate = b.gate(belts, 0.01, 0.14);
    let interior_gate = b.gate(continents, 0.04, 0.16);
    let chain_gate = b.mul(belt_gate, interior_gate);

    let chain_height = b.smooth_spline(
        chains,
        &[(-1.0, 0.0), (-0.30, 3.0), (0.20, 22.0), (0.65, 70.0), (1.0, 118.0)],
    );
    // Valley influence: positive curvature marks hollows in the chain
    // field; cut them deeper so drainage reads through the ranges.
    let chain_curvature = b.curvature_of(chains, 10.0);
    let valley_cut = b.smooth_spline(
        chain_curvature,
        &[(-0.02, 1.0), (0.0, 0.9), (0.015, 0.55), (0.04, 0.30)],
    );
    let chains_carved = b.mul(chain_height, valley_cut);
    let chain_lift = b.mul(chains_carved, chain_gate);

    let detail = b.billow("ref.detail", 1.0 / 36.0, 4, 0.5, 2.0);
    let detail_scaled = b.scale(detail, 6.0);
    let detail_eroded = b.mul(detail_scaled, erosion_damp);

    let sea_floor = b.constant(58.0);
    let with_continents = b.add(sea_floor, continent_shape);
    let with_hills = b.add(with_continents, hills_eroded);
    let with_chains = b.add(with_hills, chain_lift);
    b.add(with_chains, detail_eroded);

    b.build()
}

/// A small, fast geology world over the fixture registry: analytic
/// plates and a short erosion solve, drainage rivers, shelf/notch 3D
/// density, a ground mosaic, and a two-community ecology with
/// named-species canopies. Numbers are sized for a 128-block world and
/// test-speed tile solves.
pub fn geology_fixture_spec() -> GeneratorSpec {
    let mut spec = fixture_spec();
    spec.preset = "geology_fixture";
    spec.dimension.key = "geology_fixture_dim";
    // The heightfield lane is inert on geology worlds but still
    // compiles; keep it minimal so its salts stay out of the way.
    spec.topology = TopologySpec::Heightfield(HeightfieldLane {
        base_height: {
            let mut b = FieldGraphBuilder::new();
            b.constant(64.0);
            b.build()
        },
        relief: vec![],
        slope_probe: 2,
    });
    spec.carvers = vec![];
    spec.structures = vec![];
    spec.pieces = vec![];
    spec.pools = vec![];
    spec.biomes.partition = BiomePartition::Single(BiomeKey("meadow"));
    spec.biomes.overlays = vec![];
    spec.biomes.registry.truncate(1);
    spec.hydrology = HydrologySpec {
        sea: Some(SeaSpec {
            level: 60,
            fluid: "Test Water",
        }),
        aquifers: None,
        lava: None,
    };
    spec.geology = Some(GeologySpec {
        salt: SaltPath("geofix.backbone"),
        cell: 8,
        tile: 256,
        halo_cells: 24,
        plate_cell: 700.0,
        plate_jitter: 0.35,
        plate_warp_amp: 110.0,
        plate_warp_scale: 420.0,
        continental_share: 0.6,
        margin_width: 200.0,
        base_land: 16.0,
        base_ocean: 28.0,
        swell_amp: 12.0,
        swell_scale: 320.0,
        swell_octaves: 3,
        plateau_amp: 10.0,
        plateau_scale: 700.0,
        belt_collision: BeltSpec {
            height: 46.0,
            width: 180.0,
            segment_scale: 280.0,
            segment_depth: 0.5,
            uplift: 1.0,
            root_share: 0.4,
            root_width_factor: 2.2,
        },
        belt_arc: BeltSpec {
            height: 40.0,
            width: 170.0,
            segment_scale: 260.0,
            segment_depth: 0.5,
            uplift: 0.8,
            root_share: 0.35,
            root_width_factor: 2.0,
        },
        arc_inland_offset: 130.0,
        belt_island_arc: BeltSpec {
            height: 26.0,
            width: 110.0,
            segment_scale: 220.0,
            segment_depth: 0.6,
            uplift: 0.5,
            root_share: 0.3,
            root_width_factor: 1.8,
        },
        island_arc_offset: 40.0,
        rift_depth: 12.0,
        rift_width: 130.0,
        trench_depth: 10.0,
        trench_width: 90.0,
        convergence_floor: 0.15,
        belt_strength_span: 0.55,
        iterations: 6,
        fill_every: 2,
        erode_k: 0.05,
        erode_m: 0.5,
        dt: 20.0,
        interior_uplift: 0.04,
        diffusion: 0.006,
        high_diffusion_share: 0.3,
        talus: 6.0,
        uplift_rate: 0.1,
        seed_relief: 5.0,
        snowline: 96.0,
        glacial_iterations: 2,
        glacial_strength: 0.3,
        lake_min_depth: 2.5,
        ceiling_start: 104.0,
        ceiling_max: 122.0,
        channel_area: 40.0,
        channel_area_full: 1200.0,
        river_width: (2.0, 5.0),
        river_depth: (1.0, 2.5),
        river_bank: 3.0,
        detail_amp: 1.2,
        detail_scale: 22.0,
        detail_broad_amp: 1.0,
        detail_broad_scale: 60.0,
        detail_floor: 0.25,
        relief: ReliefSpec {
            rib_amp: 2.5,
            rib_scale: 16.0,
            rib_stretch: 2.5,
            rib_slope: (0.35, 1.0),
            bench_amp: 2.5,
            bench_spacing: 8.0,
            bench_tread: 0.34,
            bench_warp_amp: 6.0,
            bench_warp_scale: 80.0,
            bench_slope: (0.8, 1.6),
            calm_flow: 90.0,
            shore_calm_band: 5.0,
        },
        moisture: MoistureSpec {
            reach: 26.0,
            flow_half: 70.0,
            dry_height: 50.0,
            proximity_weight: 0.5,
            flow_weight: 0.25,
            elevation_weight: 0.25,
        },
        meander_amp: 1.0,
        meander_scale: 60.0,
        riffle_amp: 0.3,
        riffle_scale: 40.0,
        sea_level: 60,
    });
    spec.density = Some(DensitySpec {
        salt: SaltPath("geofix.density"),
        band: 6.0,
        amp: 4.0,
        shelf: Some(ShelfSpec {
            spacing: 9.0,
            resistant_share: 0.45,
            warp_amp: 4.0,
            warp_scale: 70.0,
            lens_scale: 40.0,
            lens_squash: 3.0,
            slope: (0.7, 1.4),
            relief: 3.0,
        }),
        notch: Some(NotchSpec {
            depth: 3.0,
            height: 4.0,
            slope: (0.6, 1.2),
            scale: 36.0,
            river_reach: 10.0,
        }),
    });
    spec.river_materials = Some(RiverMaterials {
        water: "Test Water",
        bed: "Test Cobble",
        bank: "Test Sand",
    });
    spec.mosaic = Some(MosaicSpec {
        salt: SaltPath("geofix.mosaic"),
        tone_dry_below: 0.25,
        tone_lush_above: 0.6,
        tone_dither: 0.08,
        tone_scale: 40.0,
        grass_block: "Test Grass",
        dry_block: "Test Dry Grass",
        lush_block: "Test Lush Grass",
        stone_block: "Test Stone",
        patches: vec![SubstratePatch {
            block: "Test Dirt",
            scale: 26.0,
            threshold: 0.16,
            slope: (0.0, 1.2),
            moisture: (0.0, 1.0),
        }],
        strata: Some(StrataSpec {
            blocks: vec!["Test Stone", "Test Cobble"],
            spacing: 9.0,
            warp_amp: 5.0,
            warp_scale: 60.0,
        }),
        talus: Some(TalusSpec {
            block: "Test Cobble",
            probe: 3,
            min_face_rise: 4.0,
            slope: (0.4, 1.4),
        }),
        snow: Some(SnowSpec {
            line: 92.0,
            band: 6.0,
            aspect_shift: 4.0,
            noise_amp: 3.0,
            noise_scale: 40.0,
            scour_slope: 1.5,
            snow_block: "Test Snow",
            rock_block: "Test Stone",
        }),
    });
    spec.ecology = Some(EcologySpec {
        salt: SaltPath("geofix.ecology"),
        cell: 48.0,
        ecotone: 0.25,
        lane_moisture_reach: 0.0,
        communities: vec![
            CommunityDef {
                key: "pine_stand",
                biomes: vec!["meadow"],
                surface: (61, 100),
                max_slope: 1.2,
                moisture: (0.0, 1.0),
                weight: 0.6,
                canopy: Some(CanopySpec {
                    cell: 22.0,
                    cluster_chance: 0.8,
                    points: (2, 4),
                    spread: 8.0,
                    species: vec![("pine", 1.0)],
                    cohesion: 0.9,
                    age_spread: 0.3,
                    max_slope: 1.0,
                    avoid_river_within: 4.0,
                }),
                edge_species: vec![("birchling", 0.8)],
                floor: FloorSpec {
                    density: 0.2,
                    plants: vec![("Test Fern", 1.0)],
                    riparian_boost: 2.0,
                    riparian_band: 8.0,
                },
            },
            CommunityDef {
                key: "wet_meadow",
                biomes: vec!["meadow"],
                surface: (61, 100),
                max_slope: 0.8,
                moisture: (0.0, 1.0),
                weight: 0.4,
                canopy: None,
                edge_species: vec![],
                floor: FloorSpec {
                    density: 0.3,
                    plants: vec![("Test Tuft", 1.0)],
                    riparian_boost: 2.0,
                    riparian_band: 8.0,
                },
            },
        ],
    });
    spec.species = vec![
        SpeciesDef {
            key: "pine",
            log: "Test Log A",
            leaves: "Test Leaves A",
            form: TreeForm::Conic,
        },
        SpeciesDef {
            key: "birchling",
            log: "Test Log B",
            leaves: "Test Leaves B",
            form: TreeForm::Slender,
        },
    ];
    spec
}

/// The heightfield fixture with walker rivers, a riparian flora set, and
/// the ecology field — the lane-world composition Town's savannah and
/// coastline run.
pub fn walker_fixture_spec() -> GeneratorSpec {
    let mut spec = fixture_spec();
    spec.rivers = Some(RiverSpec {
        salt: SaltPath("fixture.rivers"),
        tile: 256,
        sources_per_tile: 6,
        min_source_height: 52,
        max_steps: 260,
        width: (1.5, 4.0),
        depth: (1.0, 2.5),
        bank: 2.0,
        carve_through: 1.5,
    });
    spec.river_materials = Some(RiverMaterials {
        water: "Test Water",
        bed: "Test Cobble",
        bank: "Test Sand",
    });
    spec.ecology = Some(EcologySpec {
        salt: SaltPath("fixture.ecology"),
        cell: 44.0,
        ecotone: 0.25,
        lane_moisture_reach: 24.0,
        communities: vec![
            CommunityDef {
                key: "oakwood",
                biomes: vec!["meadow"],
                surface: (47, 100),
                max_slope: 1.2,
                moisture: (0.0, 1.0),
                weight: 0.7,
                canopy: Some(CanopySpec {
                    cell: 20.0,
                    cluster_chance: 0.75,
                    points: (2, 4),
                    spread: 7.0,
                    species: vec![("oak", 1.0)],
                    cohesion: 0.9,
                    age_spread: 0.3,
                    max_slope: 1.0,
                    avoid_river_within: 4.0,
                }),
                edge_species: vec![("birch", 0.8)],
                floor: FloorSpec {
                    density: 0.25,
                    plants: vec![("Test Fern", 0.7), ("Test Tuft", 0.3)],
                    riparian_boost: 2.5,
                    riparian_band: 7.0,
                },
            },
            CommunityDef {
                key: "birch_fringe",
                biomes: vec!["meadow"],
                surface: (47, 100),
                max_slope: 1.0,
                moisture: (0.0, 1.0),
                weight: 0.3,
                canopy: Some(CanopySpec {
                    cell: 24.0,
                    cluster_chance: 0.7,
                    points: (1, 3),
                    spread: 6.0,
                    species: vec![("birch", 1.0)],
                    cohesion: 0.95,
                    age_spread: 0.25,
                    max_slope: 0.9,
                    avoid_river_within: 4.0,
                }),
                edge_species: vec![],
                floor: FloorSpec {
                    density: 0.15,
                    plants: vec![("Test Tuft", 1.0)],
                    riparian_boost: 2.0,
                    riparian_band: 6.0,
                },
            },
        ],
    });
    spec.flora = vec![FloraSetSpec {
        key: "riverside_snags",
        salt: SaltPath("fixture.flora.snags"),
        biomes: vec!["meadow", "dunes"],
        cell: 36.0,
        cluster_chance: 0.5,
        gate_frequency: 0.0,
        gate_window: (-1.0, 1.0),
        points: (1, 2),
        spread: 5.0,
        species: vec![("snag", 1.0)],
        max_slope: 1.2,
        near_river: Some(10.0),
        avoid_river_within: 3.0,
        min_surface: Some(47),
        max_surface: None,
    }];
    spec.species = vec![
        SpeciesDef {
            key: "oak",
            log: "Test Log A",
            leaves: "Test Leaves A",
            form: TreeForm::Round,
        },
        SpeciesDef {
            key: "birch",
            log: "Test Log B",
            leaves: "Test Leaves B",
            form: TreeForm::Slender,
        },
        SpeciesDef {
            key: "snag",
            log: "Test Log A",
            leaves: "Test Leaves A",
            form: TreeForm::Snag,
        },
    ];
    spec
}

pub struct Harness {
    pub registry: Registry,
    pub config: WorldConfig,
    pub generator: Arc<CompiledGenerator>,
    pub stages: Vec<Box<dyn ChunkStage + Send + Sync>>,
}

pub fn harness() -> Harness {
    harness_for(fixture_spec())
}

pub fn harness_for(spec: GeneratorSpec) -> Harness {
    let registry = fixture_registry();
    let config = fixture_config();
    let generator = compile(&spec, &registry, &config).expect("fixture compiles");
    let mut stages: Vec<Box<dyn ChunkStage + Send + Sync>> = vec![
        Box::new(stages::GenShapeStage::new(Arc::clone(&generator))),
        Box::new(stages::GenSurfaceStage::new(Arc::clone(&generator))),
        Box::new(stages::GenCarveStage::new(Arc::clone(&generator))),
        Box::new(stages::GenPopulateStage::new(Arc::clone(&generator))),
    ];
    if generator.geo().is_some() || generator.walker_rivers().is_some() {
        stages.push(Box::new(stages::RiverStage::new(Arc::clone(&generator))));
    }
    stages.push(Box::new(stages::FloraStage::new(Arc::clone(&generator))));
    Harness {
        registry,
        config,
        generator,
        stages,
    }
}

impl Harness {
    pub fn generate_chunk(&self, cx: i32, cz: i32) -> Chunk {
        let options = ChunkOptions {
            size: CHUNK,
            max_height: HEIGHT,
            sub_chunks: 4,
        };
        let mut chunk = Chunk::new("test", cx, cz, &options);
        for stage in &self.stages {
            chunk = stage.process(
                chunk,
                Resources {
                    registry: &self.registry,
                    config: &self.config,
                },
                None,
            );
        }
        chunk
    }

    pub fn chunk_digest(&self, chunk: &Chunk) -> u64 {
        let Vec3(min_x, min_y, min_z) = chunk.min;
        let Vec3(max_x, max_y, max_z) = chunk.max;
        let mut hash: u64 = 0xcbf29ce484222325;
        for x in min_x..max_x {
            for z in min_z..max_z {
                for y in min_y..max_y {
                    let voxel = chunk.get_voxel(x, y, z) as u64;
                    hash ^= voxel.wrapping_add(0x9e3779b97f4a7c15);
                    hash = hash.wrapping_mul(0x100000001b3);
                }
            }
        }
        hash
    }
}
