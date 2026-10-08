//! `compile`: a spec, a kind registry, a role binding, the block registry
//! and the world config in; an immutable [`Landscape`] out, or a
//! path-qualified refusal. There is no fallback block, no default biome
//! and no partially compiled landscape.

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use serde_json::Value;
use voxelize::{Registry, WorldConfig};

use crate::stream::{fnv1a_64, stream_seed_bytes, Subsystem};

use super::build::{BuildCtx, BuildShared, Read, ThroughRec};
use super::cache::ClockCache;
use super::canon;
use super::dag::{self, Dag, DagInput};
use super::facts::{ChunkFacts, ColumnFact, Tier};
use super::fields::{compile_fields, CompiledFields, FieldsConfig, MacroTiles, SaltClaims, SPINE};
use super::flora::LoweredFlora;
use super::identity::{KindStamp, LandscapeIdentity, ENGINE_ALGO};
use super::index::{IndexEntry, NodeRt, NodeSet, PlanCounts};
use super::lower::{lower_climate, lower_flora, LoweredClimate};
use super::plugin::Layer;
use super::presets::roles::RoleBinding;
use super::registry::{KindRegistry, LayoutRt, NodeClass, NodeImp};
use super::settle::FluidRules;
use super::spec::{LandscapeSpec, SpawnSpec, SpecError, WorldFrame, LANDSCAPE_FORMAT};
use super::surface::{DynSurfacer, PaintCtx, ZoneTable};
use super::volume::ProvinceRt;
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
    /// Plans held per node.
    pub plans: usize,
    /// Feature-index cells held.
    pub index_cells: usize,
    /// Exact probe columns held.
    pub probes: usize,
    /// Region tiles held per solver.
    pub region_tiles: usize,
    /// Threads `PlanCtx::par_map` uses (cost only: results join in index
    /// order).
    pub planner_threads: usize,
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
            plans: 4096,
            index_cells: 16384,
            probes: 1 << 16,
            region_tiles: 64,
            planner_threads: 4,
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
            plans: 1,
            index_cells: 1,
            probes: 1,
            region_tiles: 1,
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
    pub(crate) spawn: OnceLock<super::query::SpawnReport>,
    pub(crate) lints: Vec<String>,
    pub(crate) has_tints: bool,
    pub(crate) explain_fields: OnceLock<CompiledFields>,
    pub(crate) tiles_explain: MacroTiles,
    /// One program per acquired field (by `FieldRef` index), its only
    /// output that field, each with its own macro tiles: plan reads, gate
    /// samples and `Col::field` evaluate the field's cone alone.
    pub(crate) point_fields: Vec<CompiledFields>,
    pub(crate) point_tiles: Vec<MacroTiles>,
    /// Runtime nodes by node index (spec order); `None` when disabled.
    pub(crate) nodes: Vec<Option<NodeRt>>,
    /// Ground writers in composition order.
    pub(crate) order: Vec<u16>,
    pub(crate) all_nodes: NodeSet,
    /// Node sets of the tiers, `Tier` order.
    pub(crate) tier_sets: [NodeSet; 5],
    pub(crate) probe_sets: Vec<NodeSet>,
    pub(crate) occupancy_sets: Vec<Vec<u16>>,
    /// The spawn search's shape set (below Water) and verification set
    /// (through Detail), both without spawn readers.
    pub(crate) spawn_shape: NodeSet,
    pub(crate) spawn_verify: NodeSet,
    pub(crate) provinces: Vec<ProvinceRt>,
    pub(crate) index: ClockCache<(i32, i32), Arc<OnceLock<Arc<Vec<IndexEntry>>>>>,
    pub(crate) probes: ClockCache<(u16, i32, i32), f64>,
    pub(crate) dag: Dag,
    /// What each node reads (node to node).
    pub(crate) deps: BTreeMap<u16, std::collections::BTreeSet<u16>>,
    pub(crate) planner_threads: usize,
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
///
/// A refusal is a [`SpecError`]: its `path` names the spec field at fault
/// (`fields.ground.graph`, `paint.1.params.snow.full`), and it converts
/// into the crate's `GenError` with `?`.
pub fn compile(
    spec: &LandscapeSpec,
    kinds: &KindRegistry,
    bindings: &RoleBinding,
    blocks: &Registry,
    config: &WorldConfig,
) -> Result<Arc<Landscape>, SpecError> {
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
) -> Result<Arc<Landscape>, SpecError> {
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
    let zones = ZoneTable::new(spec.zones.keys())?;

    // Nodes: every enabled one is built (recording what it reads); every
    // disabled one has its params typed and validated.
    let node_ids: Vec<String> = spec.nodes.keys().cloned().collect();
    let enabled: Vec<bool> = spec.nodes.values().map(|n| n.enabled).collect();
    let mut shared = BuildShared::default();
    let mut built: Vec<Option<(super::registry::BuiltNode, u32, Vec<(Read, &'static str)>)>> =
        Vec::new();
    let mut typed_nodes: Vec<Value> = Vec::new();
    let mut node_versions: Vec<u32> = Vec::new();
    for (idx, (id, node)) in spec.nodes.iter().enumerate() {
        let kind_path = format!("nodes.{id}.kind");
        let params_path = format!("nodes.{id}.params");
        if !node.enabled {
            let (typed, version) = kinds.type_node_params(
                &kind_path,
                &node.kind,
                node.params.clone(),
                &params_path,
            )?;
            typed_nodes.push(typed);
            node_versions.push(version);
            built.push(None);
            continue;
        }
        let mut cx = BuildCtx {
            node: idx as u16,
            id,
            path: params_path,
            salt: &node.salt,
            frame: &frame,
            world_seed,
            dimension,
            spec,
            kinds,
            roles: &roles,
            zones: &zones,
            node_ids: &node_ids,
            salts: &mut salts,
            shared: &mut shared,
            reads: Vec::new(),
        };
        let (b, version) =
            kinds.build_node(&kind_path, &node.kind, node.params.clone(), &mut cx)?;
        let reads = std::mem::take(&mut cx.reads);
        typed_nodes.push(b.typed.clone());
        node_versions.push(version);
        built.push(Some((b, version, reads)));
    }
    let spawn_clear = match &spec.spawn {
        SpawnSpec::Search(s) => Some(s.clear_radius),
        SpawnSpec::Fixed { .. } => None,
    };
    let inputs: Vec<DagInput> = built
        .iter()
        .enumerate()
        .filter_map(|(i, b)| {
            let (b, _, reads) = b.as_ref()?;
            let id = &node_ids[i];
            let n = &spec.nodes[id];
            Some(DagInput {
                idx: i as u16,
                id: id.clone(),
                kind: n.kind.clone(),
                class: kinds
                    .node_class(&n.kind)
                    .expect("a built kind is registered"),
                layer: b.layer,
                builtin: kinds.builtin_rank(&n.kind),
                over: n.over.clone(),
                under: n.under.clone(),
                reads: reads.clone(),
            })
        })
        .collect();
    let resolved = dag::resolve(&inputs, &node_ids, &enabled, spawn_clear)?;
    for input in &inputs {
        if input.class == NodeClass::SiteSet {
            return Err(SpecError::new(
                format!("nodes.{}.kind", input.id),
                format!(
                    "site set {:?} validates but places nothing in this build (siting, fits and pieces arrive with the structure system); disable the node until then",
                    input.kind
                ),
            ));
        }
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
    // Fields the nodes acquired are not outputs of the chunk program: the
    // point program below evaluates them, and only where an instance is
    // dispatched, so a chunk no landform touches pays nothing for them.
    let outputs = climate_outputs;
    let merged_fields;
    let field_defs = if shared.local_fields.is_empty() {
        &spec.fields
    } else {
        let mut m = spec.fields.clone();
        for (k, v) in &shared.local_fields {
            m.insert(k.clone(), v.clone());
        }
        merged_fields = m;
        &merged_fields
    };
    let fields = compile_fields(
        field_defs,
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
    // The acquired fields, read by plans and gates one column at a time
    // and by composition over the areas instances are dispatched to. Each
    // has a program of its own whose one output it is, so a read evaluates
    // that field's cone and nothing else (dead-code elimination never
    // changes bits, so a value equals what any program computes at that
    // column): a gate sample costs a lattice lookup instead of the whole
    // field graph. Validation and the spec's taste guards ran on the chunk
    // program above, over every field.
    let mut point_fields = Vec::with_capacity(shared.fields.len());
    for name in &shared.fields {
        point_fields.push(compile_fields(
            field_defs,
            std::slice::from_ref(name),
            &FieldsConfig {
                frame: &frame,
                world_seed,
                dimension,
                taste: &super::spec::TasteGuards::warn(),
                cse: options.cse,
            },
            &mut SaltClaims::default(),
        )?);
    }
    let point_tiles = point_fields
        .iter()
        .map(|_| ClockCache::new(options.macro_tiles))
        .collect();

    // Surfacers.
    let mut surfacers = Vec::new();
    let mut typed_paint = Vec::new();
    let mut stamps: Vec<KindStamp> = Vec::new();
    for (i, node) in spec.paint.iter().enumerate() {
        let mut cx = PaintCtx {
            path: format!("paint.{i}.params"),
            frame: &frame,
            world_seed,
            dimension,
            roles: &roles,
            zones: &zones,
            kept: &kept_names,
            biomes: &climate.biome_keys,
            salts: &mut salts,
        };
        let (s, typed, version) = kinds.build_surfacer(
            &format!("paint.{i}.kind"),
            &node.kind,
            node.params.clone(),
            &mut cx,
        )?;
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
    for (i, (id, node)) in spec.nodes.iter().enumerate() {
        let _ = id;
        let mut provinces: Vec<(String, u32)> = shared
            .provinces
            .iter()
            .filter(|p| p.owner == i as u16)
            .map(|p| (p.kind.to_string(), p.version))
            .collect();
        provinces.sort();
        provinces.dedup();
        let stamp = KindStamp {
            kind: node.kind.clone(),
            version: node_versions[i],
            provinces,
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
    if let Some(Value::Object(nodes)) = value.get_mut("nodes") {
        for ((_, node), typed) in nodes.iter_mut().zip(typed_nodes) {
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
    lints.extend(resolved.dag.lints.iter().cloned());
    lints.sort();

    // Runtime nodes.
    let rank_of: BTreeMap<u16, u16> = resolved
        .order
        .iter()
        .enumerate()
        .map(|(r, &i)| (i, r as u16))
        .collect();
    let mut nodes: Vec<Option<NodeRt>> = Vec::with_capacity(built.len());
    for (i, b) in built.into_iter().enumerate() {
        let Some((b, _, _)) = b else {
            nodes.push(None);
            continue;
        };
        let id = &node_ids[i];
        let path = format!("nodes.{id}");
        let mut field_plan = None;
        let mut gate = None;
        if let LayoutRt::Field { gate: g, .. } = b.layout {
            let name = &shared.fields[g.0 as usize];
            let lipschitz = fields
                .analysis(name)
                .and_then(|a| a.lipschitz)
                .filter(|l| l.is_finite())
                .ok_or_else(|| {
                    SpecError::new(
                        path.clone(),
                        format!(
                            "a Field layout's gate {name:?} has no known Lipschitz bound (a crease, a hard select or another node with no safe bound), so its dispatch tiles cannot be bounded"
                        ),
                    )
                })?;
            gate = Some((g.0 as usize, lipschitz));
            let NodeImp::Landform(imp) = &b.imp else {
                unreachable!("Field layouts are landforms")
            };
            field_plan = Some(imp.field_plan().ok_or_else(|| {
                SpecError::new(
                    path.clone(),
                    "a Field layout needs field_plan(): its one world-constant plan",
                )
            })?);
        }
        let spawn_clear = resolved
            .spawn_readers
            .iter()
            .find(|(n, _)| *n == i as u16)
            .map(|(_, c)| *c);
        let plans_cap = match b.layout {
            LayoutRt::Once { .. } => 1,
            _ => options.plans,
        };
        nodes.push(Some(NodeRt {
            idx: i as u16,
            id: id.clone(),
            kind: spec.nodes[id].kind.clone(),
            salt: spec.nodes[id].salt.clone(),
            layer: b.layer,
            rank: rank_of.get(&(i as u16)).copied().unwrap_or(u16::MAX),
            layout: b.layout,
            imp: b.imp,
            field_plan,
            gate,
            spawn_clear,
            cell_type: kinds.landform_cell_type(&spec.nodes[id].kind),
            plans: ClockCache::new(plans_cap),
            admit: ClockCache::new(options.plans),
            tiles: ClockCache::new(options.region_tiles),
            counts: PlanCounts::default(),
        }));
    }
    let layer_of = |n: u16| nodes[n as usize].as_ref().map(|r| r.layer);
    let order = resolved.order.clone();
    let set_of = |members: Vec<u16>| {
        let all = members.len() == order.len();
        NodeSet::from_nodes(&members, all)
    };
    let upto = |l: Layer| -> Vec<u16> {
        order
            .iter()
            .copied()
            .filter(|&n| layer_of(n).is_some_and(|x| x <= l))
            .collect()
    };
    let tier_sets = [
        set_of(Vec::new()),
        set_of(upto(Layer::Shore)),
        set_of(upto(Layer::Water)),
        set_of(upto(Layer::Detail)),
        set_of(order.clone()),
    ];
    let all_nodes = set_of(order.clone());
    let probe_sets: Vec<NodeSet> = shared
        .probes
        .iter()
        .map(|(_, rec)| {
            let members: Vec<u16> = match rec {
                ThroughRec::Macro => Vec::new(),
                ThroughRec::Layer(l) => order
                    .iter()
                    .copied()
                    .filter(|&n| layer_of(n).is_some_and(|x| x < *l))
                    .collect(),
                ThroughRec::With(targets) => {
                    // The targets and every ground writer they read.
                    let mut set: std::collections::BTreeSet<u16> =
                        targets.iter().copied().collect();
                    let mut stack: Vec<u16> = targets.clone();
                    while let Some(n) = stack.pop() {
                        for &d in resolved.deps.get(&n).into_iter().flatten() {
                            if set.insert(d) {
                                stack.push(d);
                            }
                        }
                    }
                    order.iter().copied().filter(|n| set.contains(n)).collect()
                }
            };
            set_of(members)
        })
        .collect();
    let spawn_shape = set_of(
        resolved
            .spawn_set
            .iter()
            .copied()
            .filter(|&n| layer_of(n).is_some_and(|l| l < Layer::Water))
            .collect(),
    );
    let spawn_verify = set_of(resolved.spawn_set.clone());

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
        point_fields,
        point_tiles,
        nodes,
        order,
        all_nodes,
        tier_sets,
        probe_sets,
        occupancy_sets: shared.occupancy,
        spawn_shape,
        spawn_verify,
        provinces: shared.provinces,
        index: ClockCache::new(options.index_cells),
        probes: ClockCache::new(options.probes),
        dag: resolved.dag,
        deps: resolved.deps,
        planner_threads: Ord::max(options.planner_threads, 1),
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

    /// The planner DAG and the composition order.
    pub fn dag(&self) -> &Dag {
        &self.dag
    }

    /// The node set a tier composes.
    pub(crate) fn tier_set(&self, tier: Tier) -> &NodeSet {
        &self.tier_sets[tier as usize]
    }

    /// Whether any landform or region solver is enabled.
    pub fn has_nodes(&self) -> bool {
        !self.order.is_empty()
    }

    /// Final ground from composed ground: the floor clamp, then the soft
    /// ceiling.
    pub fn final_ground(&self, composed: f64) -> f64 {
        self.finish_ground(composed)
    }

    /// The facts halo.
    pub fn halo(&self) -> i32 {
        self.halo
    }
}
