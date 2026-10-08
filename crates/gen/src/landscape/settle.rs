//! Fluid steady state: whether stamped water holds still under the game's
//! own fluid rules, and pre-settling it until it does.
//!
//! How a stamped curtain or bowl behaves depends on the game's fluid
//! configuration, which the engine bakes into each fluid block's updater.
//! So this module never models the simulation itself: [`Settler`] runs the
//! engine's real updater (built from the same `FluidConfig` the game bakes
//! into its block) over a closed [`SettleBox`], tick by tick, with the same
//! tick semantics as the engine's update system (every wet voxel plans
//! against the committed state, in x, y, z order; two offers of one fluid
//! into one voxel keep the fuller; then everything commits).
//!
//! [`FluidRules`] mirrors the few level rules that stamping needs as pure
//! functions (the falling level, the reach, refills), so a stamp can be
//! built without a simulation; the settle check is what proves the mirror
//! and the game agree.

use std::collections::{BTreeMap, BTreeSet};

use voxelize::{
    create_fluid_active_fn, BlockUtils, FluidConfig, FluidUpdater, Registry, Vec3, VoxelAccess,
    VoxelPacker,
};

use crate::stream::{fnv1a_64, mix64};

use super::lattice::VoxelBox;

/// The level rules of a fluid configuration, as pure functions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FluidRules {
    pub max_stage: u32,
    pub infinite_source: bool,
    pub infinite_source_count: u32,
    pub flows_down_as_source: bool,
    pub renews_reach_on_fall: bool,
    pub slope_find_distance: u32,
}

impl From<&FluidConfig> for FluidRules {
    fn from(c: &FluidConfig) -> Self {
        Self {
            max_stage: c.max_stage,
            infinite_source: c.infinite_source,
            infinite_source_count: c.infinite_source_count,
            flows_down_as_source: c.flows_down_as_source,
            renews_reach_on_fall: c.renews_reach_on_fall,
            slope_find_distance: c.slope_find_distance,
        }
    }
}

impl FluidRules {
    /// The level a source hands the open cell beside it.
    pub const SPREAD_FROM_SOURCE: u32 = 1;

    /// The level fluid at `stage` arrives at when it falls one block: 0 if
    /// falling water becomes a source, 1 if a fall renews its reach,
    /// otherwise `max(1, stage)`.
    pub fn falling_level(&self, stage: u32) -> u32 {
        if self.flows_down_as_source {
            0
        } else if self.renews_reach_on_fall {
            1
        } else {
            stage.max(1)
        }
    }

    /// How many cells a flowing run reaches from its source before it ends
    /// (it spreads while its stage is below `max_stage`).
    pub fn reach(&self) -> u32 {
        self.max_stage
    }

    /// Whether flowing water beside `source_neighbors` sources becomes one.
    pub fn refills(&self, source_neighbors: u32) -> bool {
        self.infinite_source && source_neighbors >= self.infinite_source_count
    }

    /// The level of a curtain hanging from a lip: the lip's source hands
    /// the cell over the drop [`Self::SPREAD_FROM_SOURCE`], and it falls at
    /// the falling level of that.
    pub fn curtain_level(&self) -> u32 {
        self.falling_level(Self::SPREAD_FROM_SOURCE)
    }

    /// Whether a curtain holds still with open air beside it. Flowing water
    /// standing on water never spreads sideways, but a source does, so a
    /// curtain of sources (falling water becoming sources) spreads into the
    /// air in front of it; such falls are pre-settled instead of stamped.
    pub fn open_curtain_holds(&self) -> bool {
        self.curtain_level() > 0
    }

    /// A digest of every rule that shapes a steady state (the tick rate
    /// only changes how fast it is reached), for a world's identity.
    pub fn digest(&self) -> u64 {
        let words = [
            self.max_stage as u64,
            self.infinite_source as u64,
            self.infinite_source_count as u64,
            self.flows_down_as_source as u64,
            self.renews_reach_on_fall as u64,
            self.slope_find_distance as u64,
        ];
        words
            .iter()
            .fold(fnv1a_64(b"landscape.fluid_rules.v1"), |h, &w| mix64(h ^ w))
    }
}

/// A closed box of voxels for settling: inside it the voxels are stored,
/// outside every voxel reads as `outside` (normally a solid), so water can
/// neither leak out nor see unloaded ground.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettleBox {
    bounds: VoxelBox,
    dims: [usize; 3],
    voxels: Vec<u32>,
    outside: u32,
}

