use std::collections::HashMap;
use std::sync::Arc;

use crate::{BlockUtils, Registry, Vec3, VoxelAccess, VoxelPacker};

#[derive(Clone)]
pub struct FluidConfig {
    pub max_stage: u32,
    pub tick_rate: u64,
    pub infinite_source: bool,
    pub infinite_source_count: u32,
    pub flows_down_as_source: bool,
    /// A falling sheet regains horizontal reach, but remains source-dependent.
    pub renews_reach_on_fall: bool,
    pub slope_find_distance: u32,
}

impl Default for FluidConfig {
    fn default() -> Self {
        Self {
            max_stage: 7,
            tick_rate: 15,
            infinite_source: true,
            infinite_source_count: 2,
            flows_down_as_source: false,
            renews_reach_on_fall: false,
            slope_find_distance: 4,
        }
    }
}

impl FluidConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn max_stage(mut self, max_stage: u32) -> Self {
        self.max_stage = max_stage;
        self
    }

    pub fn tick_rate(mut self, tick_rate: u64) -> Self {
        self.tick_rate = tick_rate;
        self
    }

    pub fn infinite_source(mut self, enabled: bool, count: u32) -> Self {
        self.infinite_source = enabled;
        self.infinite_source_count = count;
        self
    }

    pub fn flows_down_as_source(mut self, enabled: bool) -> Self {
        self.flows_down_as_source = enabled;
        self
    }

    pub fn renews_reach_on_fall(mut self, enabled: bool) -> Self {
        self.renews_reach_on_fall = enabled;
        self
    }

    pub fn slope_find_distance(mut self, distance: u32) -> Self {
        self.slope_find_distance = distance;
        self
    }
}

/// Paired so that a direction's opposite is `index ^ 1`: the drop search
/// never walks back the way it came.
const HORIZONTAL_NEIGHBORS: [[i32; 2]; 4] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/// The fluid's view of one voxel. A waterlogged block is water as far as the
/// simulation is concerned: it holds a level, drains when it loses its source,
/// and feeds its neighbours — it simply keeps its block while doing so.
struct FluidView<'a> {
    space: &'a dyn VoxelAccess,
    registry: &'a Registry,
    fluid_id: u32,
    is_waterlogging: bool,
}

/// Where the fluid may expand to. `Air` is replaced outright; `Waterloggable`
/// keeps its block and gains the fluid alongside it.
enum FluidTarget {
    Air,
    Waterloggable,
}

/// What the drop search needs to know about one cell on the spreading cell's
/// level, remembered for the rest of that search: the search bends, so it
/// reaches the same cell along several paths.
///
/// A cell the space does not hold — an unloaded chunk — reads back as air,
/// which would make every seam of the loaded world look like a cliff to run
/// to. Such a cell is `known: false`, and neither passable nor a drop.
#[derive(Clone, Copy)]
struct SlopeProbe {
    known: bool,
    passable: bool,
    over_drop: bool,
}

type SlopeMemo = HashMap<(i32, i32), SlopeProbe>;

