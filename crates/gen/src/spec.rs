//! The generator spec and its compiler. Content hands in a `GeneratorSpec`
//! (typed, versioned, serializable); `compile` validates every reference
//! and range against the block registry and world config, then builds the
//! immutable `CompiledGenerator` the chunk stages and debug tools share.
//! Any problem refuses the boot with a precise error — there is no
//! fallback biome, no default block, and no partially-compiled generator.

use std::fmt;
use std::sync::Arc;

use hashbrown::{HashMap, HashSet};
use serde::Serialize;
use smallvec::SmallVec;
use voxelize::{Registry, WorldConfig};

use crate::carve::{CarveLattices, CarverSpec, CompiledCarvers};
use crate::climate::{
    compile_climate, BiomeBlend, BiomeGenParams, BiomeId, BiomeKey, BiomeSetSpec, CompiledClimate,
    CompiledDressing, CompiledPartition, MAX_AXES,
};
use crate::density::CompiledDensity;
use crate::ecology::CompiledEcology;
use crate::flora::CompiledFlora;
use crate::geology::{GeoGrid, GeoModel};
use crate::hydro::{CompiledHydrology, HydrologySpec, VoidMaterial};
use crate::lane::{CompiledLane, LaneGrid, TopologySpec};
use crate::mosaic::CompiledMosaic;
use crate::rivers::CompiledRivers;
use crate::stream::{cell_id, fnv1a_64, hash_unit, mix64, stream_seed, HashStream, SaltPath, Subsystem};
use crate::structures::{
    CompiledStructures, GroundPatch, PieceDef, Pool, StructurePlan, StructureSetSpec, TerrainView,
};
use crate::surface::{CompiledSurface, SurfaceColumnCtx, SurfaceSpec};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct Version {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
}

