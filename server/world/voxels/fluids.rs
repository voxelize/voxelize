use std::sync::Arc;

use crate::{BlockUtils, Registry, Vec3, VoxelAccess, VoxelPacker};

#[derive(Clone)]
pub struct FluidConfig {
    pub max_stage: u32,
    pub tick_rate: u64,
    pub infinite_source: bool,
    pub infinite_source_count: u32,
    pub flows_down_as_source: bool,
}

impl Default for FluidConfig {
    fn default() -> Self {
        Self {
            max_stage: 7,
            tick_rate: 15,
            infinite_source: true,
            infinite_source_count: 2,
            flows_down_as_source: false,
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
}

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
    /// This is the one definition of horizontal spread. The spreading cell
    /// asks it about itself to fill its neighbours, and a flowing cell asks
    /// it about each neighbour to learn what it is being offered, so the two
    /// can never disagree about a level.
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

    /// The fullest level this cell's neighbours are offering it right now —
    /// what it would be filled at were it air this tick. A cell's level was
    /// once fixed the moment it was filled, so a source placed beside water
    /// that had already spread from elsewhere left every neighbour at its old,
    /// thinner level and spread nowhere itself; comparing against this each
    /// tick is what lets standing water take a better offer.
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
            // neighbours this tick instead of next.
            if let Some(level) = view.horizontal_offer_at(vx, vy, vz, stage, config_clone.max_stage)
            {
                for [dx, dz] in HORIZONTAL_NEIGHBORS {
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
            let (_, updater) = create_fluid_active_fn(WATER_ID, FluidConfig::new());
            Self {
                chunk: flat_floor(),
                registry: registry(),
                updater,
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
    fn a_settled_spread_is_a_fixed_point() {
        let mut sim = Sim::new();
        sim.place_source(8, WATER_Y, ROW_Z);
        sim.settle();

        // Re-levelling compares every wet cell against its neighbours each
        // tick; a spread that is already at its levels must not churn.
        assert_eq!(sim.tick(), 0);
    }
}