impl FluidView<'_> {
    fn holds_fluid(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.space.get_voxel(vx, vy, vz) == self.fluid_id
            || (self.is_waterlogging && self.space.get_voxel_waterlogged(vx, vy, vz))
    }

    fn stage_at(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.space.get_voxel_fluid_level(vx, vy, vz)
    }

    /// How this voxel could take the fluid, or `None` if it cannot — because
    /// it is solid, or because it already holds the fluid.
    fn target_at(&self, vx: i32, vy: i32, vz: i32) -> Option<FluidTarget> {
        if self.holds_fluid(vx, vy, vz) {
            return None;
        }

        let id = self.space.get_voxel(vx, vy, vz);
        if id == 0 {
            return Some(FluidTarget::Air);
        }
        if self.is_waterlogging && self.registry.is_waterloggable(id) {
            return Some(FluidTarget::Waterloggable);
        }
        None
    }

    /// The voxel word this position becomes once it holds the fluid at `level`.
    ///
    /// A waterlogged block keeps everything it already had — including its own
    /// `stage` — and gains the fluid in the fluid's own field.
    fn filled_voxel(&self, vx: i32, vy: i32, vz: i32, level: u32, target: FluidTarget) -> u32 {
        match target {
            FluidTarget::Air => VoxelPacker::new()
                .with_id(self.fluid_id)
                .with_stage(level)
                .pack(),
            FluidTarget::Waterloggable => {
                let raw = self.space.get_raw_voxel(vx, vy, vz);
                BlockUtils::insert_waterlog_level(BlockUtils::insert_waterlogged(raw, true), level)
            }
        }
    }

    /// The voxel word this position becomes once its fluid is gone: a
    /// waterlogged block keeps itself and dries out, plain fluid becomes air.
    fn drained_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let raw = self.space.get_raw_voxel(vx, vy, vz);
        if BlockUtils::extract_waterlogged(raw) {
            BlockUtils::insert_waterlog_level(BlockUtils::insert_waterlogged(raw, false), 0)
        } else {
            0
        }
    }

    /// The voxel word this position — which already holds the fluid — becomes
    /// at a different `level`, keeping its block if it is waterlogged.
    fn releveled_voxel(&self, vx: i32, vy: i32, vz: i32, level: u32) -> u32 {
        let target = if self.space.get_voxel_waterlogged(vx, vy, vz) {
            FluidTarget::Waterloggable
        } else {
            FluidTarget::Air
        };
        self.filled_voxel(vx, vy, vz, level, target)
    }

    /// The level a fluid cell at `stage` hands each horizontal neighbour it
    /// spreads into, or `None` if it does not spread sideways right now: it
    /// is already as thin as the fluid gets, it stands on the world floor,
    /// it would rather fall, or — flowing fluid only — it has no ground under
    /// it to run across. Sources run across standing fluid too, which is how
    /// a pool overflows onto land.
    ///
    /// This is the one definition of the level a spread hands over. The
    /// spreading cell asks it about itself to fill its neighbours, and a
    /// flowing cell asks it about each neighbour to learn what it is being
    /// offered, so the two can never disagree about a level. Which sides a
    /// spread actually creates water on is a separate gate,
    /// [`FluidView::spread_directions`], applied to creation only: water
    /// that already stands somewhere takes a fuller offer from any side.
    fn horizontal_offer_at(
        &self,
        vx: i32,
        vy: i32,
        vz: i32,
        stage: u32,
        max_stage: u32,
    ) -> Option<u32> {
        if stage >= max_stage || vy <= 0 {
            return None;
        }
        if self.target_at(vx, vy - 1, vz).is_some() {
            return None;
        }
        if stage > 0 && self.holds_fluid(vx, vy - 1, vz) {
            return None;
        }
        Some(stage + 1)
    }

    fn horizontal_offer(&self, vx: i32, vy: i32, vz: i32, max_stage: u32) -> Option<u32> {
        if !self.holds_fluid(vx, vy, vz) {
            return None;
        }
        self.horizontal_offer_at(vx, vy, vz, self.stage_at(vx, vy, vz), max_stage)
    }

    /// The level fluid at `stage` arrives at when it falls one block.
    fn falling_level(stage: u32, config: &FluidConfig) -> u32 {
        if config.flows_down_as_source {
            0
        } else if config.renews_reach_on_fall {
            1
        } else {
            1.max(stage)
        }
    }

    /// The level the cell above would pour into this one, or `None` if
    /// nothing wet stands above it.
    fn offer_from_above(&self, vx: i32, vy: i32, vz: i32, config: &FluidConfig) -> Option<u32> {
        if !self.holds_fluid(vx, vy + 1, vz) {
            return None;
        }
        Some(Self::falling_level(self.stage_at(vx, vy + 1, vz), config))
    }

    /// The fullest level any of this cell's neighbours could hand it right
    /// now. A cell's level was once fixed the moment it was filled, so a
    /// source placed beside water that had already spread from elsewhere left
    /// every neighbour at its old, thinner level and spread nowhere itself;
    /// comparing against this each tick is what lets standing water take a
    /// better offer.
    fn offered_level(&self, vx: i32, vy: i32, vz: i32, config: &FluidConfig) -> Option<u32> {
        let mut best = self.offer_from_above(vx, vy, vz, config);
        for [dx, dz] in HORIZONTAL_NEIGHBORS {
            let offer = self.horizontal_offer(vx + dx, vy, vz + dz, config.max_stage);
            best = match (best, offer) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            };
        }
        best
    }

    /// Whether spreading fluid could run through this cell: air, a block that
    /// would take the fluid alongside itself, or fluid that is not a source.
    /// A source is a wall to the search — nothing flows into a full cell.
    fn is_passable(&self, vx: i32, vy: i32, vz: i32) -> bool {
        if self.target_at(vx, vy, vz).is_some() {
            return true;
        }
        self.holds_fluid(vx, vy, vz) && self.stage_at(vx, vy, vz) > 0
    }

    /// Whether fluid arriving in this cell would have somewhere to fall: the
    /// cell below is open to it, or already holds fluid — a pool a course down
    /// is a drop just as a dry pit is.
    fn is_over_drop(&self, vx: i32, vy: i32, vz: i32) -> bool {
        vy > 0 && (self.target_at(vx, vy - 1, vz).is_some() || self.holds_fluid(vx, vy - 1, vz))
    }

    fn probe(&self, memo: &mut SlopeMemo, vx: i32, vy: i32, vz: i32) -> SlopeProbe {
        *memo.entry((vx, vz)).or_insert_with(|| {
            let known = self.space.contains(vx, vy, vz);
            SlopeProbe {
                known,
                passable: known && self.is_passable(vx, vy, vz),
                over_drop: known && self.is_over_drop(vx, vy, vz),
            }
        })
    }

    /// Steps from the passable cell at `(vx, vz)` to the nearest cell standing
    /// over a drop, walking passable cells on this level and never straight
    /// back the way it came, or `None` if there is none within `reach` steps.
    /// `distance` is what a drop found among this cell's neighbours counts as.
    #[allow(clippy::too_many_arguments)]
    fn drop_distance(
        &self,
        memo: &mut SlopeMemo,
        vx: i32,
        vy: i32,
        vz: i32,
        came_from: usize,
        distance: u32,
        reach: u32,
        origin: (i32, i32),
    ) -> Option<u32> {
        let mut nearest: Option<u32> = None;
        for (dir, [dx, dz]) in HORIZONTAL_NEIGHBORS.iter().enumerate() {
            if dir == came_from {
                continue;
            }
            let (nx, nz) = (vx + dx, vz + dz);
            if (nx, nz) == origin {
                continue;
            }
            let probe = self.probe(memo, nx, vy, nz);
            if !probe.passable {
                continue;
            }
            if probe.over_drop {
                return Some(distance);
            }
            if distance < reach {
                if let Some(found) =
                    self.drop_distance(memo, nx, vy, nz, dir ^ 1, distance + 1, reach, origin)
                {
                    nearest = Some(nearest.map_or(found, |n| n.min(found)));
                }
            }
        }
        nearest
    }

    /// Which of the four sides a cell spreading from `(vx, vy, vz)` creates
    /// water on. Water runs to a drop before it pools: every passable side is
    /// measured for its shortest path to a cell standing over a drop, and only
    /// the side (or sides, on a tie) with the shortest path is taken. A
    /// neighbour itself over a drop is distance 0; a drop `reach` steps past a
    /// neighbour is the furthest that counts. With no drop in reach on any
    /// side, water spreads to every passable side, as it always did.
    fn spread_directions(&self, vx: i32, vy: i32, vz: i32, reach: u32) -> [bool; 4] {
        let mut memo = SlopeMemo::new();
        // Outer `None`: the side is a wall. Inner `None`: passable, no drop in reach.
        let mut distances: [Option<Option<u32>>; 4] = [None; 4];
        let mut nearest: Option<u32> = None;

        for (dir, [dx, dz]) in HORIZONTAL_NEIGHBORS.iter().enumerate() {
            let (nx, nz) = (vx + dx, vz + dz);
            let probe = self.probe(&mut memo, nx, vy, nz);
            if !probe.known {
                // A side the world has not loaded is neither a wall nor a
                // drop. It is taken when nothing better is in reach — the
                // fill parks until its chunk is ready, as it always has —
                // and is never searched through.
                distances[dir] = Some(None);
                continue;
            }
            if !probe.passable {
                continue;
            }
            let distance = if probe.over_drop {
                Some(0)
            } else if reach >= 1 {
                self.drop_distance(&mut memo, nx, vy, nz, dir ^ 1, 1, reach, (vx, vz))
            } else {
                None
            };
            distances[dir] = Some(distance);
            if let Some(found) = distance {
                nearest = Some(nearest.map_or(found, |n| n.min(found)));
            }
        }

        let mut sides = [false; 4];
        for (dir, side) in sides.iter_mut().enumerate() {
            *side = match (distances[dir], nearest) {
                (Some(_), None) => true,
                (Some(Some(distance)), Some(shortest)) => distance == shortest,
                _ => false,
            };
        }
        sides
    }

    fn count_horizontal_source_neighbors(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        let mut count = 0;
        for [dx, dz] in HORIZONTAL_NEIGHBORS {
            let nx = vx + dx;
            let nz = vz + dz;
            if self.holds_fluid(nx, vy, nz) && self.stage_at(nx, vy, nz) == 0 {
                count += 1;
            }
        }
        count
    }

    fn has_valid_source_path(&self, vx: i32, vy: i32, vz: i32, curr_stage: u32) -> bool {
        if self.holds_fluid(vx, vy + 1, vz) {
            return true;
        }

        for [dx, dz] in HORIZONTAL_NEIGHBORS {
            let nx = vx + dx;
            let nz = vz + dz;
            if self.holds_fluid(nx, vy, nz) && self.stage_at(nx, vy, nz) < curr_stage {
                return true;
            }
        }

        false
    }

    fn is_at_fluid_edge(&self, vx: i32, vy: i32, vz: i32, max_stage: u32) -> bool {
        let curr_stage = self.stage_at(vx, vy, vz);
        if curr_stage >= max_stage {
            return true;
        }

        for [dx, dz] in HORIZONTAL_NEIGHBORS {
            let nx = vx + dx;
            let nz = vz + dz;
            if !self.holds_fluid(nx, vy, nz) || self.stage_at(nx, vy, nz) > curr_stage {
                return true;
            }
        }

        false
    }
}

