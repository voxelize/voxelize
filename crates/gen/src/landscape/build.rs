//! `BuildCtx`: dependencies are the handles a plugin acquires.
//!
//! Every input a plugin reads (a named field, another node's plans,
//! occupancy, composed ground upstream, an earlier node's facts, a role, a
//! zone, a claim key, the spawn anchor) is acquired here as a typed handle,
//! and every acquisition records an edge in the planner DAG. A plugin
//! holding no handle cannot read the thing, so the DAG is the code's own
//! dependency graph and cannot drift from it; typos fail in `build()` with
//! a path-qualified error, never in a hot loop.
//!
//! Rules checked here (the rest, which need every node's layer, are
//! checked by the DAG once all nodes are built):
//! - an unknown node id, or the wrong kind for a typed reader;
//! - a disabled dependency, unless acquired with
//!   [`BuildCtx::optional_plans`];
//! - an undeclared role, zone key or claim key;
//! - a salt collision (sub-noises are `"<salt>.<sub>"`, claimed
//!   world-wide).

use std::any::TypeId;
use std::collections::BTreeMap;
use std::marker::PhantomData;

use super::compose::Claims;
use super::fields::eval::NoiseKernel;
use super::fields::SaltClaims;
use super::math::ring_noise;
use super::plugin::{Effect, Fact, Landform, Layer, Province};
use super::registry::KindRegistry;
use super::spec::{FieldDef, LandscapeSpec, Size, SpecError, WorldFrame};
use super::surface::{ZoneKey, ZoneTable};
use super::volume::{DynProvince, ProvinceRt};
use super::{SeedLane, SeedPhase};

/// A named field a plugin reads: [`Col::field`](super::compose::Col::field)
/// at a column, [`PlanCtx::field`](super::plan::PlanCtx::field) at a point.
/// Only [`BuildCtx::field`] and [`BuildCtx::local_field`] make one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FieldRef(pub(crate) u16);

/// A typed reader of another landform's plans; only
/// [`BuildCtx::plans`] makes one, after checking the node's kind.
pub struct PlanReader<K: Landform> {
    pub(crate) node: u16,
    _k: PhantomData<fn() -> K>,
}

impl<K: Landform> Clone for PlanReader<K> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<K: Landform> Copy for PlanReader<K> {}

impl<K: Landform> std::fmt::Debug for PlanReader<K> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PlanReader<{}>({})", K::KIND, self.node)
    }
}

/// Plan-time footprints of some nodes (avoidance at plan time; any layer).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClaimReader(pub(crate) u16);

/// Composed ground upstream of the reader, at a point.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProbeReader(pub(crate) u16);

/// The spawn anchor; acquiring it makes the node a spawn reader.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpawnReader {
    pub(crate) clear: i32,
}

/// A key to a strictly earlier landform's per-column record.
pub struct FactKey<T: Fact> {
    pub(crate) node: u16,
    _t: PhantomData<fn() -> T>,
}

impl<T: Fact> Clone for FactKey<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: Fact> Copy for FactKey<T> {}

impl<T: Fact> std::fmt::Debug for FactKey<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "FactKey({})", self.node)
    }
}

impl<T: Fact> FactKey<T> {
    pub(crate) fn of(node: u16) -> Self {
        Self {
            node,
            _t: PhantomData,
        }
    }
}

/// A handle to a province this landform owns, for
/// [`Col::province`](super::compose::Col::province).
pub struct ProvinceHandle<P: Fact> {
    pub(crate) slot: u16,
    _p: PhantomData<fn() -> P>,
}

impl<P: Fact> std::fmt::Debug for ProvinceHandle<P> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ProvinceHandle({})", self.slot)
    }
}

/// A declared role, resolved to its block.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct RoleId(pub(crate) u32);

impl RoleId {
    /// The block id.
    pub fn block(self) -> u32 {
        self.0
    }
}

