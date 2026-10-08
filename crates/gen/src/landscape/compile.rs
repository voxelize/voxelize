//! `compile`: a spec, a kind registry, a role binding, the block registry
//! and the world config in; an immutable [`Landscape`] out, or a
//! path-qualified refusal. There is no fallback block, no default biome
//! and no partially compiled landscape.

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use serde_json::Value;
use voxelize::{Registry, WorldConfig};

use crate::spec::GenError;
use crate::stream::{fnv1a_64, stream_seed_bytes, Subsystem};

use super::cache::ClockCache;
use super::canon;
use super::facts::{ChunkFacts, ColumnFact};
use super::fields::{compile_fields, CompiledFields, FieldsConfig, MacroTiles, SaltClaims, SPINE};
use super::flora::LoweredFlora;
use super::identity::{KindStamp, LandscapeIdentity, ENGINE_ALGO};
use super::lower::{lower_climate, lower_flora, LoweredClimate};
use super::presets::roles::RoleBinding;
use super::registry::KindRegistry;
use super::settle::FluidRules;
use super::spec::{LandscapeSpec, SpecError, WorldFrame, LANDSCAPE_FORMAT};
use super::surface::{DynSurfacer, PaintCtx, ZoneTable};
use super::water::SeaModel;

/// Wavelength of the biome border dither field, in blocks.
pub const DITHER_WAVELENGTH: f64 = 20.0;

/// Cache sizes and the facts halo. Caches change cost, never output; the
/// determinism suite compiles with [`CompileOptions::tiny_caches`] and
/// compares digests.
#[derive(Clone, Debug)]
pub struct CompileOptions {
    /// Dimension key (hashed into every seed).
    pub dimension: String,
    /// Facts LRU budget in bytes.
    pub facts_bytes: usize,
    /// Macro tiles held.
    pub macro_tiles: usize,
    /// Point-query columns held.
    pub columns: usize,
    /// Facts halo, 1..=4.
    pub halo: u8,
    /// Hash-consing in the field compiler (off only in its own tests).
    pub cse: bool,
}

impl Default for CompileOptions {
    fn default() -> Self {
        Self {
            dimension: "surface".to_string(),
            facts_bytes: 24 << 20,
            macro_tiles: 512,
            columns: 1 << 16,
            halo: 2,
            cse: true,
        }
    }
}

impl CompileOptions {
    /// Every cache at capacity one.
    pub fn tiny_caches() -> Self {
        Self {
            facts_bytes: 1,
            macro_tiles: 1,
            columns: 1,
            ..Self::default()
        }
    }
}

/// Field output slots the landscape reads.
#[derive(Clone, Debug)]
pub(crate) struct Slots {
    pub ground: usize,
    pub temperature: usize,
    pub moisture: usize,
    pub kept: Vec<usize>,
}

/// A compiled landscape: immutable, shared between threads.
pub struct Landscape {
    pub(crate) spec: LandscapeSpec,
    pub(crate) frame: WorldFrame,
    pub(crate) identity: LandscapeIdentity,
    pub(crate) chunk_size: i32,
    pub(crate) halo: i32,
    pub(crate) fields: CompiledFields,
    pub(crate) slots: Slots,
    pub(crate) kept_names: Vec<String>,
    pub(crate) climate: LoweredClimate,
    /// The border dither field: biome borders interfinger along it in
    /// tongues a few blocks across, never as per-column speckle.
    pub(crate) dither: super::fields::eval::NoiseKernel,
    pub(crate) surfacers: Vec<Box<dyn DynSurfacer>>,
    pub(crate) fill: u32,
    pub(crate) sea: SeaModel,
    pub(crate) flora: Option<LoweredFlora>,
    pub(crate) roles: BTreeMap<String, Option<u32>>,
    pub(crate) block_roles: BTreeMap<u32, String>,
    pub(crate) zones: ZoneTable,
    pub(crate) tiles: MacroTiles,
    pub(crate) facts_cache: ClockCache<(i32, i32), Arc<ChunkFacts>>,
    pub(crate) columns: ClockCache<(i32, i32), Arc<ColumnFact>>,
    pub(crate) spawn: OnceLock<(i32, i32)>,
    pub(crate) lints: Vec<String>,
    pub(crate) has_tints: bool,
    pub(crate) explain_fields: OnceLock<CompiledFields>,
    pub(crate) tiles_explain: MacroTiles,
}

impl std::fmt::Debug for Landscape {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Landscape")
            .field("preset", &self.spec.preset)
            .field("identity", &self.identity)
            .finish_non_exhaustive()
    }
}

/// Compile `spec` with default options.
pub fn compile(
    spec: &LandscapeSpec,
    kinds: &KindRegistry,
    bindings: &RoleBinding,
    blocks: &Registry,
    config: &WorldConfig,
) -> Result<Arc<Landscape>, GenError> {
    compile_with(
        spec,
        kinds,
        bindings,
        blocks,
        config,
        &CompileOptions::default(),
    )
}

