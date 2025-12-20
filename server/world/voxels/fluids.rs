use std::sync::Arc;

use crate::{Registry, Vec3, VoxelAccess, VoxelPacker};

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

fn count_horizontal_source_neighbors(
    vx: i32,
    vy: i32,
    vz: i32,
    space: &dyn VoxelAccess,
    fluid_id: u32,
) -> u32 {
    let mut count = 0;
    for [dx, dz] in HORIZONTAL_NEIGHBORS {
        let nx = vx + dx;
        let nz = vz + dz;
        if space.get_voxel(nx, vy, nz) == fluid_id && space.get_voxel_stage(nx, vy, nz) == 0 {
            count += 1;
        }
    }
    count
}

fn has_valid_source_path(
    vx: i32,
    vy: i32,
    vz: i32,
    curr_stage: u32,
    space: &dyn VoxelAccess,
    fluid_id: u32,
) -> bool {
    if space.get_voxel(vx, vy + 1, vz) == fluid_id {
        return true;
    }

    for [dx, dz] in HORIZONTAL_NEIGHBORS {
        let nx = vx + dx;
        let nz = vz + dz;
        if space.get_voxel(nx, vy, nz) == fluid_id {
            let neighbor_stage = space.get_voxel_stage(nx, vy, nz);
            if neighbor_stage < curr_stage {
                return true;
            }
        }
    }

    false
}

fn is_at_fluid_edge(
    vx: i32,
    vy: i32,
    vz: i32,
    space: &dyn VoxelAccess,
    fluid_id: u32,
    max_stage: u32,
) -> bool {
    let curr_stage = space.get_voxel_stage(vx, vy, vz);
    if curr_stage >= max_stage {
        return true;
    }

    for [dx, dz] in HORIZONTAL_NEIGHBORS {
        let nx = vx + dx;
        let nz = vz + dz;
        let neighbor_id = space.get_voxel(nx, vy, nz);
        if neighbor_id != fluid_id {
            return true;
        }
        let neighbor_stage = space.get_voxel_stage(nx, vy, nz);
        if neighbor_stage > curr_stage {
            return true;
        }
    }

    false
}

pub type FluidTicker = Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + Send + Sync>;
pub type FluidUpdater =
    Arc<dyn Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<(Vec3<i32>, u32)> + Send + Sync>;

pub fn create_fluid_active_fn(fluid_id: u32, config: FluidConfig) -> (FluidTicker, FluidUpdater) {
    let tick_rate = config.tick_rate;
    let config_clone = config.clone();

    let ticker: FluidTicker = Arc::new(move |_pos, _space, _registry| tick_rate);

    let updater: FluidUpdater = Arc::new(
        move |pos: Vec3<i32>, space: &dyn VoxelAccess, _registry: &Registry| {
            let Vec3(vx, vy, vz) = pos;
            let curr_stage = space.get_voxel_stage(vx, vy, vz);

            if config_clone.infinite_source && curr_stage > 0 {
                let source_count = count_horizontal_source_neighbors(vx, vy, vz, space, fluid_id);
                if source_count >= config_clone.infinite_source_count {
                    return vec![(
                        Vec3(vx, vy, vz),
                        VoxelPacker::new().with_id(fluid_id).with_stage(0).pack(),
                    )];
                }
            }

            if config_clone.infinite_source && curr_stage == 0 {
                for [dx, dz] in HORIZONTAL_NEIGHBORS {
                    let nx = vx + dx;
                    let nz = vz + dz;
                    if space.get_voxel(nx, vy, nz) == 0 {
                        let source_count =
                            count_horizontal_source_neighbors(nx, vy, nz, space, fluid_id);
                        if source_count >= config_clone.infinite_source_count {
                            return vec![(
                                Vec3(nx, vy, nz),
                                VoxelPacker::new().with_id(fluid_id).with_stage(0).pack(),
                            )];
                        }
                    }
                }
            }

            if vy > 0 && space.get_voxel(vx, vy - 1, vz) == 0 {
                let new_stage = if config_clone.flows_down_as_source {
                    0
                } else {
                    1.max(curr_stage)
                };
                return vec![(
                    Vec3(vx, vy - 1, vz),
                    VoxelPacker::new()
                        .with_id(fluid_id)
                        .with_stage(new_stage)
                        .pack(),
                )];
            }

            if curr_stage > 0 {
                let has_source = has_valid_source_path(vx, vy, vz, curr_stage, space, fluid_id);
                if !has_source {
                    let at_edge =
                        is_at_fluid_edge(vx, vy, vz, space, fluid_id, config_clone.max_stage);
                    if at_edge {
                        return vec![(Vec3(vx, vy, vz), 0)];
                    }
                    return vec![];
                }
            }

            let below_id = space.get_voxel(vx, vy - 1, vz);
            let on_solid_ground = below_id != 0 && below_id != fluid_id;
            let can_spread = if curr_stage == 0 {
                below_id != 0
            } else {
                on_solid_ground
            };

            if can_spread && curr_stage < config_clone.max_stage {
                let mut updates = vec![];
                for [dx, dz] in HORIZONTAL_NEIGHBORS {
                    let nx = vx + dx;
                    let nz = vz + dz;
                    if space.get_voxel(nx, vy, nz) == 0 {
                        updates.push((
                            Vec3(nx, vy, nz),
                            VoxelPacker::new()
                                .with_id(fluid_id)
                                .with_stage(curr_stage + 1)
                                .pack(),
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