/// Which composed ground a probe reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Through<'s> {
    /// The spine ground alone: relief before any landform, so tuning a
    /// landform never moves a plan that probes this way.
    Macro,
    /// Plus every ground writer in layers strictly below this one. The
    /// layer may be at most the reader's own.
    Layer(Layer),
    /// Plus only these nodes (and the nodes they read); a node of the
    /// reader's own layer must compose strictly earlier (an explicit
    /// `over` path).
    With(&'s [&'s str]),
}

/// Owned form of [`Through`], as recorded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ThroughRec {
    Macro,
    Layer(Layer),
    With(Vec<u16>),
}

/// A 2D noise a plugin samples: normalized fbm (practical range ±1).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NoiseSpec {
    /// Wavelength of the first octave.
    pub wavelength: Size,
    /// Octaves, 1..=8.
    pub octaves: u8,
    /// Amplitude kept per octave.
    pub persistence: f64,
    /// Frequency gained per octave.
    pub lacunarity: f64,
}

impl NoiseSpec {
    /// Normalized fbm at `wavelength` with `octaves` (persistence 0.5,
    /// lacunarity 2).
    pub fn fbm(wavelength: Size, octaves: u8) -> Self {
        Self {
            wavelength,
            octaves,
            persistence: 0.5,
            lacunarity: 2.0,
        }
    }
}

/// A sampled noise (see [`BuildCtx::noise`]).
#[derive(Clone, Debug)]
pub struct Noise {
    kernel: NoiseKernel,
}

impl Noise {
    /// The noise at world position `(x, z)`.
    #[inline]
    pub fn at(&self, x: f64, z: f64) -> f64 {
        self.kernel.sample(x, z)
    }

    /// Azimuthal variation about `c` without trig or a seam: the noise at
    /// the point at radius `r` from `c` in the direction of `p`.
    #[inline]
    pub fn ring(&self, c: (f64, f64), p: (f64, f64), r: f64) -> f64 {
        ring_noise(|x, z| self.kernel.sample(x, z), c, p, r)
    }
}

/// What one node read, as recorded (the DAG and `--dag` read it).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Read {
    Field(String),
    Plans { node: u16, optional: bool },
    Occupancy(Vec<u16>),
    Probe(ThroughRec),
    Fact(u16),
    Spawn(i32),
    Role(String),
    Zone(String),
    ClaimKey(String),
    Noise(String),
    Province(&'static str),
}

/// Everything compile collects from all builds.
#[derive(Default)]
pub(crate) struct BuildShared {
    /// Acquired fields by `FieldRef` index.
    pub fields: Vec<String>,
    /// Fields declared by `local_field`, by name.
    pub local_fields: BTreeMap<String, FieldDef>,
    /// Provinces by slot.
    pub provinces: Vec<ProvinceRt>,
    /// Probe sets by `ProbeReader` index: (reader, what it reads through).
    pub probes: Vec<(u16, ThroughRec)>,
    /// Occupancy readers by `ClaimReader` index: the nodes read.
    pub occupancy: Vec<Vec<u16>>,
}

/// What a plugin may acquire while it is built (see the module docs).
pub struct BuildCtx<'a> {
    pub(crate) node: u16,
    pub(crate) id: &'a str,
    pub(crate) path: String,
    pub(crate) salt: &'a str,
    pub(crate) frame: &'a WorldFrame,
    pub(crate) world_seed: u32,
    pub(crate) dimension: &'a str,
    pub(crate) spec: &'a LandscapeSpec,
    pub(crate) kinds: &'a KindRegistry,
    pub(crate) roles: &'a BTreeMap<String, Option<u32>>,
    pub(crate) zones: &'a ZoneTable,
    pub(crate) node_ids: &'a [String],
    pub(crate) salts: &'a mut SaltClaims,
    pub(crate) shared: &'a mut BuildShared,
    pub(crate) reads: Vec<(Read, &'static str)>,
}