/// Compile `spec` with explicit options.
pub fn compile_with(
    spec: &LandscapeSpec,
    kinds: &KindRegistry,
    bindings: &RoleBinding,
    blocks: &Registry,
    config: &WorldConfig,
    options: &CompileOptions,
) -> Result<Arc<Landscape>, GenError> {
    Ok(Arc::new(build(
        spec, kinds, bindings, blocks, config, options,
    )?))
}

fn build(
    spec: &LandscapeSpec,
    kinds: &KindRegistry,
    bindings: &RoleBinding,
    blocks: &Registry,
    config: &WorldConfig,
    options: &CompileOptions,
) -> Result<Landscape, SpecError> {
    if spec.format != LANDSCAPE_FORMAT {
        return Err(SpecError::new(
            "format",
            format!(
                "format {} unsupported (this build reads {LANDSCAPE_FORMAT})",
                spec.format
            ),
        ));
    }
    if spec.frame.height != config.max_height as u32 {
        return Err(SpecError::new(
            "frame.height",
            format!(
                "{} disagrees with the world config's max_height {}",
                spec.frame.height, config.max_height
            ),
        ));
    }
    if !(1..=4).contains(&options.halo) {
        return Err(SpecError::new("", "the facts halo must be 1..=4"));
    }
    let frame = WorldFrame::from_spec(&spec.frame)?;
    let world_seed = config.seed;
    let dimension = options.dimension.as_str();
    if spec.claim_keys.len() > 16 {
        return Err(SpecError::new("claim_keys", "at most 16 game claim keys"));
    }
    // Plugin kinds arrive in P2b: only disabled nodes compile here.
    for (id, node) in &spec.nodes {
        if node.enabled {
            return Err(SpecError::new(
                format!("nodes.{id}.kind"),
                format!(
                    "unknown kind {:?}: landform, region solver and site set kinds are not registered in this build",
                    node.kind
                ),
            ));
        }
    }

    // Roles.
    let (roles, roles_digest, block_roles) = resolve_roles(spec, bindings, blocks)?;
    let fill = roles
        .get(&spec.fill)
        .ok_or_else(|| SpecError::new("fill", format!("undeclared role {:?}", spec.fill)))?
        .ok_or_else(|| SpecError::new("fill", "the fill role must bind to a block"))?;

    let mut salts = SaltClaims::default();
    for (id, node) in &spec.nodes {
        salts.claim(
            &node.salt,
            &format!("nodes.{id}.salt"),
            &format!("node:{id}"),
        )?;
    }

    // Fields: the spine, climate, axes and kept fields are outputs.
    if !spec.fields.contains_key(SPINE) {
        return Err(SpecError::new(
            "fields",
            format!("the spine field {SPINE:?} is not declared"),
        ));
    }
    let mut outputs: Vec<String> = Vec::new();
    let slot_of = |name: &str, outputs: &mut Vec<String>| -> usize {
        match outputs.iter().position(|o| o == name) {
            Some(i) => i,
            None => {
                outputs.push(name.to_string());
                outputs.len() - 1
            }
        }
    };
    let ground_slot = slot_of(SPINE, &mut outputs);
    for (path, name) in [
        (
            "biomes.climate.temperature",
            &spec.biomes.climate.temperature,
        ),
        ("biomes.climate.moisture", &spec.biomes.climate.moisture),
    ] {
        if !spec.fields.contains_key(name) {
            return Err(SpecError::new(path, format!("undeclared field {name:?}")));
        }
    }
    let temperature_slot = slot_of(&spec.biomes.climate.temperature, &mut outputs);
    let moisture_slot = slot_of(&spec.biomes.climate.moisture, &mut outputs);
    let kept_names: Vec<String> = spec
        .fields
        .iter()
        .filter(|(_, d)| d.keep)
        .map(|(n, _)| n.clone())
        .collect();
    let kept_slots: Vec<usize> = kept_names
        .iter()
        .map(|n| slot_of(n, &mut outputs))
        .collect();
    // Axis fields (lowered with the climate below) join the outputs first.
    let mut climate_outputs = outputs.clone();
    let mut axis_slot = |name: &str| -> Result<usize, SpecError> {
        if !spec.fields.contains_key(name) {
            return Err(SpecError::new("", format!("undeclared field {name:?}")));
        }
        Ok(match climate_outputs.iter().position(|o| o == name) {
            Some(i) => i,
            None => {
                climate_outputs.push(name.to_string());
                climate_outputs.len() - 1
            }
        })
    };
    let climate = lower_climate(
        &spec.biomes,
        &frame,
        world_seed,
        dimension,
        &mut salts,
        &mut axis_slot,
    )?;
    let outputs = climate_outputs;
    let fields = compile_fields(
        &spec.fields,
        &outputs,
        &FieldsConfig {
            frame: &frame,
            world_seed,
            dimension,
            taste: &spec.taste,
            cse: options.cse,
        },
        &mut salts,
    )?;

    let zones = ZoneTable::new(spec.zones.keys())?;

    // Surfacers.
    let mut surfacers = Vec::new();
    let mut typed_paint = Vec::new();
    let mut stamps: Vec<KindStamp> = Vec::new();
    for (i, node) in spec.paint.iter().enumerate() {
        let mut cx = PaintCtx {
            path: format!("paint.{i}"),
            frame: &frame,
            world_seed,
            dimension,
            roles: &roles,
            zones: &zones,
            kept: &kept_names,
            biomes: &climate.biome_keys,
            salts: &mut salts,
            roles_used: Vec::new(),
        };
        let (s, typed, version) = kinds.build_surfacer(&node.kind, node.params.clone(), &mut cx)?;
        surfacers.push(s);
        typed_paint.push(typed);
        let stamp = KindStamp {
            kind: node.kind.clone(),
            version,
            provinces: Vec::new(),
        };
        if !stamps.contains(&stamp) {
            stamps.push(stamp);
        }
    }
    stamps.sort();

    // Water.
    let sea_fluid = if spec.water.sea {
        let block = roles
            .get(&spec.water.sea_fluid)
            .ok_or_else(|| {
                SpecError::new(
                    "water.sea_fluid",
                    format!("undeclared role {:?}", spec.water.sea_fluid),
                )
            })?
            .ok_or_else(|| SpecError::new("water.sea_fluid", "the sea's fluid role is unbound"))?;
        if !blocks.get_block_by_id(block).is_fluid {
            return Err(SpecError::new(
                "water.sea_fluid",
                "the sea's fluid role must bind to a fluid block",
            ));
        }
        block
    } else {
        0
    };
    let sea = SeaModel {
        enabled: spec.water.sea,
        level: frame.sea,
        fluid: sea_fluid,
    };

    let flora = match &spec.flora {
        Some(f) => Some(lower_flora(
            f,
            &frame,
            world_seed,
            dimension,
            &roles,
            &climate.biome_keys,
            &mut salts,
        )?),
        None => None,
    };

    // Spawn.
    if let super::spec::SpawnSpec::Search(s) = &spec.spawn {
        if !(s.stride >= 1 && s.max_radius >= 0 && s.max_slope > 0.0) {
            return Err(SpecError::new(
                "spawn",
                "the search needs a positive stride and slope, and a non-negative radius",
            ));
        }
    }

    // Identity: the spec with every kind's params typed.
    let mut value = serde_json::to_value(spec)
        .map_err(|e| SpecError::new("", format!("spec does not serialize: {e}")))?;
    if let Some(Value::Array(paint)) = value.get_mut("paint") {
        for (node, typed) in paint.iter_mut().zip(typed_paint) {
            node["params"] = typed;
        }
    }
    let identity = LandscapeIdentity {
        preset: spec.preset.clone(),
        format: spec.format,
        content_version: spec.content_version,
        world_seed,
        dimension: dimension.to_string(),
        spec_hash: canon::hash_value(&value),
        canon: canon::CANON_VERSION,
        algo: ENGINE_ALGO,
        kinds: stamps,
        roles_digest,
    };

    let has_tints = climate.tints.iter().any(|t| t.is_some());
    let mut lints = fields.lints.clone();
    lints.sort();
    Ok(Landscape {
        spec: spec.clone(),
        frame,
        identity,
        chunk_size: config.chunk_size as i32,
        halo: options.halo as i32,
        slots: Slots {
            ground: ground_slot,
            temperature: temperature_slot,
            moisture: moisture_slot,
            kept: kept_slots,
        },
        fields,
        kept_names,
        dither: super::fields::eval::NoiseKernel::new(
            stream_seed_bytes(
                world_seed,
                dimension,
                Subsystem::Partition,
                b"engine.landscape.dither",
                0,
            ),
            1.0 / DITHER_WAVELENGTH,
            2,
            0.5,
            2.0,
            1.0,
        ),
        climate,
        surfacers,
        fill,
        sea,
        flora,
        roles,
        block_roles,
        zones,
        tiles: ClockCache::new(options.macro_tiles),
        facts_cache: ClockCache::weighed(options.facts_bytes, |f: &Arc<ChunkFacts>| f.bytes()),
        columns: ClockCache::new(options.columns),
        spawn: OnceLock::new(),
        lints,
        has_tints,
        explain_fields: OnceLock::new(),
        tiles_explain: ClockCache::new(64),
    })
}