pub type FluidTicker = Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + Send + Sync>;
pub type FluidUpdater =
    Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<(Vec3<i32>, u32)> + Send + Sync>;

pub fn create_fluid_active_fn(fluid_id: u32, config: FluidConfig) -> (FluidTicker, FluidUpdater) {
    let tick_rate = config.tick_rate;
    let config_clone = config.clone();

    let ticker: FluidTicker = Arc::new(move |_pos, _space, _registry| tick_rate);

    let updater: FluidUpdater = Arc::new(
        move |pos: Vec3<i32>, space: &dyn VoxelAccess, registry: &Registry| {
            let Vec3(vx, vy, vz) = pos;
            let view = FluidView {
                space,
                registry,
                fluid_id,
                is_waterlogging: registry.waterlogging_fluid_id() == Some(fluid_id),
            };
            let curr_stage = view.stage_at(vx, vy, vz);

            if config_clone.infinite_source && curr_stage > 0 {
                let source_count = view.count_horizontal_source_neighbors(vx, vy, vz);
                if source_count >= config_clone.infinite_source_count {
                    return vec![(Vec3(vx, vy, vz), view.releveled_voxel(vx, vy, vz, 0))];
                }
            }

            if config_clone.infinite_source && curr_stage == 0 {
                for [dx, dz] in HORIZONTAL_NEIGHBORS {
                    let nx = vx + dx;
                    let nz = vz + dz;
                    if let Some(target) = view.target_at(nx, vy, nz) {
                        let source_count = view.count_horizontal_source_neighbors(nx, vy, nz);
                        if source_count >= config_clone.infinite_source_count {
                            return vec![(
                                Vec3(nx, vy, nz),
                                view.filled_voxel(nx, vy, nz, 0, target),
                            )];
                        }
                    }
                }
            }

            let below_target = if vy > 0 {
                view.target_at(vx, vy - 1, vz)
            } else {
                None
            };

            if let Some(target) = below_target {
                let new_stage = FluidView::falling_level(curr_stage, &config_clone);
                return vec![(
                    Vec3(vx, vy - 1, vz),
                    view.filled_voxel(vx, vy - 1, vz, new_stage, target),
                )];
            }

            if curr_stage > 0 && !view.has_valid_source_path(vx, vy, vz, curr_stage) {
                if view.is_at_fluid_edge(vx, vy, vz, config_clone.max_stage) {
                    return vec![(Vec3(vx, vy, vz), view.drained_voxel(vx, vy, vz))];
                }
                return vec![];
            }

            let mut updates = vec![];

            // Flowing fluid takes the fullest level its neighbours offer, if
            // that beats what it has. Only ever fuller: a level can only be
            // offered by a neighbour strictly fuller than it, so re-levelling
            // walks toward the nearest source and stops there, and a cell
            // whose feed has gone thinner still drains through the edge rule
            // above rather than propping up the neighbour that is propping
            // it up.
            let stage = match view.offered_level(vx, vy, vz, &config_clone) {
                Some(offered) if curr_stage > 0 && offered < curr_stage => {
                    updates.push((Vec3(vx, vy, vz), view.releveled_voxel(vx, vy, vz, offered)));
                    offered
                }
                _ => curr_stage,
            };

            // Reaching here means the fluid could not fall, so something is
            // underfoot unless this is the world floor. Spread from the level
            // this cell is becoming, so a re-levelled cell feeds its
            // neighbours this tick instead of next — and only toward the
            // nearest drop, if one is in reach: water poured beside a pit
            // runs into the pit rather than ringing itself first.
            if let Some(level) = view.horizontal_offer_at(vx, vy, vz, stage, config_clone.max_stage)
            {
                let sides = view.spread_directions(vx, vy, vz, config_clone.slope_find_distance);
                for (dir, [dx, dz]) in HORIZONTAL_NEIGHBORS.iter().enumerate() {
                    if !sides[dir] {
                        continue;
                    }
                    let nx = vx + dx;
                    let nz = vz + dz;
                    if let Some(target) = view.target_at(nx, vy, nz) {
                        updates.push((
                            Vec3(nx, vy, nz),
                            view.filled_voxel(nx, vy, nz, level, target),
                        ));
                    }
                }
            }

            updates
        },
    );

    (ticker, updater)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::{Block, Chunk, ChunkOptions};

    const WATER_ID: u32 = 100;
    const STONE_ID: u32 = 200;
    const KELP_ID: u32 = 300;

    const FLOOR_Y: i32 = 1;
    const WATER_Y: i32 = FLOOR_Y + 1;
    const ROW_Z: i32 = 8;

    /// The most ticks any scene here needs to settle; a scene that is still
    /// changing after this many is oscillating, and the assertion says so.
    const SETTLE_LIMIT: usize = 64;

    fn registry() -> Registry {
        let mut registry = Registry::new();
        registry.register_block(
            &Block::new("Water")
                .id(WATER_ID)
                .is_fluid(true)
                .is_waterlogging_fluid(true)
                .build(),
        );
        registry.register_block(&Block::new("Stone").id(STONE_ID).build());
        registry.register_block(
            &Block::new("Kelp")
                .id(KELP_ID)
                .is_waterloggable(true)
                .build(),
        );
        registry
    }

    /// One chunk of flat stone floor, open sky above it.
    fn flat_floor() -> Chunk {
        let mut chunk = Chunk::new(
            "test",
            0,
            0,
            &ChunkOptions {
                size: 16,
                max_height: 64,
                sub_chunks: 1,
            },
        );
        for x in 0..16 {
            for z in 0..16 {
                chunk.set_voxel(x, FLOOR_Y, z, STONE_ID);
            }
        }
        chunk
    }

    struct Sim {
        chunk: Chunk,
        registry: Registry,
        updater: FluidUpdater,
    }

    impl Sim {
        fn new() -> Self {
            Self::with_config(FluidConfig::new())
        }

        fn with_config(config: FluidConfig) -> Self {
            let (_, updater) = create_fluid_active_fn(WATER_ID, config);
            Self {
                chunk: flat_floor(),
                registry: registry(),
                updater,
            }
        }

        /// Sink the floor one course across a band of x: the surface cells
        /// there stand over a drop, and water that falls in lands on stone
        /// at `FLOOR_Y - 1` where it can still spread.
        fn carve_pit(&mut self, xs: std::ops::RangeInclusive<i32>) {
            for x in xs {
                for z in 0..16 {
                    self.chunk.set_voxel(x, FLOOR_Y, z, 0);
                    self.chunk.set_voxel(x, FLOOR_Y - 1, z, STONE_ID);
                }
            }
        }

        fn place_source(&mut self, x: i32, y: i32, z: i32) {
            self.chunk.set_voxel(x, y, z, WATER_ID);
            self.chunk.set_voxel_stage(x, y, z, 0);
        }

        fn holds_fluid(raw: u32) -> bool {
            BlockUtils::extract_id(raw) == WATER_ID || BlockUtils::extract_waterlogged(raw)
        }

        fn stage_at(&self, x: i32, y: i32, z: i32) -> Option<u32> {
            let raw = self.chunk.get_raw_voxel(x, y, z);
            Self::holds_fluid(raw).then(|| BlockUtils::extract_fluid_level(raw))
        }

        /// The row through `ROW_Z` at water height, `.` for dry cells.
        fn row(&self, x0: i32, x1: i32) -> String {
            (x0..=x1)
                .map(|x| match self.stage_at(x, WATER_Y, ROW_Z) {
                    Some(stage) => stage.to_string(),
                    None => ".".to_string(),
                })
                .collect::<Vec<_>>()
                .join(" ")
        }

        fn wet_count(&self) -> usize {
            let mut count = 0;
            for x in 0..16 {
                for y in 0..64 {
                    for z in 0..16 {
                        if self.stage_at(x, y, z).is_some() {
                            count += 1;
                        }
                    }
                }
            }
            count
        }

        /// One fluid tick over the whole chunk, the way the updating system
        /// runs it: every wet cell plans against the committed world, two
        /// offers into one cell keep the fuller one, then everything commits.
        /// Returns how many voxels changed.
        fn tick(&mut self) -> usize {
            let mut plan: HashMap<Vec3<i32>, u32> = HashMap::new();
            for x in 0..16 {
                for y in 0..64 {
                    for z in 0..16 {
                        if self.stage_at(x, y, z).is_none() {
                            continue;
                        }
                        for (position, raw) in
                            (self.updater)(Vec3(x, y, z), &self.chunk, &self.registry)
                        {
                            // Past the chunk edge reads back as air forever, so a
                            // fill there would count as a change every tick.
                            if !self.chunk.contains(position.0, position.1, position.2) {
                                continue;
                            }
                            let is_fuller_fluid = |candidate: u32, existing: u32| {
                                Self::holds_fluid(candidate)
                                    && Self::holds_fluid(existing)
                                    && BlockUtils::extract_fluid_level(candidate)
                                        < BlockUtils::extract_fluid_level(existing)
                            };
                            match plan.get(&position) {
                                Some(&existing) if !is_fuller_fluid(raw, existing) => {}
                                _ => {
                                    plan.insert(position, raw);
                                }
                            }
                        }
                    }
                }
            }
            let mut changed = 0;
            for (Vec3(x, y, z), raw) in plan {
                if self.chunk.get_raw_voxel(x, y, z) != raw {
                    self.chunk.set_raw_voxel(x, y, z, raw);
                    changed += 1;
                }
            }
            changed
        }

        fn settle(&mut self) {
            for _ in 0..SETTLE_LIMIT {
                if self.tick() == 0 {
                    return;
                }
            }
            panic!(
                "still changing after {SETTLE_LIMIT} ticks; row: {}",
                self.row(0, 15)
            );
        }
    }

    #[test]
    fn a_source_placed_beside_spread_water_relevels_it_and_spreads_on() {
        let mut sim = Sim::new();
        sim.place_source(4, WATER_Y, ROW_Z);
        sim.settle();
        assert_eq!(sim.row(4, 11), "0 1 2 3 4 5 6 7");

        // The second source lands inside the first one's spread, with stale
        // water on every side of it.
        sim.place_source(10, WATER_Y, ROW_Z);
        sim.settle();

        // Between the sources the water is as full as the nearer source
        // makes it; past the second source it is that source's own spread,
        // not the tail end of the first one's.
        assert_eq!(sim.row(4, 15), "0 1 2 3 2 1 0 1 2 3 4 5");
    }

    #[test]
    fn a_second_source_inside_a_spread_grows_its_own_pool() {
        let mut sim = Sim::new();
        sim.place_source(3, WATER_Y, ROW_Z);
        sim.settle();
        let one_source = sim.wet_count();

        sim.place_source(9, WATER_Y, ROW_Z);
        sim.settle();

        // (15, 8) is twelve steps from the first source and six from the
        // second: only the second can wet it, and only by re-levelling the
        // stale cells in between on its way there.
        assert_eq!(sim.stage_at(15, WATER_Y, ROW_Z), Some(6));
        assert!(
            sim.wet_count() > one_source,
            "the second source should have widened the pool past {one_source} cells"
        );
    }

    #[test]
    fn two_sources_one_apart_bridge_the_cell_between_into_a_source() {
        let mut sim = Sim::new();
        sim.place_source(6, WATER_Y, ROW_Z);
        sim.settle();
        sim.place_source(8, WATER_Y, ROW_Z);
        sim.settle();

        assert_eq!(sim.row(5, 9), "1 0 0 0 1");
    }

    #[test]
    fn two_sources_further_apart_do_not_form_a_source_between_them() {
        let mut sim = Sim::new();
        sim.place_source(5, WATER_Y, ROW_Z);
        sim.settle();
        sim.place_source(8, WATER_Y, ROW_Z);
        sim.settle();

        // A source only forms beside two sources; a wider gap levels out to
        // the nearest source on each side and stays flowing.
        assert_eq!(sim.row(5, 8), "0 1 1 0");
    }

    #[test]
    fn a_source_above_relevels_the_flowing_water_under_it() {
        let mut sim = Sim::new();
        sim.place_source(8, WATER_Y, ROW_Z);
        sim.settle();
        assert_eq!(sim.stage_at(12, WATER_Y, ROW_Z), Some(4));

        // A source dropped onto the thin end of the spread pours into it.
        sim.place_source(12, WATER_Y + 1, ROW_Z);
        sim.settle();

        assert_eq!(sim.stage_at(12, WATER_Y, ROW_Z), Some(1));
    }

    #[test]
    fn a_waterlogged_block_relevels_in_its_own_fluid_field() {
        let mut sim = Sim::new();
        sim.place_source(4, WATER_Y, ROW_Z);
        sim.settle();

        // Kelp standing in the stage-5 cell keeps that water as its waterlog.
        sim.chunk.set_voxel(9, WATER_Y, ROW_Z, KELP_ID);
        sim.chunk.set_voxel_waterlogged(9, WATER_Y, ROW_Z, true);
        sim.chunk.set_voxel_waterlog_level(9, WATER_Y, ROW_Z, 5);

        sim.place_source(10, WATER_Y, ROW_Z);
        sim.settle();

        assert_eq!(sim.chunk.get_voxel(9, WATER_Y, ROW_Z), KELP_ID);
        assert!(sim.chunk.get_voxel_waterlogged(9, WATER_Y, ROW_Z));
        assert_eq!(sim.chunk.get_voxel_waterlog_level(9, WATER_Y, ROW_Z), 1);
    }

    #[test]
    fn relevelling_never_props_up_water_whose_source_is_gone() {
        let mut sim = Sim::new();
        sim.place_source(4, WATER_Y, ROW_Z);
        sim.settle();
        sim.place_source(10, WATER_Y, ROW_Z);
        sim.settle();

        // Take both sources away: everything they fed has to drain, and
        // nothing may keep a neighbour alive by offering it a level.
        sim.chunk.set_voxel(4, WATER_Y, ROW_Z, 0);
        sim.chunk.set_voxel(10, WATER_Y, ROW_Z, 0);
        sim.settle();

        assert_eq!(sim.wet_count(), 0, "row: {}", sim.row(0, 15));
    }

    #[test]
    fn renewed_falls_feed_a_long_cascade_without_creating_sources() {
        let cascade = |renew| {
            let mut sim = Sim::with_config(FluidConfig::new().renews_reach_on_fall(renew));
            for x in 0..16 {
                for z in 7..=9 {
                    let top = if z != 8 || x == 0 || x == 15 {
                        30
                    } else {
                        20 - x / 4
                    };
                    for y in 0..=top {
                        sim.chunk.set_voxel(x, y, z, STONE_ID);
                    }
                }
            }
            sim.place_source(1, 21, 8);
            sim.settle();
            sim
        };
        let legacy = cascade(false);
        assert_eq!(legacy.stage_at(14, 18, 8), None);
        let mut sim = cascade(true);
        assert!(sim.stage_at(14, 18, 8).is_some());
        assert_eq!(sim.stage_at(12, 18, 8), Some(1));
        assert_eq!(sim.tick(), 0, "settled cascades do no continuing work");
        for x in 2..15 {
            for y in 17..=21 {
                assert_ne!(
                    sim.stage_at(x, y, 8),
                    Some(0),
                    "a fall minted an immortal source"
                );
            }
        }
        sim.chunk.set_voxel(1, 21, 8, STONE_ID);
        sim.settle();
        assert_eq!(
            sim.wet_count(),
            0,
            "dammed headwater must drain all downstream reaches"
        );
    }

    #[test]
    fn a_settled_spread_is_a_fixed_point() {
        let mut sim = Sim::new();
        sim.place_source(8, WATER_Y, ROW_Z);
        sim.settle();

        // Re-levelling compares every wet cell against its neighbours each
        // tick; a spread that is already at its levels must not churn.
        assert_eq!(sim.tick(), 0);
    }

    #[test]
    fn water_runs_to_a_drop_in_reach_instead_of_ringing_itself() {
        let mut sim = Sim::new();
        sim.carve_pit(11..=15);
        // Two dry cells between the source and the rim: the rim cell at 11 is
        // two steps past the source's +x neighbour, well inside reach.
        sim.place_source(8, WATER_Y, ROW_Z);
        sim.settle();

        // A one-wide stream to the rim, over the edge, and down.
        assert_eq!(sim.row(6, 11), ". . 0 1 2 3");
        assert_eq!(sim.stage_at(11, WATER_Y - 1, ROW_Z), Some(3));
        for (x, z) in [(7, ROW_Z), (8, ROW_Z - 1), (8, ROW_Z + 1), (9, ROW_Z + 1)] {
            assert_eq!(
                sim.stage_at(x, WATER_Y, z),
                None,
                "({x}, {z}) should have stayed dry; row: {}",
                sim.row(0, 15)
            );
        }
    }

    #[test]
    fn with_no_drop_in_reach_water_spreads_every_way() {
        let mut sim = Sim::new();
        // The rim at 15 is nine steps past the source's +x neighbour.
        sim.carve_pit(15..=15);
        sim.place_source(4, WATER_Y, ROW_Z);
        sim.settle();

        for (x, z) in [(1, ROW_Z), (7, ROW_Z), (4, ROW_Z - 3), (4, ROW_Z + 3)] {
            assert_eq!(sim.stage_at(x, WATER_Y, z), Some(3), "({x}, {z})");
        }
    }

    #[test]
    fn the_nearer_of_two_drops_wins() {
        let mut sim = Sim::new();
        // West rim at 2: four steps past the -x neighbour. East rim at 11:
        // three steps past the +x neighbour.
        sim.carve_pit(0..=2);
        sim.carve_pit(11..=15);
        sim.place_source(7, WATER_Y, ROW_Z);
        sim.settle();

        assert_eq!(sim.row(5, 11), ". . 0 1 2 3 4");
    }

    #[test]
    fn a_tie_between_drops_spreads_both_ways() {
        let mut sim = Sim::new();
        // Both rims three steps past their neighbour.
        sim.carve_pit(0..=3);
        sim.carve_pit(11..=15);
        sim.place_source(7, WATER_Y, ROW_Z);
        sim.settle();

        assert_eq!(sim.row(3, 11), "4 3 2 1 0 1 2 3 4");
        assert_eq!(sim.stage_at(7, WATER_Y, ROW_Z - 1), None);
        assert_eq!(sim.stage_at(7, WATER_Y, ROW_Z + 1), None);
    }

    #[test]
    fn reach_bounds_the_search() {
        // With one step of reach the rim two steps past the neighbour is
        // out of sight, and the water pools as if the pit were not there.
        let mut sim = Sim::with_config(FluidConfig::new().slope_find_distance(1));
        sim.carve_pit(11..=15);
        sim.place_source(8, WATER_Y, ROW_Z);
        sim.settle();

        assert_eq!(sim.stage_at(7, WATER_Y, ROW_Z), Some(1));
        assert_eq!(sim.stage_at(8, WATER_Y, ROW_Z + 1), Some(1));
        assert_eq!(sim.stage_at(11, WATER_Y, ROW_Z), Some(3));
    }
}
