//! Deterministic world generation mechanisms for Voxelize.
//!
//! This crate is content-free: it knows blocks as resolved ids, biomes as
//! opaque keys assigned dense ids at compile, and nothing about any
//! particular game. Content (biome definitions, presets, structure pieces)
//! lives with the embedding game and is handed in as a `GeneratorSpec`,
//! which `compile` validates into an immutable `CompiledGenerator` or
//! refuses with a precise `GenError`.
//!
//! Everything derives from five-component seed streams — no global RNG, no
//! draw that depends on chunk order or thread scheduling — and every noise
//! path uses IEEE add/mul/floor/sqrt only, so worlds are bit-identical
//! across platforms by construction. This crate is the authority for the
//! spec format (`FORMAT_VERSION`) and its compatibility rules.

pub mod carve;
pub mod climate;
pub mod debug;
pub mod diag;
pub mod field;
pub mod hydro;
pub mod lane;
pub mod noise;
pub mod spec;
pub mod stages;
pub mod stream;
pub mod structures;
pub mod surface;

pub use carve::{CarverSpec, CavernSpec, EntranceSpec, TunnelPairSpec};
pub use climate::{
    AxisKey, AxisWindow, BiomeBlend, BiomeGenParams, BiomeId, BiomeKey, BiomePartition,
    BiomeSetSpec, ClimateBox, ClimatePartition, ClimateRegion, ClimateSpec, ClusterSpec,
    DressingSpec, OverlayRule, TransitionSpec, ZoneEntry, ZonedPartition,
};
pub use debug::{GenDebug, MapLayer, MapRequest};
pub use diag::{
    autocorrelation, band_shares, local_maxima, relief_windows, repetition_score, FieldGrid,
    FieldStats,
};
pub use field::{
    FieldGraph, FieldGraphBuilder, FieldNode, FieldProgram, SplineEasing, SplinePoints,
    MAX_FIELD_NODES,
};
pub use hydro::{AquiferSpec, HydrologySpec, LavaSpec, SeaSpec, VoidMaterial};
pub use lane::{HeightfieldLane, ReliefLayer, TopologySpec};
pub use noise::{Fractal, NoiseKind, Perlin};
pub use spec::{
    check_compat, compile, CompatVerdict, CompiledGenerator, DimCapabilities, DimensionSpec,
    GenError, GeneratorIdentity, GeneratorSpec, Version, ENGINE_SALT_PREFIX, FORMAT_VERSION,
};
pub use stages::install;
pub use stream::{
    cell_id, fnv1a_64, hash_unit, mix64, stream_seed, HashStream, SaltPath, Subsystem,
};
pub use structures::{
    AdaptationSpec, Dir4, PieceBuilder, PieceDef, PlacementConstraint, PlacementPolicy, Pool,
    PopulatePhase, RejectionReason, RejectionStats, Socket, StructureMember, StructurePlan,
    StructureSetSpec, StructureSource, TerrainView,
};
pub use surface::{SurfaceCond, SurfaceRule, SurfaceSpec, SurfaceTable};