type ResolvedRoles = (BTreeMap<String, Option<u32>>, u64, BTreeMap<u32, String>);

fn resolve_roles(
    spec: &LandscapeSpec,
    bindings: &RoleBinding,
    blocks: &Registry,
) -> Result<ResolvedRoles, SpecError> {
    let mut out = BTreeMap::new();
    let mut digest_rows: Vec<(String, String, u32, u64)> = Vec::new();
    let mut block_roles: BTreeMap<u32, String> = BTreeMap::new();
    for (role, decl) in &spec.roles {
        let path = format!("roles.{role}");
        if let Some(fb) = &decl.fallback {
            if !spec.roles.contains_key(fb) {
                return Err(SpecError::new(
                    format!("{path}.fallback"),
                    format!("undeclared fallback role {fb:?}"),
                ));
            }
        }
        // Walk the fallback chain to the first bound role.
        let mut r = role.clone();
        let mut seen = vec![r.clone()];
        let resolved = loop {
            if let Some(name) = bindings.block_of(&r) {
                let id = blocks.try_get_id_by_name(name).ok_or_else(|| {
                    SpecError::new(
                        path.clone(),
                        format!("role {r:?} binds to {name:?}, which is not in the block registry"),
                    )
                })?;
                break Some((r.clone(), name.to_string(), id));
            }
            match &spec.roles[&r].fallback {
                Some(fb) => {
                    if seen.contains(fb) {
                        return Err(SpecError::new(
                            format!("{path}.fallback"),
                            format!("fallback cycle: {} -> {fb}", seen.join(" -> ")),
                        ));
                    }
                    seen.push(fb.clone());
                    r = fb.clone();
                }
                None => break None,
            }
        };
        match resolved {
            Some((bound_role, name, id)) => {
                let block = blocks.get_block_by_id(id);
                let mut fluid_digest = 0u64;
                if decl.fluid && bound_role == *role {
                    if !block.is_fluid {
                        return Err(SpecError::new(
                            path.clone(),
                            format!("fluid role binds to {name:?}, which is not a fluid block"),
                        ));
                    }
                    let config = bindings.fluid_config(role).ok_or_else(|| {
                        SpecError::new(
                            path.clone(),
                            "a fluid role needs its FluidConfig in the binding",
                        )
                    })?;
                    let rules = FluidRules::from(config);
                    fluid_digest = fnv1a_64(format!("{rules:?}").as_bytes());
                }
                digest_rows.push((role.clone(), name, id, fluid_digest));
                block_roles.entry(id).or_insert_with(|| role.clone());
                out.insert(role.clone(), Some(id));
            }
            None if decl.optional => {
                digest_rows.push((role.clone(), String::new(), 0, 0));
                out.insert(role.clone(), None);
            }
            None => {
                return Err(SpecError::new(
                    path,
                    "no binding and no bound fallback (bind it, give it a fallback, or mark it optional)",
                ))
            }
        }
    }
    let digest = fnv1a_64(
        canon::to_canonical(&digest_rows)
            .expect("rows serialize")
            .as_bytes(),
    );
    Ok((out, digest, block_roles))
}

