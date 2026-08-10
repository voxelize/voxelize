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
        simple("Test Tuft", 8),
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
        density: None,
        mosaic: None,
        rivers: None,
        ecology: None,
        flora: vec![],
        species: vec![],
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
    let stages: Vec<Box<dyn ChunkStage + Send + Sync>> = vec![
        Box::new(stages::GenShapeStage::new(Arc::clone(&generator))),
        Box::new(stages::GenSurfaceStage::new(Arc::clone(&generator))),
        Box::new(stages::GenCarveStage::new(Arc::clone(&generator))),
        Box::new(stages::GenPopulateStage::new(Arc::clone(&generator))),
    ];
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