impl SettleBox {
    /// An empty (air) box over `bounds`.
    pub fn new(bounds: VoxelBox, outside: u32) -> Self {
        assert!(!bounds.is_empty(), "a settle box needs at least one voxel");
        let dims = [0, 1, 2].map(|a| (bounds.max[a] - bounds.min[a] + 1) as usize);
        Self {
            bounds,
            dims,
            voxels: vec![0; dims[0] * dims[1] * dims[2]],
            outside,
        }
    }

    pub fn bounds(&self) -> VoxelBox {
        self.bounds
    }

    #[inline]
    fn index(&self, x: i32, y: i32, z: i32) -> Option<usize> {
        if !self.bounds.contains(x, y, z) {
            return None;
        }
        let l = [
            x - self.bounds.min[0],
            y - self.bounds.min[1],
            z - self.bounds.min[2],
        ]
        .map(|v| v as usize);
        Some((l[0] * self.dims[1] + l[1]) * self.dims[2] + l[2])
    }

    /// The voxel word at `(x, y, z)`.
    pub fn raw(&self, x: i32, y: i32, z: i32) -> u32 {
        self.index(x, y, z).map_or(self.outside, |i| self.voxels[i])
    }

    /// Set a voxel inside the box.
    pub fn set(&mut self, x: i32, y: i32, z: i32, raw: u32) {
        let i = self
            .index(x, y, z)
            .unwrap_or_else(|| panic!("({x}, {y}, {z}) is outside the settle box"));
        self.voxels[i] = raw;
    }

    /// Fill every voxel of `region` (clipped to the box) with `raw`.
    pub fn fill(&mut self, region: VoxelBox, raw: u32) {
        let r = region.intersect(&self.bounds);
        if r.is_empty() {
            return;
        }
        for x in r.min[0]..=r.max[0] {
            for y in r.min[1]..=r.max[1] {
                for z in r.min[2]..=r.max[2] {
                    self.set(x, y, z, raw);
                }
            }
        }
    }

    /// Place fluid `id` at `stage`.
    pub fn place_fluid(&mut self, x: i32, y: i32, z: i32, id: u32, stage: u32) {
        self.set(
            x,
            y,
            z,
            VoxelPacker::new().with_id(id).with_stage(stage).pack(),
        );
    }

    /// The fluid level at a voxel holding fluid `id`, if it does.
    pub fn fluid_level(&self, x: i32, y: i32, z: i32, id: u32) -> Option<u32> {
        let raw = self.raw(x, y, z);
        (BlockUtils::extract_id(raw) == id || BlockUtils::extract_waterlogged(raw))
            .then(|| BlockUtils::extract_fluid_level(raw))
    }

    /// Every position in the box, in x, y, z order.
    pub fn positions(&self) -> impl Iterator<Item = [i32; 3]> + '_ {
        let b = self.bounds;
        (b.min[0]..=b.max[0]).flat_map(move |x| {
            (b.min[1]..=b.max[1]).flat_map(move |y| (b.min[2]..=b.max[2]).map(move |z| [x, y, z]))
        })
    }
}

impl VoxelAccess for SettleBox {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.raw(vx, vy, vz)
    }

    fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, voxel: u32) -> bool {
        match self.index(vx, vy, vz) {
            Some(i) => {
                self.voxels[i] = voxel;
                true
            }
            None => false,
        }
    }

    /// The box is a closed world: every position reads as known, so the
    /// updater treats the outside as the solid it reads as.
    fn contains(&self, _vx: i32, _vy: i32, _vz: i32) -> bool {
        true
    }
}

/// What a settle check saw.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettleReport {
    /// Ticks run.
    pub ticks: u32,
    /// Every voxel that changed in any tick, sorted.
    pub changed: BTreeSet<[i32; 3]>,
    /// Voxels changed per tick.
    pub per_tick: Vec<u32>,
}

impl SettleReport {
    /// Whether nothing changed at all.
    pub fn is_still(&self) -> bool {
        self.changed.is_empty()
    }

    /// The changed voxels outside the allowed set (declared curtains).
    pub fn changed_outside(&self, allowed: impl Fn([i32; 3]) -> bool) -> Vec<[i32; 3]> {
        self.changed
            .iter()
            .copied()
            .filter(|&p| !allowed(p))
            .collect()
    }
}

/// Why pre-settling failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettleError {
    /// Still changing after the tick budget.
    Restless { ticks: u32 },
    /// More water voxels than the budget allows.
    TooWet { wet: usize },
}

