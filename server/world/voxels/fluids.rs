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
                    let target = if view.space.get_voxel_waterlogged(vx, vy, vz) {
                        FluidTarget::Waterloggable
                    } else {
                        FluidTarget::Air
                    };
                    return vec![(Vec3(vx, vy, vz), view.filled_voxel(vx, vy, vz, 0, target))];
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
                let new_stage = if config_clone.flows_down_as_source {
                    0
                } else {
                    1.max(curr_stage)
                };
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

            // Reaching here means the fluid could not fall, so something is
            // underfoot unless this is the world floor. It only counts as
            // ground to spread across if it is not more of this same fluid.
            let is_world_floor = vy <= 0;
            let on_solid_ground = !is_world_floor && !view.holds_fluid(vx, vy - 1, vz);
            let can_spread = if curr_stage == 0 {
                !is_world_floor
            } else {
                on_solid_ground
            };

            if can_spread && curr_stage < config_clone.max_stage {
                let mut updates = vec![];
                for [dx, dz] in HORIZONTAL_NEIGHBORS {
                    let nx = vx + dx;
                    let nz = vz + dz;
                    if let Some(target) = view.target_at(nx, vy, nz) {
                        updates.push((
                            Vec3(nx, vy, nz),
                            view.filled_voxel(nx, vy, nz, curr_stage + 1, target),
                        ));
                    }
                }
                if !updates.is_empty() {
                    return updates;
                }
            }

            vec![]
        },
    );

    (ticker, updater)
}