impl BuildCtx<'_> {
    /// The world frame: `Height` and `Size` resolution.
    pub fn frame(&self) -> &WorldFrame {
        self.frame
    }

    /// This node's id in `spec.nodes`.
    pub fn id(&self) -> &str {
        self.id
    }

    /// This node's salt.
    pub fn salt(&self) -> &str {
        self.salt
    }

    /// The spec path of this node's params, `nodes.<id>.params` (for
    /// errors).
    pub fn path(&self) -> &str {
        &self.path
    }

    fn error(&self, message: impl Into<String>) -> SpecError {
        SpecError::new(format!("nodes.{}", self.id), message)
    }

    fn record(&mut self, read: Read, handle: &'static str) {
        if !self.reads.iter().any(|(r, h)| *r == read && *h == handle) {
            self.reads.push((read, handle));
        }
    }

    fn intern_field(&mut self, name: &str) -> FieldRef {
        let i = match self.shared.fields.iter().position(|f| f == name) {
            Some(i) => i,
            None => {
                self.shared.fields.push(name.to_string());
                self.shared.fields.len() - 1
            }
        };
        FieldRef(i as u16)
    }

    /// A named shared field (declared in `spec.fields`, or a local field of
    /// any node).
    pub fn field(&mut self, name: &str) -> Result<FieldRef, SpecError> {
        if !self.spec.fields.contains_key(name) && !self.shared.local_fields.contains_key(name) {
            return Err(self.error(format!("reads undeclared field {name:?}")));
        }
        self.record(Read::Field(name.to_string()), "field");
        Ok(self.intern_field(name))
    }

    /// A field of this node's own, named `"<salt>.<sub>"`: declared beside
    /// the spec's fields (it may read them, and is validated with them),
    /// evaluated only where the node reads it, never stored in the facts.
    pub fn local_field(&mut self, sub: &str, def: FieldDef) -> Result<FieldRef, SpecError> {
        let name = format!("{}.{sub}", self.salt);
        if self.spec.fields.contains_key(&name) || self.shared.local_fields.contains_key(&name) {
            return Err(self.error(format!("local field {name:?} is already declared")));
        }
        if def.keep {
            return Err(self.error(format!("local field {name:?} cannot be kept")));
        }
        self.shared.local_fields.insert(name.clone(), def);
        self.record(Read::Field(name.clone()), "local_field");
        Ok(self.intern_field(&name))
    }

    /// A 2D noise named `"<salt>.<sub>"`, its salt claimed world-wide,
    /// seeded on the landform build lane.
    pub fn noise(&mut self, sub: &str, spec: NoiseSpec) -> Result<Noise, SpecError> {
        let salt = format!("{}.{sub}", self.salt);
        if !(1..=8).contains(&spec.octaves)
            || !(spec.wavelength.raw() > 0.0 && spec.wavelength.raw().is_finite())
            || !(spec.persistence > 0.0 && spec.persistence < 1.0)
            || !(spec.lacunarity > 1.0 && spec.lacunarity.is_finite())
        {
            return Err(self.error(format!(
                "noise {sub:?} needs 1..=8 octaves, a positive wavelength, persistence in (0, 1) and lacunarity above 1"
            )));
        }
        let key = format!(
            "landform-noise:{}:{}:{}:{}",
            super::canon::to_canonical(&spec.wavelength).expect("a size serializes"),
            spec.octaves,
            spec.persistence,
            spec.lacunarity
        );
        let owner = format!("nodes.{}", self.id);
        self.salts.claim(&salt, &owner, &key)?;
        self.record(Read::Noise(sub.to_string()), "noise");
        let seed = SeedLane::Landforms.seed(
            SeedPhase::Build,
            self.world_seed,
            self.dimension,
            salt.as_bytes(),
            0,
        );
        Ok(Noise {
            kernel: NoiseKernel::new(
                seed,
                1.0 / self.frame.span(spec.wavelength),
                spec.octaves,
                spec.persistence,
                spec.lacunarity,
                1.0,
            ),
        })
    }

    /// A seed for this node's own per-column hash rolls, from
    /// `"<salt>.<sub>"` on the build lane.
    pub fn hash_seed(&mut self, sub: &str) -> Result<u64, SpecError> {
        let salt = format!("{}.{sub}", self.salt);
        let owner = format!("nodes.{}", self.id);
        self.salts.claim(&salt, &owner, "landform-hash")?;
        Ok(SeedLane::Landforms.seed(
            SeedPhase::Build,
            self.world_seed,
            self.dimension,
            salt.as_bytes(),
            0,
        ))
    }

    fn node_of(&self, id: &str) -> Result<u16, SpecError> {
        self.node_ids
            .iter()
            .position(|n| n == id)
            .map(|i| i as u16)
            .ok_or_else(|| self.error(format!("reads unknown node {id:?}")))
    }

    fn enabled(&self, node: u16) -> bool {
        self.spec.nodes[&self.node_ids[node as usize]].enabled
    }

    fn typed_landform<K: Landform>(&self, id: &str) -> Result<u16, SpecError> {
        let node = self.node_of(id)?;
        let kind = &self.spec.nodes[id].kind;
        let registered = self.kinds.landform_type(kind);
        if kind != K::KIND || registered != Some(TypeId::of::<K>()) {
            return Err(self.error(format!(
                "reads node {id:?} as a {:?} landform, but it is a {kind:?}",
                K::KIND
            )));
        }
        Ok(node)
    }

    /// Typed plans of landform node `id`, which must be enabled and of
    /// kind `K`.
    pub fn plans<K: Landform>(&mut self, id: &str) -> Result<PlanReader<K>, SpecError> {
        let node = self.typed_landform::<K>(id)?;
        if !self.enabled(node) {
            return Err(self.error(format!(
                "reads disabled node {id:?} (acquire it with optional_plans to read it only when enabled)"
            )));
        }
        self.record(
            Read::Plans {
                node,
                optional: false,
            },
            "plans",
        );
        Ok(PlanReader {
            node,
            _k: PhantomData,
        })
    }

    /// Typed plans of landform node `id` when it is enabled, `None` when it
    /// is disabled.
    pub fn optional_plans<K: Landform>(
        &mut self,
        id: &str,
    ) -> Result<Option<PlanReader<K>>, SpecError> {
        let node = self.typed_landform::<K>(id)?;
        if !self.enabled(node) {
            return Ok(None);
        }
        self.record(
            Read::Plans {
                node,
                optional: true,
            },
            "optional_plans",
        );
        Ok(Some(PlanReader {
            node,
            _k: PhantomData,
        }))
    }

    /// Plan-time footprints (and their plan-level claims) of these nodes,
    /// from any layer. A disabled node has no footprints.
    pub fn occupancy(&mut self, ids: &[&str]) -> Result<ClaimReader, SpecError> {
        let mut nodes = Vec::new();
        for id in ids {
            let node = self.node_of(id)?;
            if !self.kinds.is_planned(&self.spec.nodes[*id].kind) {
                return Err(self.error(format!(
                    "reads the occupancy of {id:?}, which is not a landform"
                )));
            }
            if self.enabled(node) && !nodes.contains(&node) {
                nodes.push(node);
            }
        }
        nodes.sort_unstable();
        self.record(Read::Occupancy(nodes.clone()), "occupancy");
        self.shared.occupancy.push(nodes);
        Ok(ClaimReader((self.shared.occupancy.len() - 1) as u16))
    }

    /// Composed ground upstream of this node (see [`Through`]).
    pub fn probe(&mut self, through: Through<'_>) -> Result<ProbeReader, SpecError> {
        let rec = match through {
            Through::Macro => ThroughRec::Macro,
            Through::Layer(l) => ThroughRec::Layer(l),
            Through::With(ids) => {
                let mut nodes = Vec::new();
                for id in ids {
                    let node = self.node_of(id)?;
                    if self.enabled(node) && !nodes.contains(&node) {
                        nodes.push(node);
                    }
                }
                nodes.sort_unstable();
                ThroughRec::With(nodes)
            }
        };
        self.record(Read::Probe(rec.clone()), "probe");
        self.shared.probes.push((self.node, rec));
        Ok(ProbeReader((self.shared.probes.len() - 1) as u16))
    }

    /// The per-column record of landform node `id` (enabled, with
    /// `Cell = T`). The node must compose strictly earlier than this one:
    /// an earlier layer, or this layer with an explicit `over` path.
    pub fn fact<T: Fact>(&mut self, id: &str) -> Result<FactKey<T>, SpecError> {
        let node = self.node_of(id)?;
        let kind = &self.spec.nodes[id].kind;
        if self.kinds.landform_cell_type(kind) != Some(TypeId::of::<T>())
            || TypeId::of::<T>() == TypeId::of::<()>()
        {
            return Err(self.error(format!(
                "reads the facts of {id:?} with the wrong record type (its kind {kind:?} keeps another, or none)"
            )));
        }
        if !self.enabled(node) {
            return Err(self.error(format!("reads the facts of disabled node {id:?}")));
        }
        self.record(Read::Fact(node), "fact");
        Ok(FactKey::of(node))
    }

    /// Own province `p`: its kind and version join this node's identity
    /// stamp.
    pub fn province<P: Province>(&mut self, p: P) -> Result<ProvinceHandle<P::Params>, SpecError> {
        if !p.lattices().is_empty() {
            return Err(self.error(format!(
                "province {:?} declares lattices, which this build cannot evaluate yet",
                P::KIND
            )));
        }
        if !(p.fade_depth() > 0.0 && p.fade_depth().is_finite()) {
            return Err(self.error(format!(
                "province {:?} needs a positive, finite fade depth",
                P::KIND
            )));
        }
        let effect: Effect = P::EFFECT;
        self.record(Read::Province(P::KIND), "province");
        self.shared.provinces.push(ProvinceRt {
            kind: P::KIND,
            version: P::VERSION,
            effect,
            owner: self.node,
            imp: Box::new(p) as Box<dyn DynProvince>,
        });
        Ok(ProvinceHandle {
            slot: (self.shared.provinces.len() - 1) as u16,
            _p: PhantomData,
        })
    }

    /// The block of declared role `role`, which must be bound.
    pub fn role(&mut self, role: &str) -> Result<RoleId, SpecError> {
        match self.roles.get(role) {
            Some(Some(b)) => {
                self.record(Read::Role(role.to_string()), "role");
                Ok(RoleId(*b))
            }
            Some(None) => Err(self.error(format!(
                "optional role {role:?} is unbound but required here"
            ))),
            None => Err(self.error(format!("undeclared role {role:?}"))),
        }
    }

    /// The block of declared role `role`, or `None` for an optional role
    /// left unbound.
    pub fn optional_role(&mut self, role: &str) -> Result<Option<RoleId>, SpecError> {
        match self.roles.get(role) {
            Some(b) => {
                self.record(Read::Role(role.to_string()), "optional_role");
                Ok(b.map(RoleId))
            }
            None => Err(self.error(format!("undeclared role {role:?}"))),
        }
    }

    /// A built-in or declared zone key.
    pub fn zone(&mut self, key: &str) -> Result<ZoneKey, SpecError> {
        let z = self
            .zones
            .get(key)
            .ok_or_else(|| self.error(format!("unknown zone key {key:?}")))?;
        self.record(Read::Zone(key.to_string()), "zone");
        Ok(z)
    }

    /// A game claim bit declared in `spec.claim_keys` (bits 16..32 in key
    /// order).
    pub fn claim_key(&mut self, key: &str) -> Result<Claims, SpecError> {
        let i = self
            .spec
            .claim_keys
            .keys()
            .position(|k| k == key)
            .ok_or_else(|| self.error(format!("undeclared claim key {key:?}")))?;
        self.record(Read::ClaimKey(key.to_string()), "claim_key");
        Ok(Claims(1 << (16 + i as u32)))
    }

    /// The spawn anchor. This node becomes a spawn reader: its footprints
    /// must keep `clear` blocks from spawn (plans that don't are rejected
    /// and counted), and the spawn search never sees it.
    pub fn spawn(&mut self, clear: i32) -> Result<SpawnReader, SpecError> {
        if clear < 0 {
            return Err(self.error("a spawn reader's clearance cannot be negative"));
        }
        self.record(Read::Spawn(clear), "spawn");
        Ok(SpawnReader { clear })
    }
}