/// Runs a fluid's own updater over a settle box.
pub struct Settler<'a> {
    registry: &'a Registry,
    fluid_id: u32,
    rules: FluidRules,
    updater: FluidUpdater,
}

impl<'a> Settler<'a> {
    /// A settler for fluid block `fluid_id` (registered in `registry`),
    /// built with `config`: the same value the game bakes into the block.
    pub fn new(registry: &'a Registry, fluid_id: u32, config: FluidConfig) -> Self {
        assert!(
            registry.is_fluid(fluid_id),
            "block {fluid_id} is not a fluid"
        );
        let rules = FluidRules::from(&config);
        let (_, updater) = create_fluid_active_fn(fluid_id, config);
        Self {
            registry,
            fluid_id,
            rules,
            updater,
        }
    }

    pub fn rules(&self) -> FluidRules {
        self.rules
    }

    fn holds_fluid(&self, raw: u32) -> bool {
        BlockUtils::extract_waterlogged(raw) || self.registry.is_fluid(BlockUtils::extract_id(raw))
    }

    fn is_wet(&self, b: &SettleBox, p: [i32; 3]) -> bool {
        let raw = b.raw(p[0], p[1], p[2]);
        BlockUtils::extract_id(raw) == self.fluid_id
            || (BlockUtils::extract_waterlogged(raw)
                && self.registry.waterlogging_fluid_id() == Some(self.fluid_id))
    }

    /// Count of voxels holding this fluid.
    pub fn wet_count(&self, b: &SettleBox) -> usize {
        b.positions().filter(|&p| self.is_wet(b, p)).count()
    }

    /// One tick over every wet voxel: each plans against the committed box
    /// in x, y, z order, two offers of fluid into one voxel keep the fuller
    /// (lower stage), any other conflict keeps the first, then all commit.
    /// Returns the voxels that changed, sorted.
    pub fn tick(&self, b: &mut SettleBox) -> Vec<[i32; 3]> {
        let mut plan: BTreeMap<[i32; 3], u32> = BTreeMap::new();
        let wet: Vec<[i32; 3]> = b.positions().filter(|&p| self.is_wet(b, p)).collect();
        for p in wet {
            for (Vec3(x, y, z), raw) in (self.updater)(Vec3(p[0], p[1], p[2]), &*b, self.registry) {
                if !b.bounds.contains(x, y, z) {
                    continue;
                }
                let key = [x, y, z];
                match plan.get(&key) {
                    None => {
                        plan.insert(key, raw);
                    }
                    Some(&existing) => {
                        let fuller = self.holds_fluid(existing)
                            && self.holds_fluid(raw)
                            && BlockUtils::extract_id(existing) == BlockUtils::extract_id(raw)
                            && BlockUtils::extract_fluid_level(raw)
                                < BlockUtils::extract_fluid_level(existing);
                        if fuller {
                            plan.insert(key, raw);
                        }
                    }
                }
            }
        }
        let mut changed = Vec::new();
        for (p, raw) in plan {
            if b.raw(p[0], p[1], p[2]) != raw {
                b.set(p[0], p[1], p[2], raw);
                changed.push(p);
            }
        }
        changed
    }

    /// Run `ticks` ticks on a copy of `b` and report every change: a
    /// steady stamp changes nothing (or nothing outside its declared
    /// curtains).
    pub fn check(&self, b: &SettleBox, ticks: u32) -> SettleReport {
        let mut work = b.clone();
        let mut changed = BTreeSet::new();
        let mut per_tick = Vec::with_capacity(ticks as usize);
        for _ in 0..ticks {
            let step = self.tick(&mut work);
            per_tick.push(step.len() as u32);
            changed.extend(step);
        }
        SettleReport {
            ticks,
            changed,
            per_tick,
        }
    }

    /// Tick `b` until a tick changes nothing; returns the ticks taken. Fails
    /// if it is still changing after `max_ticks`, or holds more than
    /// `max_wet` water voxels at any point.
    pub fn presettle(
        &self,
        b: &mut SettleBox,
        max_ticks: u32,
        max_wet: usize,
    ) -> Result<u32, SettleError> {
        for tick in 0..max_ticks {
            if self.tick(b).is_empty() {
                return Ok(tick);
            }
            let wet = self.wet_count(b);
            if wet > max_wet {
                return Err(SettleError::TooWet { wet });
            }
        }
        Err(SettleError::Restless { ticks: max_ticks })
    }
}