impl Landscape {
    /// The spec as compiled.
    pub fn spec(&self) -> &LandscapeSpec {
        &self.spec
    }

    /// The resolved frame.
    pub fn frame(&self) -> &WorldFrame {
        &self.frame
    }

    /// The identity (persist it with `IdentityFile`).
    pub fn identity(&self) -> &LandscapeIdentity {
        &self.identity
    }

    /// Compile lints (warnings).
    pub fn lints(&self) -> &[String] {
        &self.lints
    }

    /// The compiled fields.
    pub fn fields(&self) -> &CompiledFields {
        &self.fields
    }

    /// Biome keys in id order.
    pub fn biome_keys(&self) -> &[String] {
        &self.climate.biome_keys
    }

    /// The block a role resolved to.
    pub fn role_block(&self, role: &str) -> Option<u32> {
        self.roles.get(role).copied().flatten()
    }

    /// The first role (in key order) that resolved to `block`.
    pub fn block_role(&self, block: u32) -> Option<&str> {
        self.block_roles.get(&block).map(|s| s.as_str())
    }

    /// Kept field names, in fact order.
    pub fn kept_fields(&self) -> &[String] {
        &self.kept_names
    }

    /// The chunk size facts are built for.
    pub fn chunk_size(&self) -> i32 {
        self.chunk_size
    }

    /// The sea.
    pub fn sea(&self) -> &SeaModel {
        &self.sea
    }

    /// The zone key table.
    pub fn zones(&self) -> &ZoneTable {
        &self.zones
    }

    /// The facts cache's counts and weight in bytes (cost only).
    pub fn facts_cache_stats(&self) -> super::cache::CacheStats {
        self.facts_cache.stats()
    }
}