impl Version {
    pub const fn new(major: u16, minor: u16, patch: u16) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

pub const FORMAT_VERSION: u32 = 1;

/// Salt namespace reserved for engine-internal streams (border dither,
/// dressing rolls); content salts may not claim it.
pub const ENGINE_SALT_PREFIX: &str = "engine.";

/// Registers a content salt, refusing reserved prefixes and collisions.
pub(crate) fn claim_salt(
    salt: &SaltPath,
    used_salts: &mut HashSet<&'static str>,
) -> Result<(), GenError> {
    if salt.0.starts_with(ENGINE_SALT_PREFIX) {
        return Err(GenError::ReservedSalt {
            salt: salt.0.to_string(),
        });
    }
    if !used_salts.insert(salt.0) {
        return Err(GenError::SaltCollision {
            salt: salt.0.to_string(),
        });
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct DimCapabilities {
    pub has_open_sky: bool,
    pub has_global_sea: bool,
    pub is_fall_from_world_fatal: bool,
    pub tags: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DimensionSpec {
    pub key: &'static str,
    pub height: u32,
    /// Block filling solid terrain before surface rules repaint it.
    pub base_block: &'static str,
    pub sky_presentation_key: &'static str,
    pub capabilities: DimCapabilities,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeneratorSpec {
    pub preset: &'static str,
    pub format_version: u32,
    pub content_version: Version,
    pub dimension: DimensionSpec,
    pub topology: TopologySpec,
    pub climate: crate::climate::ClimateSpec,
    pub biomes: BiomeSetSpec,
    pub surface: SurfaceSpec,
    pub carvers: Vec<CarverSpec>,
    pub hydrology: HydrologySpec,
    pub pieces: Vec<PieceDef>,
    pub pools: Vec<Pool>,
    pub structures: Vec<StructureSetSpec>,
    /// The solved height backbone. When set it replaces the topology
    /// lane as the terrain spine: plate graph, erosion tiles, drainage,
    /// lakes. Rivers then come from flow accumulation, so `rivers` must
    /// stay `None`.
    pub geology: Option<crate::geology::GeologySpec>,
    /// 3D density in the spine's surface band: strata shelving and
    /// waterline notches. Requires `geology`.
    pub density: Option<crate::density::DensitySpec>,
    /// Walker-solved rivers for lane worlds (geology worlds derive
    /// theirs from drainage instead).
    pub rivers: Option<crate::rivers::RiverSpec>,
    /// Blocks the river stage writes; required whenever rivers exist —
    /// walker-routed or geology drainage. The engine names no blocks.
    pub river_materials: Option<crate::rivers::RiverMaterials>,
    /// Azonal flora sets: riparian galleries, lone landmark trees.
    /// Closed-canopy vegetation belongs to `ecology` communities.
    pub flora: Vec<crate::flora::FloraSetSpec>,
    pub species: Vec<crate::flora::SpeciesDef>,
    /// The community field: exclusive patch ownership, canopy mixes
    /// rolled per stand, understory floors, ecotone edges.
    pub ecology: Option<crate::ecology::EcologySpec>,
    /// Ground mosaic over the surface tables: grass tones, substrate
    /// patches, strata, talus, ragged snowline. Requires `geology` (its
    /// moisture and aspect terms read the solved model).
    pub mosaic: Option<crate::mosaic::MosaicSpec>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeneratorIdentity {
    pub preset: String,
    pub format_version: u32,
    pub content_version: Version,
    pub world_seed: u32,
    pub spec_hash: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompatVerdict {
    Identical,
    ContentDrift,
    FormatDrift,
    DifferentPreset,
    DifferentSeed,
}

pub fn check_compat(recorded: &GeneratorIdentity, current: &GeneratorIdentity) -> CompatVerdict {
    if recorded.preset != current.preset {
        return CompatVerdict::DifferentPreset;
    }
    if recorded.world_seed != current.world_seed {
        return CompatVerdict::DifferentSeed;
    }
    if recorded.format_version != current.format_version {
        return CompatVerdict::FormatDrift;
    }
    if recorded.spec_hash != current.spec_hash
        || recorded.content_version != current.content_version
    {
        return CompatVerdict::ContentDrift;
    }
    CompatVerdict::Identical
}

#[derive(Debug)]
pub enum GenError {
    EmptyGraph { path: String },
    GraphTooLarge { path: String, got: usize, max: usize },
    ForwardReference { path: String, node: usize, target: usize },
    SaltCollision { salt: String },
    ReservedSalt { salt: String },
    OutOfRange { path: String, what: &'static str, got: f64 },
    InvalidSpline { path: String, reason: &'static str },
    TooManyAxes { got: usize, max: usize },
    DuplicateAxis { axis: String },
    UnknownAxis { axis: String },
    EmptyPartition,
    NoFallbackZoneEntry,
    BoxAxisMismatch { biome: String, got: usize, expected: usize },
    UnknownBiome { key: String },
    DuplicateBiome { key: String },
    UnknownBlock { name: String },
    DuplicateSurfaceTable { key: String },
    SurfaceTableNotExhaustive { key: String },
    UnknownPatchField { field: String },
    UnknownSurfaceTable { key: String, biome: String },
    DuplicatePiece { key: String },
    PieceShapeMismatch { key: String },
    EmptyPool { key: String },
    UnknownPiece { key: String },
    UnknownPool { key: String },
    PoolCannotTerminate { key: String },
    DuplicateSet { key: String },
    UnknownSet { key: String },
    HeightMismatch { spec: u32, config: u32 },
    UnsupportedFormatVersion { got: u32, supported: u32 },
    /// Validation failures from the geology/density/rivers/ecology/
    /// flora/mosaic compilers, which report precise messages of their
    /// own.
    Content { message: String },
}

impl fmt::Display for GenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GenError::EmptyGraph { path } => write!(f, "{path}: field graph has no nodes"),
            GenError::GraphTooLarge { path, got, max } => {
                write!(f, "{path}: field graph has {got} nodes; the cap is {max}")
            }
            GenError::ForwardReference { path, node, target } => {
                write!(f, "{path}: node {node} references later node {target}")
            }
            GenError::SaltCollision { salt } => {
                write!(f, "salt {salt:?} is used by more than one stream")
            }
            GenError::ReservedSalt { salt } => {
                write!(f, "salt {salt:?} uses the reserved \"engine.\" namespace")
            }
            GenError::OutOfRange { path, what, got } => {
                write!(f, "{path}: {what} out of range (got {got})")
            }
            GenError::InvalidSpline { path, reason } => write!(f, "{path}: invalid spline: {reason}"),
            GenError::TooManyAxes { got, max } => {
                write!(f, "climate declares {got} axes; the cap is {max}")
            }
            GenError::DuplicateAxis { axis } => write!(f, "duplicate climate axis {axis:?}"),
            GenError::UnknownAxis { axis } => write!(f, "unknown climate axis {axis:?}"),
            GenError::EmptyPartition => write!(f, "biome partition has no entries"),
            GenError::NoFallbackZoneEntry => {
                write!(f, "zoned partition needs at least one unconstrained entry")
            }
            GenError::BoxAxisMismatch { biome, got, expected } => write!(
                f,
                "climate box for {biome} has {got} intervals, partition uses {expected} axes"
            ),
            GenError::UnknownBiome { key } => write!(f, "unknown biome key {key:?}"),
            GenError::DuplicateBiome { key } => write!(f, "duplicate biome key {key:?}"),
            GenError::UnknownBlock { name } => {
                write!(f, "block {name:?} is not in the registry")
            }
            GenError::DuplicateSurfaceTable { key } => {
                write!(f, "duplicate surface table {key:?}")
            }
            GenError::SurfaceTableNotExhaustive { key } => write!(
                f,
                "surface table {key:?} must end in an unconditional rule"
            ),
            GenError::UnknownPatchField { field } => {
                write!(f, "surface rule references unknown patch field {field:?}")
            }
            GenError::UnknownSurfaceTable { key, biome } => {
                write!(f, "biome {biome} references unknown surface table {key:?}")
            }
            GenError::DuplicatePiece { key } => write!(f, "duplicate structure piece {key:?}"),
            GenError::PieceShapeMismatch { key } => {
                write!(f, "piece {key:?} cell buffer does not match its size")
            }
            GenError::EmptyPool { key } => write!(f, "pool {key:?} has no entries"),
            GenError::UnknownPiece { key } => write!(f, "unknown structure piece {key:?}"),
            GenError::UnknownPool { key } => write!(f, "unknown structure pool {key:?}"),
            GenError::PoolCannotTerminate { key } => write!(
                f,
                "pool {key:?} is socket-reachable but has no terminator pieces"
            ),
            GenError::DuplicateSet { key } => write!(f, "duplicate structure set {key:?}"),
            GenError::UnknownSet { key } => write!(f, "unknown structure set {key:?}"),
            GenError::HeightMismatch { spec, config } => write!(
                f,
                "dimension height {spec} disagrees with world config max_height {config}"
            ),
            GenError::UnsupportedFormatVersion { got, supported } => write!(
                f,
                "spec format version {got} unsupported (this build supports {supported})"
            ),
            GenError::Content { message } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for GenError {}

struct BiomeRuntime {
    params: BiomeGenParams,
    surface_table: usize,
    dressing: Vec<CompiledDressing>,
}

pub struct CompiledGenerator {
    pub identity: GeneratorIdentity,
    pub dimension_key: String,
    pub sky_presentation_key: String,
    pub capabilities: DimCapabilities,
    pub world_seed: u32,
    pub height: u32,
    base_block: u32,
    dither_seed: u64,
    dressing_seed: u64,
    climate: CompiledClimate,
    partition: CompiledPartition,
    lane: CompiledLane,
    surface: CompiledSurface,
    hydro: CompiledHydrology,
    carvers: CompiledCarvers,
    structures: CompiledStructures,
    biomes: Vec<BiomeRuntime>,
    geo: Option<Arc<GeoModel>>,
    density: Option<CompiledDensity>,
    rivers: Option<CompiledRivers>,
    /// Resolved (water, bed, bank) ids; present exactly when rivers are.
    river_materials: Option<(u32, u32, u32)>,
    ecology: Option<CompiledEcology>,
    flora: CompiledFlora,
    mosaic: Option<CompiledMosaic>,
    /// Per-community understory palettes resolved to block ids, indexed
    /// like the ecology's communities.
    floor_palettes: Vec<Vec<(u32, f64)>>,
    floor_seed: u64,
    spec_json: String,
}

/// One prefetched terrain grid per chunk, from whichever spine the world
/// runs on.
pub(crate) enum TerrainGrid {
    Lane(LaneGrid),
    Geo(GeoGrid),
}

impl TerrainGrid {
    #[inline]
    pub(crate) fn surface_raw(&self, x: i32, z: i32) -> i32 {
        match self {
            TerrainGrid::Lane(grid) => grid.surface_raw(x, z),
            TerrainGrid::Geo(grid) => grid.surface_raw(x, z),
        }
    }

    #[inline]
    pub(crate) fn steepness(&self, x: i32, z: i32) -> f64 {
        match self {
            TerrainGrid::Lane(grid) => grid.steepness(x, z),
            TerrainGrid::Geo(grid) => grid.steepness(x, z),
        }
    }
}

pub fn compile(
    spec: &GeneratorSpec,
    registry: &Registry,
    config: &WorldConfig,
) -> Result<Arc<CompiledGenerator>, GenError> {
    if spec.format_version != FORMAT_VERSION {
        return Err(GenError::UnsupportedFormatVersion {
            got: spec.format_version,
            supported: FORMAT_VERSION,
        });
    }
    if spec.dimension.height != config.max_height as u32 {
        return Err(GenError::HeightMismatch {
            spec: spec.dimension.height,
            config: config.max_height as u32,
        });
    }

    let resolve_block = |name: &str| -> Result<u32, GenError> {
        registry
            .try_get_id_by_name(name)
            .ok_or_else(|| GenError::UnknownBlock {
                name: name.to_string(),
            })
    };

    let mut used_salts: HashSet<&'static str> = HashSet::new();
    let dimension = spec.dimension.key;
    let world_seed = config.seed;

    let climate = compile_climate(&spec.climate, world_seed, dimension, &mut used_salts)?;

    let mut biome_ids: HashMap<BiomeKey, BiomeId> = HashMap::new();
    for (index, params) in spec.biomes.registry.iter().enumerate() {
        if biome_ids
            .insert(params.key, BiomeId(index as u16))
            .is_some()
        {
            return Err(GenError::DuplicateBiome {
                key: params.key.0.to_string(),
            });
        }
    }
    let resolve_biome = |key: &BiomeKey| -> Result<BiomeId, GenError> {
        biome_ids.get(key).copied().ok_or_else(|| GenError::UnknownBiome {
            key: key.0.to_string(),
        })
    };

    let partition = CompiledPartition::compile(
        &spec.biomes,
        &climate,
        &resolve_biome,
        world_seed,
        dimension,
        &mut used_salts,
    )?;

    let lane = CompiledLane::compile(
        &spec.topology,
        spec.dimension.height,
        world_seed,
        dimension,
        &mut used_salts,
    )?;

    let surface = CompiledSurface::compile(
        &spec.surface,
        &resolve_block,
        world_seed,
        dimension,
        &mut used_salts,
    )?;

    let mut biomes = Vec::new();
    for params in &spec.biomes.registry {
        let table = surface
            .table_index(params.surface_table)
            .ok_or_else(|| GenError::UnknownSurfaceTable {
                key: params.surface_table.to_string(),
                biome: params.key.0.to_string(),
            })?;
        let mut dressing = Vec::new();
        for entry in &params.dressing {
            dressing.push(CompiledDressing::compile(
                entry,
                &params.key,
                &resolve_block,
                world_seed,
                dimension,
                &mut used_salts,
            )?);
        }
        biomes.push(BiomeRuntime {
            params: params.clone(),
            surface_table: table,
            dressing,
        });
    }

    let hydro = CompiledHydrology::compile(
        &spec.hydrology,
        &resolve_block,
        world_seed,
        dimension,
        &mut used_salts,
    )?;
    let carvers = CompiledCarvers::compile(&spec.carvers, world_seed, dimension, &mut used_salts)?;
    let structures = CompiledStructures::compile(
        &spec.pieces,
        &spec.pools,
        &spec.structures,
        &resolve_block,
        world_seed,
        dimension,
        config.chunk_size as i32,
        &mut used_salts,
    )?;

    let content = |message: String| GenError::Content { message };

    // Every subsystem salt joins the one collision namespace: a geology
    // backbone reusing a field salt (or any pair colliding) refuses at
    // boot instead of silently correlating streams.
    if let Some(geology) = &spec.geology {
        claim_salt(&geology.salt, &mut used_salts)?;
    }
    if let Some(density) = &spec.density {
        claim_salt(&density.salt, &mut used_salts)?;
    }
    if let Some(rivers) = &spec.rivers {
        claim_salt(&rivers.salt, &mut used_salts)?;
    }
    if let Some(ecology) = &spec.ecology {
        claim_salt(&ecology.salt, &mut used_salts)?;
    }
    for set in &spec.flora {
        claim_salt(&set.salt, &mut used_salts)?;
    }
    if let Some(mosaic) = &spec.mosaic {
        claim_salt(&mosaic.salt, &mut used_salts)?;
    }

    let geo = match &spec.geology {
        Some(geology) => Some(Arc::new(
            GeoModel::compile(geology, world_seed, dimension).map_err(content)?,
        )),
        None => None,
    };
    let density = match (&spec.density, &geo) {
        (Some(density), Some(_)) => Some(
            CompiledDensity::compile(density, world_seed, dimension).map_err(content)?,
        ),
        (Some(_), None) => {
            return Err(content(
                "spec.density requires spec.geology: the density band hangs off the solved spine"
                    .to_string(),
            ))
        }
        _ => None,
    };
    let rivers = match (&spec.rivers, &geo) {
        (Some(rivers), None) => Some(
            CompiledRivers::compile(rivers, hydro.sea_level(), world_seed, dimension)
                .map_err(content)?,
        ),
        (Some(_), Some(_)) => {
            return Err(content(
                "spec.rivers must be None on geology worlds: rivers come from the solved drainage"
                    .to_string(),
            ))
        }
        _ => None,
    };
    let is_river_world = rivers.is_some() || geo.is_some();
    let river_materials = match (&spec.river_materials, is_river_world) {
        (Some(materials), true) => Some((
            resolve_block(materials.water)?,
            resolve_block(materials.bed)?,
            resolve_block(materials.bank)?,
        )),
        (Some(_), false) => {
            return Err(content(
                "spec.river_materials without rivers: drop it or add a routing".to_string(),
            ))
        }
        (None, true) => {
            return Err(content(
                "rivers need spec.river_materials (water, bed, bank blocks): the engine names no blocks"
                    .to_string(),
            ))
        }
        (None, false) => None,
    };
    let ecology = match &spec.ecology {
        Some(ecology) => Some(
            CompiledEcology::compile(ecology, world_seed, dimension).map_err(content)?,
        ),
        None => None,
    };
    let flora = CompiledFlora::compile(
        &spec.flora,
        &spec.species,
        ecology.as_ref(),
        registry,
        world_seed,
        dimension,
    )
    .map_err(content)?;
    let mosaic = match (&spec.mosaic, &geo) {
        (Some(mosaic), Some(_)) => Some(
            CompiledMosaic::compile(mosaic, registry, world_seed, dimension).map_err(content)?,
        ),
        (Some(_), None) => {
            return Err(content(
                "spec.mosaic requires spec.geology: its moisture and aspect terms read the solved model"
                    .to_string(),
            ))
        }
        _ => None,
    };

    let mut floor_palettes = Vec::new();
    let mut floor_seed = 0u64;
    if let Some(ecology_spec) = &spec.ecology {
        floor_seed = stream_seed(
            world_seed,
            dimension,
            Subsystem::Structures,
            &ecology_spec.salt,
            4,
        );
        for community in &ecology_spec.communities {
            let mut palette = Vec::new();
            for (name, weight) in &community.floor.plants {
                palette.push((resolve_block(name)?, *weight));
            }
            floor_palettes.push(palette);
        }
    }

    let spec_json = canonical_json(spec);
    let spec_hash = fnv1a_64(spec_json.as_bytes());

    Ok(Arc::new(CompiledGenerator {
        identity: GeneratorIdentity {
            preset: spec.preset.to_string(),
            format_version: spec.format_version,
            content_version: spec.content_version,
            world_seed,
            spec_hash,
        },
        dimension_key: dimension.to_string(),
        sky_presentation_key: spec.dimension.sky_presentation_key.to_string(),
        capabilities: spec.dimension.capabilities.clone(),
        world_seed,
        height: spec.dimension.height,
        base_block: resolve_block(spec.dimension.base_block)?,
        dither_seed: stream_seed(
            world_seed,
            dimension,
            Subsystem::Partition,
            &SaltPath("engine.surface.dither"),
            0,
        ),
        dressing_seed: stream_seed(
            world_seed,
            dimension,
            Subsystem::Ecology,
            &SaltPath("engine.populate.dressing"),
            0,
        ),
        climate,
        partition,
        lane,
        surface,
        hydro,
        carvers,
        structures,
        biomes,
        geo,
        density,
        rivers,
        river_materials,
        ecology,
        flora,
        mosaic,
        floor_palettes,
        floor_seed,
        spec_json,
    }))
}

fn canonical_json(spec: &GeneratorSpec) -> String {
    // serde_json's default Map is a BTreeMap, so a Value round-trip yields
    // sorted keys — the canonical form goldens and hashes rely on.
    let value = serde_json::to_value(spec).expect("spec serializes");
    serde_json::to_string(&value).expect("value serializes")
}

impl CompiledGenerator {
    pub fn spec_json(&self) -> &str {
        &self.spec_json
    }

    pub fn base_block(&self) -> u32 {
        self.base_block
    }

    pub fn biome_count(&self) -> usize {
        self.biomes.len()
    }

    pub fn biome_key(&self, id: BiomeId) -> &'static str {
        self.biomes[id.0 as usize].params.key.0
    }

    pub fn biome_carver_mask(&self, id: BiomeId) -> u8 {
        self.biomes[id.0 as usize].params.carver_mask
    }

    pub fn biome_surface_table(&self, id: BiomeId) -> usize {
        self.biomes[id.0 as usize].surface_table
    }

    pub fn axes_at(&self, x: i32, z: i32) -> SmallVec<[f64; MAX_AXES]> {
        let mut axes = SmallVec::new();
        self.climate.sample_axes(x, z, &mut axes);
        axes
    }

    pub fn axis_keys(&self) -> Vec<&'static str> {
        self.climate.axis_keys.iter().map(|k| k.0).collect()
    }

    /// Raw spine height: the geology's fused surface when the world has
    /// a solved backbone, the topology lane's otherwise. Every consumer
    /// — structures, stages, debug, rivers, flora — sees one terrain.
    pub fn surface_raw(&self, x: i32, z: i32) -> i32 {
        match &self.geo {
            Some(geo) => geo.surface(x, z),
            None => self.lane.surface_raw(x, z),
        }
    }

    pub fn steepness(&self, x: i32, z: i32) -> f64 {
        match &self.geo {
            Some(geo) => geo.steepness(x, z),
            None => self.lane.steepness(x, z),
        }
    }

    pub(crate) fn terrain_grid(&self, min: (i32, i32), max: (i32, i32)) -> TerrainGrid {
        match &self.geo {
            Some(geo) => TerrainGrid::Geo(geo.grid(min, max)),
            None => TerrainGrid::Lane(self.lane.grid(min, max)),
        }
    }

    /// Spine height adjusted by structure ground patches in reach.
    pub fn surface_adapted(&self, x: i32, z: i32, patches: &[GroundPatch]) -> i32 {
        self.adapt_surface(self.surface_raw(x, z), x, z, patches)
    }

    /// The solved geology backbone, when this world runs on one.
    /// Moisture 0..1: the geology model folds channel proximity,
    /// drainage flow, and elevation; worlds without a backbone answer a
    /// neutral 0.5.
    pub fn moisture_at(&self, x: i32, z: i32) -> f64 {
        match &self.geo {
            Some(geo) => geo.moisture(x, z),
            None => 0.5,
        }
    }

    pub fn geo(&self) -> Option<&Arc<GeoModel>> {
        self.geo.as_ref()
    }

    pub fn density(&self) -> Option<&CompiledDensity> {
        self.density.as_ref()
    }

    /// The 2D density prep for one column: engage gates from slope, the
    /// waterline from sea, solved lakes, and river reaches. Inert when
    /// the world has no density spec.
    pub fn density_column(
        &self,
        x: i32,
        z: i32,
        steepness: f64,
    ) -> crate::density::DensityColumn {
        let Some(density) = &self.density else {
            return crate::density::DensityColumn::inert();
        };
        let mut waterline = self
            .hydro
            .sea_level()
            .map(|sea| sea as f64)
            .unwrap_or(f64::NEG_INFINITY);
        if let Some(geo) = &self.geo {
            if let Some(lake) = geo.lake_level(x, z) {
                waterline = waterline.max(lake);
            }
            let reach = density.notch_river_reach();
            if reach > 0.0 {
                if let Some(point) = geo.channel_within(x, z, reach) {
                    waterline = waterline.max(point.water_y);
                }
            }
        }
        density.column(steepness, waterline)
    }

    pub fn ecology(&self) -> Option<&CompiledEcology> {
        self.ecology.as_ref()
    }

    pub fn flora(&self) -> &CompiledFlora {
        &self.flora
    }

    pub fn mosaic(&self) -> Option<&CompiledMosaic> {
        self.mosaic.as_ref()
    }

    /// Walker rivers on lane worlds; `None` on geology worlds, whose
    /// rivers are the solved drainage (ask the geo model).
    pub fn walker_rivers(&self) -> Option<&CompiledRivers> {
        self.rivers.as_ref()
    }

    /// Resolved (water, bed, bank) block ids for the river stage.
    pub fn river_material_ids(&self) -> Option<(u32, u32, u32)> {
        self.river_materials
    }

    pub fn flora_floor_seed(&self) -> u64 {
        self.floor_seed
    }

    /// Weighted understory pick for one community, 0 when it has none.
    pub fn floor_plant(&self, community: usize, stream: &mut HashStream) -> u32 {
        let Some(palette) = self.floor_palettes.get(community) else {
            return 0;
        };
        if palette.is_empty() {
            return 0;
        }
        let total: f64 = palette.iter().map(|(_, weight)| weight).sum();
        let mut roll = stream.unit() * total;
        for (block, weight) in palette {
            roll -= weight;
            if roll <= 0.0 {
                return *block;
            }
        }
        palette.last().map(|(block, _)| *block).unwrap_or(0)
    }

    pub(crate) fn adapt_surface(
        &self,
        raw: i32,
        x: i32,
        z: i32,
        patches: &[GroundPatch],
    ) -> i32 {
        let raw = raw as f64;
        let mut best: Option<(f64, f64)> = None; // (weight, target)
        for patch in patches {
            let inside_x = x >= patch.min_x && x < patch.max_x;
            let inside_z = z >= patch.min_z && z < patch.max_z;
            let dx = if x < patch.min_x {
                (patch.min_x - x) as f64
            } else if x >= patch.max_x {
                (x - patch.max_x + 1) as f64
            } else {
                0.0
            };
            let dz = if z < patch.min_z {
                (patch.min_z - z) as f64
            } else if z >= patch.max_z {
                (z - patch.max_z + 1) as f64
            } else {
                0.0
            };
            let falloff = patch.falloff.max(1) as f64;
            let dist = (dx * dx + dz * dz).sqrt();
            let weight = if inside_x && inside_z {
                1.0
            } else if dist >= falloff {
                0.0
            } else {
                1.0 - dist / falloff
            };
            if weight > 0.0 && best.map(|(w, _)| weight > w).unwrap_or(true) {
                best = Some((weight, patch.target_y as f64));
            }
        }
        match best {
            Some((weight, target)) => (raw + (target - raw) * weight).round() as i32,
            None => raw as i32,
        }
    }

    pub fn blend_at(&self, x: i32, z: i32, surface: i32) -> BiomeBlend {
        let axes = self.axes_at(x, z);
        let base = self.partition.base_blend(x, z, &axes, &self.climate);
        self.partition
            .apply_overlays(base, surface, self.hydro.sea_level())
    }

    /// Which biome's surface table paints this column: the primary, unless
    /// the border dither hands the column to the secondary.
    pub fn dithered_biome(&self, x: i32, z: i32, blend: &BiomeBlend) -> BiomeId {
        match blend.secondary() {
            Some((secondary, weight)) if weight > 0.0 => {
                let roll = hash_unit(mix64(
                    self.dither_seed ^ mix64(cell_id(x as i64, z as i64)),
                ));
                if (roll as f32) < weight {
                    secondary
                } else {
                    blend.primary
                }
            }
            _ => blend.primary,
        }
    }

    /// Ground-cover block for this column, if the dressing roll and
    /// cluster fields select one. One roll per column walks the entries'
    /// cumulative effective chances.
    pub fn dressing_at(&self, id: BiomeId, x: i32, z: i32) -> Option<u32> {
        let dressing = &self.biomes[id.0 as usize].dressing;
        if dressing.is_empty() {
            return None;
        }
        let roll = hash_unit(mix64(
            self.dressing_seed ^ mix64(cell_id(x as i64, z as i64)),
        ));
        let mut threshold = 0.0;
        for entry in dressing {
            threshold += entry.chance_at(x, z);
            if roll < threshold {
                return Some(entry.block);
            }
        }
        None
    }

    pub fn sea_level(&self) -> Option<i32> {
        self.hydro.sea_level()
    }

    pub fn void_material(&self, x: i32, y: i32, z: i32, surface: i32, roof: i32) -> VoidMaterial {
        self.hydro.void_material(x, y, z, surface, roof)
    }

    pub fn aquifer_level(&self, x: i32, z: i32) -> i32 {
        self.hydro.aquifer_level(x, z)
    }

    pub fn has_carvers(&self) -> bool {
        !self.carvers.is_empty()
    }

    pub fn build_carve_lattices(&self, min: (i32, i32, i32), max: (i32, i32, i32)) -> CarveLattices {
        self.carvers.build_lattices(min, max)
    }

    pub fn is_carved(
        &self,
        lattices: &CarveLattices,
        x: i32,
        y: i32,
        z: i32,
        surface: i32,
        steepness: f64,
        biome_mask: u8,
    ) -> bool {
        self.carvers
            .is_carved(lattices, x, y, z, surface, steepness, biome_mask)
    }

    pub fn structures(&self) -> &CompiledStructures {
        &self.structures
    }

    pub fn plans_in_reach(&self, min: (i32, i32), max: (i32, i32)) -> Vec<Arc<StructurePlan>> {
        self.structures.plans_in_reach(min, max, self)
    }

    pub(crate) fn surface_ctx(
        &self,
        x: i32,
        z: i32,
        surface: i32,
        steepness: f64,
    ) -> SurfaceColumnCtx {
        let mut patch_values = SmallVec::new();
        for program in &self.surface.patch_programs {
            patch_values.push(program.sample2(x, z));
        }
        SurfaceColumnCtx {
            steepness,
            is_under_fluid: self
                .hydro
                .sea_level()
                .map(|sea| surface < sea)
                .unwrap_or(false),
            patch_values,
        }
    }

    pub(crate) fn surface_place(&self, table: usize, depth: u16, y: i32, ctx: &SurfaceColumnCtx) -> u32 {
        self.surface.place(table, depth, y, ctx)
    }

    pub(crate) fn surface_max_depth(&self) -> u16 {
        self.surface.max_depth
    }
}

impl TerrainView for CompiledGenerator {
    fn surface_raw(&self, x: i32, z: i32) -> i32 {
        CompiledGenerator::surface_raw(self, x, z)
    }

    fn steepness(&self, x: i32, z: i32) -> f64 {
        CompiledGenerator::steepness(self, x, z)
    }

    fn biome_has_tag(&self, x: i32, z: i32, tag: &str) -> bool {
        let surface = CompiledGenerator::surface_raw(self, x, z);
        let blend = self.blend_at(x, z, surface);
        self.biomes[blend.primary.0 as usize]
            .params
            .tags
            .contains(&tag)
    }

    fn sea_level(&self) -> Option<i32> {
        self.hydro.sea_level()
    }
}
